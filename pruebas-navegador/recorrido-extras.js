// Extras de los platos: en la ventanita del ramen se marcan los extras (con su precio) y quedan colgados del plato;
// un extra pedido después pregunta «¿Para cuál plato?»; anular el plato se lleva sus extras; la cocina los ve dentro del plato.
// También: el botón de pantalla completa está desde la pantalla del PIN.
// Uso: node pruebas-navegador/recorrido-extras.js
"use strict";
const fs = require("fs"), path = require("path"), http = require("http");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
let fallos = 0;
function ok(c, m) { if (c) console.log("ok: " + m); else { fallos++; console.log("FALLÓ: " + m); } }
// La carta de prueba con la categoría «Extras» (es_extra) y Ramen/Especiales que los ofrecen (con_extras)
const M = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8"));
M.categories.forEach((c) => { if (c.name === "Ramen" || c.name === "Especiales") c.con_extras = true; });
M.categories.push({ id: 70, name: "Extras", subtitle: "トッピング", position: 3.5, es_extra: true });
M.categories.sort((a, b) => a.position - b.position);
M.dishes.push({ id: 701, category_id: 70, name: "Extra pollo", price: 4, variants: [], options: [], available: true, position: 1, tags: ["solo-caja"] },
              { id: 702, category_id: 70, name: "Extra huevo", price: 1, variants: [], options: [], available: true, position: 2, tags: ["solo-caja"] });
