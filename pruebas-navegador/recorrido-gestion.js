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
    // Entra por «Inicio» y navega por secciones
    ok(await page.isVisible('#secs [data-sec="inicio"].on') && await page.isVisible("#iniKpis") && !(await page.isVisible("#tabs")), "Gestión abre en «Inicio», sin la fila de pestañas");
    ok(/Ventas de hoy/.test(await page.textContent("#iniKpis")) && /Laptop de caja/.test(await page.textContent("#iniEstado")), "Inicio muestra ventas de hoy y el estado de la laptop");
    // Ventas por hora y día (Dinero › Histórico)
    await page.click('#secs [data-sec="dinero"]'); await page.click('#tabs [data-tab="historico"]');
    await page.waitForSelector("#vhMap .vh-grid", { timeout: 5000 });
    const vh = await page.evaluate(() => ({ celdas: document.querySelectorAll("#vhMap .vh-grid .c").length, fuerte: document.querySelectorAll("#vhMap .vh-grid .c.l5").length,
      top: document.querySelector("#vhMap .vh-top li").textContent, horas: [...document.querySelectorAll("#vhMap .vh-grid .hd")].map((x) => x.textContent).join(",") }));
    ok(vh.celdas === 7 * 10 && vh.horas === "12,13,14,15,16,17,18,19,20,21", "el mapa tiene los 7 días y las horas con ventas (12 a 21)");
    ok(/^Sábado 13:00 · Ref 85,20 · 6,5 pedidos$/.test(vh.top) && vh.fuerte >= 1, "la hora más fuerte sale primera y en el tono más oscuro (" + vh.top + ")");
    await page.hover('#vhMap .c[data-k="6-13"]');
    ok(/Sábado 13:00 a 14:00[\s\S]*Ref 85,20 de promedio[\s\S]*8 sábados con ventas/.test(await page.textContent("#vhMap .tip")), "al pasar o tocar un cuadro dice el promedio, los pedidos y cuántos días cuenta");
    await page.click('#vhWeeks [data-w="4"]'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => window.__G.calls.filter((c) => c.rpc === "gestion_ventas_hora").pop().args.p_weeks) === 4, "se puede ver el promedio de 4 semanas");
    // Promociones (Clientes › Promociones)
    await page.click('#secs [data-sec="clientes"]'); await page.click('#tabs [data-tab="promos"]'); await page.waitForTimeout(200);
    ok(/Happy hour[\s\S]*20 %[\s\S]*Lun · Mar · Mié · Jue[\s\S]*3:00 p\. m\. a 6:00 p\. m\./.test(await page.textContent("#promoList")), "Promociones muestra la de happy hour con días y horario");
    await page.click("#addPromo"); await page.waitForSelector("#dlg[open]");
    await page.fill("#f_name", "Martes de ramen"); await page.fill("#f_percent", "15");
    await page.locator("#prDays input").evaluateAll((l) => l.forEach((i) => { i.checked = i.value === "2"; }));
    await page.click('#dlgForm button[type="submit"]'); await page.waitForTimeout(200);
    ok(/categorías o los platos/.test(await page.textContent("#dlgErr")), "pide elegir a qué platos o categorías aplica");
    await page.fill("#prDishQ", "gyo"); await page.waitForTimeout(100);
    ok(await page.locator("#prDishes label:not([hidden])").count() === 1, "el buscador de platos filtra la lista");
    await page.locator("#prDishes label:not([hidden]) input").check();
    await page.click('#dlgForm button[type="submit"]'); await page.waitForTimeout(300);
    const pg = await page.evaluate(() => window.__G.calls.filter((c) => c.rpc === "gestion_promo_guardar").pop());
    ok(pg && pg.args.p.name === "Martes de ramen" && pg.args.p.percent === 15 && JSON.stringify(pg.args.p.days) === "[2]" && pg.args.p.dish_ids.length === 1 && pg.args.p.start_time === "15:00",
      "guarda la promoción con nombre, %, días, horario y platos");
    // Alertas al correo (Dinero › Ventas › Ajustes)
    await page.click('#secs [data-sec="dinero"]'); await page.click('#tabs [data-tab="ventas"]'); await page.waitForTimeout(200);
    ok(await page.isVisible("#sAlerts") && (await page.inputValue("#sAlertDiff")) === "5", "Ajustes tiene los correos de alertas y desde cuánto avisa un cierre (Ref 5)");
    await page.fill("#sAlerts", "dueno@ejemplo.test"); await page.fill("#sAlertDiff", "15"); await page.click("#saveSettings"); await page.waitForTimeout(300);
    ok(await page.evaluate(() => window.__G.calls.some((c) => c.table === "gestion_settings" && c.op === "update" && c.value.alert_emails === "dueno@ejemplo.test" && c.value.alert_cash_diff === 15)),
      "guarda a quién le llegan las alertas y el límite del cierre");
    // Facturas de la caja (Dinero › Gastos)
    await page.click('#tabs [data-tab="gastos"]'); await page.waitForSelector("#facList [data-fac]", { timeout: 5000 });
    ok(/Salida de caja[\s\S]*Compra de hielo · \$ 5,00/.test(await page.textContent("#facList")) && /Agua \(botella\) 12 unidades/.test(await page.textContent("#facList")), "Gastos muestra las facturas de la caja: salida con motivo y mercancía");
    await page.click('#facList [data-fac="1"]'); await page.waitForSelector("#facDlg[open]", { timeout: 3000 });
    ok(await page.evaluate(() => { const c = window.__G.calls.filter((x) => x.storage).pop(); return c.storage === "facturas" && c.path === "2026-11/0123456789abcdef0123456789abcdef.jpg" && c.secs === 300; }) &&
       /^data:image/.test(await page.getAttribute("#facImg", "src")), "«Ver foto» abre la factura con un enlace privado que vence en 5 minutos");
    await page.click("#facClose");
    await page.click('#secs [data-sec="ajustes"]');
    ok(await page.isVisible('#tabs [data-tab="importar"]') && !(await page.isVisible('#tabs [data-tab="recetas"]')), "cada sección muestra solo sus pestañas");
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
    await page.click('#secs [data-sec="cocina"]'); await page.click('#tabs [data-tab="recetas"]'); await page.waitForTimeout(400);
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
