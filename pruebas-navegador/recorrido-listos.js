// Pantalla de pedidos para llevar: «Preparando» → «¡Listo!» → sale al entregarlo. Los pedidos de mesa no salen.
"use strict";
const fs = require("fs"), path = require("path"), http = require("http");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
let fallos = 0;
function ok(c, m) { if (c) console.log("ok: " + m); else { fallos++; console.log("FALLÓ: " + m); } }
// Espera sin page.waitForFunction (falla en GitHub por la política de seguridad de la página)
async function esperar(page, fn, arg, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(150); } throw new Error("tiempo agotado esperando"); }
(async () => {
  await new Promise((r) => server.listen(8799, r));
  const browser = await chromium.launch(), page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errores = []; page.on("pageerror", (e) => errores.push(e.message));
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8"), ahora = new Date().toISOString();
  const estado = { orders: [{ id: 51, kind: "llevar", status: "abierta", day_number: 12 }, { id: 52, kind: "llevar", status: "cobrada", day_number: 15 }, { id: 53, kind: "mesa", status: "abierta", day_number: 16 }],
    items: [{ id: 501, order_id: 51, name: "Ramen", qty: 1, status: "enviado", sent_at: ahora }, { id: 502, order_id: 52, name: "Gyozas", qty: 2, status: "enviado", sent_at: ahora, ready_at: ahora },
            { id: 503, order_id: 53, name: "Sushi", qty: 1, status: "enviado", sent_at: ahora }] };
  await page.addInitScript((st) => { window.__INIT = st; }, JSON.stringify(estado));
  await page.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "supabase-falso.js"), "utf8") + ";(function(){var s=JSON.parse(window.__INIT);Object.assign(window.__S,s);})();" }));
  await page.route("**/vendor/sentry-*/**", (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  try {
    await page.goto("http://localhost:8799/listos.html");
    await page.fill("#email", "sala@e.test"); await page.fill("#password", "x"); await page.click("#login button");
    await esperar(page, () => /12/.test(document.getElementById("prep").textContent));
    ok(/^\s*12\s*$/.test(await page.textContent("#prep")), "«Preparando» muestra el número del pedido para llevar (12)");
    ok(/15/.test(await page.textContent("#ready")) && !/16/.test((await page.textContent("#prep")) + (await page.textContent("#ready"))), "«¡Listo!» muestra el 15; los pedidos de mesa (16) no salen");
    await page.click("#sound"); ok(/Sonido activo/.test(await page.textContent("#sound")), "se activa el sonido con un toque");
    await page.evaluate(() => { window.__S.items.find((i) => i.id === 501).ready_at = new Date().toISOString(); });
    await esperar(page, () => /12/.test(document.getElementById("ready").textContent));
    ok(await page.isVisible("#ready .num.new") && !/12/.test(await page.textContent("#prep")), "cuando cocina lo marca listo, el 12 pasa a «¡Listo!» resaltado");
    await page.evaluate(() => { window.__S.items.find((i) => i.id === 502).served_at = new Date().toISOString(); });
    await esperar(page, () => !/15/.test(document.getElementById("ready").textContent));
    ok(true, "al entregarlo en la caja, el 15 sale de la pantalla");
    ok(/\d{1,2}:\d{2}/.test(await page.textContent("#clock")), "muestra la hora");
  } catch (e) { fallos++; console.log("FALLÓ: " + e.message.split("\n")[0]); }
  ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  await browser.close(); server.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DE LA PANTALLA DE PEDIDOS LISTOS PASARON");
})();
