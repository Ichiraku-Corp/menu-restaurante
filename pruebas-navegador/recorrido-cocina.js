// Pantalla de cocina: la comanda llega con su nota, cocina la marca lista y la mesera la ve y la marca servida.
// Comparte el Supabase falso entre la tablet y la cocina guardando el estado en localStorage.
"use strict";
const fs = require("fs"), path = require("path"), http = require("http");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
let fallos = 0;
function ok(c, m) { if (c) console.log("ok: " + m); else { fallos++; console.log("FALLÓ: " + m); } }
(async () => {
  await new Promise((r) => server.listen(8798, r));
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const errores = [];
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8");
  await ctx.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "supabase-falso.js"), "utf8") }));
  const tablet = await ctx.newPage(); tablet.on("pageerror", (e) => errores.push(e.message)); tablet.on("dialog", (d) => d.accept().catch(() => {}));
  try {
    await tablet.goto("http://localhost:8798/pos.html");
    await tablet.fill("#devEmail", "t@e.test"); await tablet.fill("#devPass", "x"); await tablet.click("#device button");
    await tablet.click('#people [data-emp="2"]'); for (const k of "2222") await tablet.click(`#pad [data-k="${k}"]`);
    await tablet.waitForSelector("#tablesView:not(.hidden)");
    await tablet.click('#areas [data-area="Feria"]'); await tablet.click('#areaBody [data-table] .num:text-is("2")'); await tablet.waitForSelector("#orderView:not(.hidden)");
    await tablet.click('#cats button:has-text("Entradas")'); await tablet.click('#dishes button:has-text("Gyozas")'); await tablet.fill("#dishNote", "bien doradas"); await tablet.click("#dishAdd");
    await tablet.click("#send"); await tablet.waitForTimeout(300);
    // La cocina usa el mismo estado falso: se le pasa por evaluate
    const estado = await tablet.evaluate(() => JSON.stringify(window.__S));
    const cocina = await ctx.newPage(); cocina.on("pageerror", (e) => errores.push(e.message));
    await cocina.addInitScript((st) => { window.__INIT = st; }, estado);
    await cocina.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
      body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "supabase-falso.js"), "utf8") + ";(function(){var s=JSON.parse(window.__INIT);Object.assign(window.__S,s);})();" }));
    await cocina.goto("http://localhost:8798/comandas.html");
    await cocina.fill("#email", "t@e.test"); await cocina.fill("#password", "x"); await cocina.click("#login button");
    await cocina.waitForSelector(".card", { timeout: 5000 });
    ok(/bien doradas/.test(await cocina.textContent("#board")), "la comanda llega a cocina con su nota");
    ok(/\d+:\d\d/.test(await cocina.textContent(".card .t")), "la comanda muestra su tiempo");
    await cocina.click(".card .item"); await cocina.waitForTimeout(300);
    ok(await cocina.locator(".card").count() === 0, "al tocar el plato sale de la pantalla");
    ok(/Gyozas/.test(await cocina.textContent("#recent")), "queda en «Listos» por si hay que deshacer");
    // La tablet recibe el estado de cocina y muestra el aviso
    const listos = await cocina.evaluate(() => JSON.stringify(window.__S.items));
    await tablet.evaluate((it) => { window.__S.items = JSON.parse(it); }, listos);
    await tablet.click("#back"); await tablet.waitForTimeout(5500);
    ok(/listo/.test(await tablet.textContent("#areaBody")), "la mesa muestra el plato listo en la tablet");
    await tablet.click('#areaBody [data-table] .num:text-is("2")'); await tablet.waitForSelector("#orderView:not(.hidden)"); await tablet.waitForTimeout(400);
    ok(await tablet.isVisible("#served"), "la mesera ve «Ya lo serví»");
    await tablet.click("#served"); await tablet.waitForTimeout(300);
    ok(await tablet.evaluate(() => window.__S.items.every((i) => !i.ready_at || i.served_at)), "al tocarlo queda servido");
  } catch (e) { fallos++; console.log("FALLÓ: " + e.message.split("\n")[0]); }
  ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  await browser.close(); server.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DE COCINA EN NAVEGADOR PASARON");
})();
