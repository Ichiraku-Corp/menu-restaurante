// Corte de internet en la caja: los pedidos siguen por la laptop (puente simulado) y salen en cocina.
// Uso: node pruebas-navegador/recorrido-sinred.js   (necesita Playwright y Chromium)
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
  await new Promise((r) => server.listen(8797, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  const errores = [], enviados = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8");
  await page.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "supabase-falso.js"), "utf8") }));
  // El puente de la laptop, simulado
  await page.route("**/api/sinred/**", async (r) => {
    const u = new URL(r.request().url()), tk = r.request().headers()["x-sinred"];
    if (tk !== "llave-de-prueba") return r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, error: "sin llave" }) });
    if (u.pathname.endsWith("/estado")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, online: false, pendientes: enviados.length }) });
    if (u.pathname.endsWith("/enviar")) { enviados.push(JSON.parse(r.request().postData())); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, impreso: true }) }); }
    r.fulfill({ status: 404, body: "{}" });
  });
  const S = (fn) => page.evaluate(fn);
  const pin = async (emp, code) => { await page.click(`#people [data-emp="${emp}"]`); for (const k of code) await page.click(`#pad [data-k="${k}"]`); };

  try {
    await page.goto("http://localhost:8797/pos.html");
    await page.fill("#devEmail", "tablet@ejemplo.test"); await page.fill("#devPass", "x"); await page.click("#device button");
    await pin(1, "1111"); await page.waitForSelector("#tablesView:not(.hidden)", { timeout: 5000 });
    await page.waitForTimeout(500);
    ok(await S(() => localStorage.getItem("sr-token") === '"llave-de-prueba"'), "con internet, la tablet guarda la llave de la caja");
    await page.click("#btnUser");

    // Se cae el internet
    await S(() => { window.__OFFLINE = true; });
    await pin(1, "1111"); await page.waitForSelector("#tablesView:not(.hidden)", { timeout: 8000 });
    ok(true, "sin internet, la mesera entra con su PIN (ya había entrado antes en esta tablet)");
    ok(/Sin internet/.test(await page.textContent("#srBar")), "avisa arriba que no hay internet y que sigue por la laptop");
    await page.click('#areas [data-area="Feria"]'); await page.click('#areaBody [data-table] .num:text-is("4")'); await page.waitForSelector("#orderView:not(.hidden)");
    await page.click('#cats button:has-text("Entradas")'); await page.click('#dishes button:has-text("Gyozas")');
    await page.fill("#dishNote", "sin salsa"); await page.click("#dishAdd");
    await page.click("#send"); await page.waitForTimeout(500);
    const e = enviados[0] || {};
    ok(enviados.length === 1 && e.items[0].name === "Gyozas" && e.items[0].notes === "sin salsa" && e.order.label === "Feria 4" && /^sr-\d+$/.test(e.order.tmp),
      "el pedido llega a la laptop con plato, nota y mesa");
    ok(e.emp === 1 && e.pin === "1111", "va con quién lo pidió (el PIN se verifica al subirlo)");
    ok(/Gyozas/.test(await page.textContent("#lines")), "la cuenta muestra lo enviado sin internet");
    await page.click("#back"); await page.waitForTimeout(400);
    ok(await page.locator('#areaBody [data-table]:has(.num:text-is("4"))').evaluate((b) => /Comiendo|Abierta/.test(b.textContent)), "la mesa queda ocupada en el plano");
    await page.click('#areaBody [data-table] .num:text-is("4")'); await page.waitForSelector("#orderView:not(.hidden)");
    await page.click('#cats button:has-text("Entradas")'); await page.click('#dishes button:has-text("Gyozas")'); await page.click("#dishAdd");
    await page.click("#send"); await page.waitForTimeout(500);
    ok(enviados.length === 2 && enviados[1].order.tmp === e.order.tmp && enviados[1].added === true, "lo que se agrega después va a la misma mesa y sale como «agregado»");
    await page.click("#back"); await page.click("#btnUser");
    await pin(1, "9999"); await page.waitForTimeout(400);
    ok(/PIN incorrecto/.test(await page.textContent("#pinErr")), "sin internet, un PIN equivocado no entra");
    await pin(2, "2222"); await page.waitForTimeout(400);
    ok(/ya entró antes/.test(await page.textContent("#pinErr")), "quien nunca entró en esta tablet no puede entrar sin internet");

    // Vuelve el internet
    await S(() => { window.__OFFLINE = false; });
    await page.waitForFunction(() => document.getElementById("srBar").classList.contains("hidden"), null, { timeout: 12000 });
    ok(true, "al volver el internet desaparece el aviso");
  } catch (err) {
    fallos++; console.log("FALLÓ: " + err.message.split("\n")[0]);
  }
  ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  await browser.close(); server.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS SIN INTERNET EN NAVEGADOR PASARON");
})();
