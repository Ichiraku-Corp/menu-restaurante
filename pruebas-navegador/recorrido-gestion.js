// Recorre Gestión en un navegador real con un Supabase falso (gestion-falso.js).
// Uso: node pruebas-navegador/recorrido-gestion.js   (necesita Playwright y Chromium)
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});

let fallos = 0;
function ok(cond, msg) { if (cond) console.log("ok: " + msg); else { fallos++; console.log("FALLÓ: " + msg); } }

(async () => {
  await new Promise((r) => server.listen(8798, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8");
  await page.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "gestion-falso.js"), "utf8") }));
  await page.route("**/vendor/sentry-*/**", (r) => r.fulfill({ contentType: "application/javascript", body: "" }));

  try {
    await page.goto("http://localhost:8798/gestion.html");
    await page.waitForSelector("#app:not(.hidden)", { timeout: 8000 });
    ok(true, "entra a Gestión (sesión verificada)");

    // Cargar datos: plantilla, pegar desde Excel, revisar y cargar
    await page.click('#tabs [data-tab="importar"]');
    ok(/stock_minimo/.test(await page.textContent("#impCols")), "muestra los títulos de la plantilla de insumos");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#impTpl")]);
    const tpl = fs.readFileSync(await dl.path(), "utf8");
    ok(dl.suggestedFilename() === "plantilla-insumos.csv" && tpl.includes("nombre;unidad;cantidad_compra;precio_ref"), "descarga la plantilla en CSV");
    await page.fill("#impText", "Nombre\tUnidad\tPrecio REF\tColor\nHarina\tkg\t1,50\trojo\nSal\tbolsa\t1\tazul\n");
    await page.click("#impCheck"); await page.waitForSelector("#impSum .pill");
    ok(/1 nuevos[\s\S]*1 con error/.test(await page.textContent("#impSum")), "revisa: 1 nuevo y 1 con error");
    ok(/Unidad no reconocida/.test(await page.textContent("#impPrev")), "muestra el error de la fila");
    ok(/Color/.test(await page.textContent("#impSum")), "avisa las columnas que no se usan");
    const sent = await page.evaluate(() => window.__G.calls.filter((c) => c.rpc === "import_data")[0].args);
    ok(sent.p_dry === true && sent.p_rows[0].precio === "1,50" && sent.p_rows[0].nombre === "Harina", "entiende los títulos aunque estén escritos distinto");
    ok(!(await page.isDisabled("#impGo")) && (await page.textContent("#impGo")) === "Cargar 1 fila", "ofrece cargar solo las filas buenas");
    await page.click("#impGo"); await page.waitForTimeout(400);
    ok(await page.evaluate(() => window.__G.calls.some((c) => c.rpc === "import_data" && c.args.p_dry === false)), "carga de verdad al confirmar");
    await page.selectOption("#impKind", "clientes");
    ok(/cedula/.test(await page.textContent("#impCols")) && await page.isDisabled("#impGo"), "al cambiar de tipo, cambia la plantilla y pide revisar de nuevo");
    await page.fill("#impText", 'nombre,telefono\n"Pérez, Ana",0414-1234567\n');
    await page.click("#impCheck"); await page.waitForTimeout(300);
    const cli = await page.evaluate(() => window.__G.calls.filter((c) => c.rpc === "import_data").pop().args.p_rows[0]);
    ok(cli.nombre === "Pérez, Ana" && cli.telefono === "0414-1234567", "lee CSV con comas y comillas");

    // Recetas: rentabilidad del menú
    await page.click('#tabs [data-tab="recetas"]'); await page.waitForTimeout(400);
    ok(/Gyozas/.test(await page.textContent("#meList")) && /Ganancia de los platos/.test(await page.textContent("#meKpis")), "muestra la rentabilidad del menú con lo vendido");
    ok(/Estrella|Popular|Deja bien|Vende poco/.test(await page.textContent("#meList")), "clasifica el plato y dice qué hacer");
  } catch (e) {
    fallos++; console.log("FALLÓ: " + e.message.split("\n")[0]);
  }
  ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  await browser.close(); server.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DE GESTIÓN PASARON");
})();