const menu = JSON.stringify(M);
const falso = () => "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "supabase-falso.js"), "utf8");
(async () => {
  await new Promise((r) => server.listen(8801, r));
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const errores = [];
  await ctx.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript", body: falso() }));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errores.push(e.message)); p.on("dialog", (d) => d.accept().catch(() => {}));
  const items = () => p.evaluate(() => window.__S.items.map((i) => ({ id: i.id, name: i.name, variant: i.variant, qty: i.qty, unit_price: i.unit_price, status: i.status, extra_de: i.extra_de || null })));
  try {
    await p.goto("http://localhost:8801/pos.html");
    await p.fill("#devEmail", "t@e.test"); await p.fill("#devPass", "x"); await p.click("#device button");
    await p.waitForSelector("#pin:not(.hidden)");
    // 0) Pantalla completa: el botón ya está en la pantalla del PIN (antes, solo después de entrar)
    ok(await p.isVisible("#btnFull"), "el botón de pantalla completa está en la pantalla del PIN");
    await p.click('#people [data-emp="1"]'); for (const k of "1111") await p.click(`#pad [data-k="${k}"]`);
    await p.waitForSelector("#tablesView:not(.hidden)");
    if (await p.isVisible("#annDlg")) await p.keyboard.press("Escape");
    ok(await p.isVisible("#btnFull"), "y sigue arriba con la sesión abierta");
    await p.click('#areas [data-area="Feria"]'); await p.click('#areaBody [data-table] .num:text-is("2")'); await p.waitForSelector("#orderView:not(.hidden)");

    // 0b) Las secciones del pedido: en pantalla ancha (la caja) se ven todas, Bebidas incluida; en la tablet avisa que hay más
    const secciones = () => p.evaluate(() => { const c = document.getElementById("cats"), cr = c.getBoundingClientRect();
      return { ocultas: [...c.querySelectorAll("button")].filter((b) => { const r = b.getBoundingClientRect(); return r.right > cr.right + 1 || r.left < cr.left - 1; }).map((b) => b.textContent.trim()),
               mas: c.classList.contains("mas"), desborda: c.scrollWidth > c.clientWidth + 4 }; });
    let sec = await secciones();
    ok(!sec.ocultas.length && /Bebidas/.test(await p.textContent("#cats")), "en pantalla ancha se ven todas las secciones, Bebidas incluida (" + sec.ocultas.join(", ") + ")");
    await p.setViewportSize({ width: 960, height: 600 }); await p.waitForTimeout(200); sec = await secciones();
    ok(!sec.desborda || sec.mas, "en la tablet, si no caben, un degradado avisa que hay más secciones");
    await p.setViewportSize({ width: 1180, height: 900 }); await p.waitForTimeout(200);

    // 1) Teuchi Gr con pollo y huevo desde la ventanita
    await p.click('#cats button:has-text("Ramen")'); await p.click('#dishes button:has-text("Teuchi")');
    await p.waitForSelector("#dishDlg[open]");
    const chips = await p.textContent("#dishExtras");
    ok(/Pollo/.test(chips) && /\+Ref 4,00/.test(chips) && /Huevo/.test(chips) && /\+Ref 1,00/.test(chips), "la ventanita del ramen trae los extras con su precio");
    await p.click('#dishVariants [data-v="Gr"]'); await p.click('#dishExtras button:has-text("Pollo")'); await p.click('#dishExtras button:has-text("Huevo")');
    ok((await p.textContent("#dishAdd")) === "Añadir con 2 extras", "el botón dice «Añadir con 2 extras»");
    await p.click("#dishAdd"); await p.waitForTimeout(150);
    const subs = await p.$$eval("#lines .line.new.sub", (l) => l.map((x) => x.textContent));
    ok(subs.length === 2 && /\+ Extra pollo/.test(subs[0]) && /\+ Extra huevo/.test(subs[1]), "en la cuenta, los extras salen debajo del ramen (" + subs.length + ")");
    ok(/Ref 20,00/.test(await p.textContent("#totals")), "el total suma los extras: 15 + 4 + 1 = Ref 20");
    await p.click("#send"); await p.waitForTimeout(400);
    let it = await items();
    const teu = it.find((i) => i.name === "Teuchi");
    ok(teu && it.filter((i) => i.extra_de === teu.id).length === 2 && it.find((i) => i.name === "Extra pollo").unit_price === 4, "al enviar, los dos extras quedan colgados del ramen en el servidor");
    ok((await p.$$("#lines .line.sub")).length === 2, "después de enviar, la cuenta los sigue mostrando debajo del ramen");

    // 2) Un huevo más después: hay un solo plato con extras → va a ese, sin preguntar
    await p.click('#cats button:has-text("Extras")'); await p.click('#dishes button:has-text("Extra huevo")'); await p.waitForTimeout(150);
    ok(!(await p.isVisible("#paraDlg")) && /para 1 Teuchi Gr/.test(await p.textContent("#lines .line.new")), "con un solo plato, el extra va a ese y lo dice («para 1 Teuchi Gr»)");
    await p.click("#send"); await p.waitForTimeout(400);
    it = await items();
    ok(it.filter((i) => i.extra_de === teu.id).length === 3, "el huevo de después también queda colgado del ramen");

    // 3) Con dos platos, pregunta para cuál
    await p.click('#cats button:has-text("Ramen")'); await p.click('#dishes button:has-text("Kakashi")'); await p.click('#dishVariants [data-v="Peq"]'); await p.click("#dishAdd");
    await p.click('#cats button:has-text("Extras")'); await p.click('#dishes button:has-text("Extra pollo")');
    await p.waitForSelector("#paraDlg[open]");
    const opciones = await p.$$eval("#paraList button", (l) => l.map((x) => x.textContent));
    ok(opciones.length === 2 && opciones.some((t) => /Kakashi Peq/.test(t) && /sin enviar/.test(t)) && opciones.some((t) => /Teuchi Gr/.test(t) && /en cocina/.test(t)),
      "con dos platos pregunta «¿Para cuál plato?» (" + opciones.join(" | ") + ")");
    await p.click('#paraList button:has-text("Kakashi")'); await p.waitForTimeout(150);
    ok((await p.$$("#lines .line.new.sub")).length === 1, "el pollo queda debajo del Kakashi sin enviar");
    await p.click("#send"); await p.waitForTimeout(400);
    it = await items();
    const kak = it.find((i) => i.name === "Kakashi");
    ok(kak && it.some((i) => i.name === "Extra pollo" && i.extra_de === kak.id), "al enviar, el pollo queda colgado del Kakashi");

    // 4) La cocina ve los extras dentro de su plato
    const estado = await p.evaluate(() => JSON.stringify(window.__S));
    const cocina = await ctx.newPage(); cocina.on("pageerror", (e) => errores.push(e.message));
    await cocina.addInitScript((st) => { window.__INIT = st; }, estado);
    await cocina.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript", body: falso() + ";(function(){var s=JSON.parse(window.__INIT);Object.assign(window.__S,s);})();" }));
    await cocina.goto("http://localhost:8801/comandas.html");
    await cocina.fill("#email", "t@e.test"); await cocina.fill("#password", "x"); await cocina.click("#login button");
    await cocina.waitForSelector(".card", { timeout: 5000 });
    const botones = await cocina.$$eval(".card .item", (l) => l.map((x) => x.textContent));
    const bTeu = botones.find((t) => /Teuchi/.test(t)) || "", bKak = botones.find((t) => /Kakashi/.test(t)) || "";
    ok(botones.length === 2 && /\+ Extra pollo/.test(bTeu) && /\+ Extra huevo/.test(bTeu) && /\+ Extra pollo/.test(bKak), "en cocina cada ramen trae sus extras adentro (2 botones, no 6)");
    await cocina.click('.card .item:has-text("Teuchi")'); await cocina.waitForTimeout(300);
    const listos = await cocina.evaluate(() => window.__S.items.filter((i) => i.ready_at).map((i) => i.name));
    ok(listos.length === 4 && listos.filter((n) => /Extra/.test(n)).length === 3, "al tocar el ramen listo, sus tres extras quedan listos con él");
    await cocina.close();

    // 5) Anular el Teuchi se lleva sus extras
    await p.click('#lines .line.click:not(.sub):has-text("Teuchi")');
    await p.waitForSelector("#askDlg[open]");
    ok(/y sus 3 extras/.test(await p.textContent("#askTitle")) && /Sus extras también se anulan/.test(await p.textContent("#askHelp")), "al anular el ramen avisa que se van sus 3 extras");
    await p.fill("#askInput", "Se equivocó de ramen"); await p.click("#askOk"); await p.waitForTimeout(400);
    it = await items();
    ok(it.filter((i) => i.extra_de === teu.id).every((i) => i.status === "anulado") && it.find((i) => i.id === teu.id).status === "anulado", "el ramen y sus extras quedan anulados");
    ok(/Ref 14,00/.test(await p.textContent("#totals")), "la cuenta queda con el Kakashi y su pollo: 10 + 4 = Ref 14");

    // 6) Quitar un extra marcado antes de enviar (tocarlo en la cuenta)
    await p.click('#cats button:has-text("Ramen")'); await p.click('#dishes button:has-text("Tonkotsu")'); await p.click('#dishVariants [data-v="Peq"]');
    await p.click('#dishExtras button:has-text("Huevo")'); await p.click("#dishAdd"); await p.waitForTimeout(100);
    await p.click("#lines .line.new.sub"); await p.waitForTimeout(100);
    ok((await p.$$("#lines .line.new.sub")).length === 0 && /Tonkotsu/.test(await p.textContent("#lines")), "tocar el extra sin enviar lo quita y el ramen queda");
    ok(errores.length === 0, "sin errores en la página" + (errores.length ? ": " + errores.join(" | ") : ""));
  } catch (e) { fallos++; console.log("FALLÓ: " + e.message); }
  await browser.close(); server.close();
  console.log(fallos ? fallos + " FALLARON" : "PASARON TODAS"); process.exit(fallos ? 1 : 0);
})();
