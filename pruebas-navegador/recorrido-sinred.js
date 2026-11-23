// Corte de internet en la caja: los pedidos siguen por la laptop (puente simulado) y salen en cocina.
// Uso: node pruebas-navegador/recorrido-sinred.js   (necesita Playwright y Chromium)
"use strict";
// Espera sondeando con page.evaluate: page.waitForFunction necesita 'unsafe-eval' para sondear y la política
// de seguridad de la página no lo permite (en GitHub, con Playwright 1.47, fallaba).
async function esperar(pg, fn, arg, ms) {
  const fin = Date.now() + (ms || 5000);
  while (!(await pg.evaluate(fn, arg))) { if (Date.now() > fin) throw new Error("tiempo agotado esperando: " + String(fn).slice(0, 90)); await pg.waitForTimeout(100); }
}
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
  const errores = []; let enviados = [], cobros = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8");
  await page.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "supabase-falso.js"), "utf8") }));
  // El puente de la laptop, simulado
  await page.route("**/api/sinred/**", async (r) => {
    const u = new URL(r.request().url()), tk = r.request().headers()["x-sinred"];
    if (tk !== "llave-de-prueba") return r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, error: "sin llave" }) });
    if (u.pathname.endsWith("/estado")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, online: false, pendientes: enviados.length + cobros.length }) });
    if (u.pathname.endsWith("/enviar")) { enviados.push(JSON.parse(r.request().postData())); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, impreso: true }) }); }
    if (u.pathname.endsWith("/cobrar")) { cobros.push(JSON.parse(r.request().postData())); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, impreso: true }) }); }
    if (u.pathname.endsWith("/pedidos")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true,
      pedidos: enviados.map((x) => ({ type: "comanda", uuid: x.uuid, at: new Date().toISOString(), emp_name: x.emp_name, order: x.order, items: x.items }))
        .concat(cobros.map((x) => ({ type: "pago", uuid: x.uuid, order: x.order, lines: x.lines, total: x.total }))) }) });
    r.fulfill({ status: 404, body: "{}" });
  });
  const S = (fn) => page.evaluate(fn);
  const pin = async (emp, code) => { for (const k of code) await page.click(`#pad [data-k="${k}"]`); };

  try {
    await page.goto("http://localhost:8797/pos.html");
    await page.fill("#devEmail", "tablet@ejemplo.test"); await page.fill("#devPass", "x"); await page.click("#device button");
    await pin(1, "1111"); await page.waitForSelector("#tablesView:not(.hidden)", { timeout: 5000 });
    ok(!(await page.isVisible("#summary .s.meta")) && !(await page.evaluate(() => window.__metaCalls || 0)), "la mesera no ve la meta del día (ni la pide)");
    ok(!(await page.isVisible("#summary .s")), "a quien atiende mesas no le salen las cifras de caja: el mapa le queda entero");
    await page.waitForTimeout(500);
    ok(await S(() => localStorage.getItem("sr-token") === '"llave-de-prueba"'), "con internet, la tablet guarda la llave de la caja");
    await page.click("#btnUser");
    // Con internet: la cajera abre la caja y cobra una mesa más tarde (Feria 2, abierta con internet)
    await pin(2, "2222"); await page.waitForSelector("#tablesView:not(.hidden)", { timeout: 5000 }); await page.waitForTimeout(300);
    if (await page.isVisible("#annDlg")) await page.keyboard.press("Escape");
    await page.click("#btnCaja"); await page.waitForTimeout(200); await page.click("#openCash"); await page.waitForTimeout(300); await page.click("#cashClose").catch(() => {});
    await page.click('#areas [data-area="Feria"]'); await page.click('#areaBody [data-table] .num:text-is("2")'); await page.waitForSelector("#orderView:not(.hidden)");
    await page.click('#cats button:has-text("Entradas")'); await page.click('#dishes button:has-text("Gyozas")'); await page.click("#send"); await page.waitForTimeout(400);
    const feria2 = await S(() => cur.order);
    await page.click("#back"); await page.waitForTimeout(300); await page.click("#btnUser");

    // Se cae el internet
    await S(() => { window.__OFFLINE = true; });
    await pin(1, "1111"); await page.waitForSelector("#tablesView:not(.hidden)", { timeout: 8000 });
    ok(true, "sin internet, la mesera entra con su PIN (ya había entrado antes en esta tablet)");
    ok(/Sin internet/.test(await page.textContent("#srBar")), "avisa arriba que no hay internet y que sigue por la laptop");
    await page.click('#areas [data-area="Feria"]'); await page.click('#areaBody [data-table] .num:text-is("4")'); await page.waitForSelector("#orderView:not(.hidden)");
    await page.click('#cats button:has-text("Entradas")'); await page.click('#dishes button:has-text("Gyozas")', { button: "right" });
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
    await page.click('#cats button:has-text("Entradas")'); await page.click('#dishes button:has-text("Gyozas")');
    await page.click("#send"); await page.waitForTimeout(500);
    ok(enviados.length === 2 && enviados[1].order.tmp === e.order.tmp && enviados[1].added === true, "lo que se agrega después va a la misma mesa y sale como «agregado»");
    await page.click("#back"); await page.click("#btnUser");
    await pin(1, "9999"); await page.waitForTimeout(400);
    ok(/PIN incorrecto/.test(await page.textContent("#pinErr")), "sin internet, un PIN equivocado no entra");
    await pin(3, "3333"); await page.waitForTimeout(400);
    ok(/ya entró antes/.test(await page.textContent("#pinErr")), "quien nunca entró en esta tablet no puede entrar sin internet");

    // Parte 2: la cajera cobra sin internet la mesa abierta sin internet (Feria 4)
    await pin(2, "2222"); await page.waitForSelector("#tablesView:not(.hidden)", { timeout: 8000 }); await page.waitForTimeout(400);
    await page.click('#areas [data-area="Feria"]'); await page.click('#areaBody [data-table] .num:text-is("4")'); await page.waitForSelector("#orderView:not(.hidden)"); await page.waitForTimeout(300);
    ok(await page.isVisible("#pay") && !(await page.isDisabled("#pay")), "sin internet la cajera puede cobrar (entró antes con internet y tiene permiso)");
    await page.click("#pay"); await page.waitForSelector("#payDlg[open]");
    ok(!(await page.locator('#payMethods [data-m="cuenta"]').count()) && !(await page.isVisible("#paySplit")) && !(await page.isVisible("#payByPerson")) && /recibo sale en la laptop/.test(await page.textContent("#payErr")),
      "sin internet se cobra la cuenta completa: sin «a cuenta», partes ni por persona, y avisa que el recibo sale en la laptop");
    await page.click('#payMethods [data-m="efectivo_usd"]'); await page.click('#payLines [data-bill="20"]'); await page.click('#changeCur [data-cur="REF"]');
    await page.click("#payOk"); await page.waitForTimeout(600);
    const c1 = cobros[0] || {};
    ok(cobros.length === 1 && c1.order.tmp === e.order.tmp && c1.lines[0].method === "efectivo_usd" && c1.lines[0].amount === 20 && c1.total === 11 && c1.emp === 2 && c1.change_currency === "REF" && c1.change.currency === "REF" && c1.change.amount === 9 && /\$ 9,00/.test(c1.change.text),
      "el cobro llega a la laptop: cuenta, pago, total (Ref 11), vuelto y quién cobró");
    ok(c1.items.length === 2 && c1.items.every((i) => i.name === "Gyozas"), "con los platos para el recibo");
    await page.waitForTimeout(400);
    ok(!(await page.locator('#areaBody [data-table]:has(.num:text-is("4"))').evaluate((b) => /Comiendo|Abierta/.test(b.textContent))), "la mesa queda libre en el plano");
    // Y la mesa abierta con internet antes del corte (Feria 2): se cobra con sus platos guardados
    await page.click('#areaBody [data-table] .num:text-is("2")'); await page.waitForSelector("#orderView:not(.hidden)"); await page.waitForTimeout(300);
    ok(/Gyozas/.test(await page.textContent("#lines")), "la cuenta abierta con internet se ve con sus platos");
    await page.click("#pay"); await page.waitForSelector("#payDlg[open]"); await page.click('#payMethods [data-m="punto_debito"]'); await page.click("#payOk"); await page.waitForTimeout(600);
    const c2 = cobros[1] || {};
    ok(cobros.length === 2 && c2.order.id === feria2 && c2.lines[0].method === "punto_debito" && c2.total === 5.5, "la cuenta que ya existía se cobra sin internet con su número (Ref 5,50 por punto)");

    // Vuelve el internet: mientras la laptop sube lo de sin internet, no se cobra de nuevo
    await S(() => { window.__OFFLINE = false; });
    await esperar(page, () => /Subiendo lo hecho sin internet/.test(document.getElementById("srBar").textContent), null, 15000);
    ok(true, "al volver el internet avisa que se está subiendo lo de sin internet");
    await page.click('#areas [data-area="Feria"]'); await page.click('#areaBody [data-table] .num:text-is("2")'); await page.waitForSelector("#orderView:not(.hidden)"); await page.waitForTimeout(300);
    await page.click("#pay"); await page.waitForTimeout(300);
    if (await page.isVisible("#cliDlg")) { await page.fill("#cPhone", "04241112233"); await page.fill("#cName", "Cliente Prueba"); await page.click("#cOk"); }   // con internet se piden los datos del cliente
    await page.waitForSelector("#payDlg[open]"); await page.click('#payMethods [data-m="punto_debito"]'); await page.click("#payOk"); await page.waitForTimeout(400);
    ok(/ya se cobró sin internet/.test(await page.textContent("#payErr")) && await S((x) => !window.__S.payments.some((p) => p.order_id === x), feria2), "no deja cobrar otra vez la cuenta que se cobró sin internet");
    await page.click("#payCancel"); await page.click("#back");
    enviados = []; cobros = [];   // la laptop terminó de subir
    await esperar(page, () => document.getElementById("srBar").classList.contains("hidden"), null, 12000);
    ok(true, "al terminar de subir desaparece el aviso");
  } catch (err) {
    fallos++; console.log("FALLÓ: " + err.message.split("\n")[0]);
  }
  ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  await browser.close(); server.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS SIN INTERNET EN NAVEGADOR PASARON");
})();
