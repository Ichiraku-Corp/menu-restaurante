// Carta pública: logo, tasa del día y precios también en bolívares (y que sin tasa todo siga igual).
// Uso: node pruebas-navegador/recorrido-carta.js
"use strict";
// Espera sondeando con page.evaluate: page.waitForFunction necesita 'unsafe-eval' para sondear y la política
// de seguridad de la página no lo permite (en GitHub, con Playwright 1.47, fallaba).
async function esperar(pg, fn, arg, ms) {
  const fin = Date.now() + (ms || 5000);
  while (!(await pg.evaluate(fn, arg))) { if (Date.now() > fin) throw new Error("tiempo agotado esperando: " + String(fn).slice(0, 90)); await pg.waitForTimeout(100); }
}
const fs = require("fs"), path = require("path"), http = require("http"), { chromium } = require("playwright");
const ROOT = path.join(__dirname, ".."); let fallos = 0;
function ok(c, m) { if (c) console.log("ok: " + m); else { fallos++; console.log("FALLÓ: " + m); } }
const T = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const srv = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
});
const m = JSON.parse(fs.readFileSync(path.join(ROOT, "data/menu.json"), "utf8"));
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });

(async () => {
  await new Promise((r) => srv.listen(8799, r));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 400, height: 820 } });
  const p = await ctx.newPage();
  const err = []; p.on("pageerror", (e) => err.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.route("**/config.js", (r) => r.fulfill({ contentType: "application/javascript", body:
    'window.MENU_CONFIG={SUPABASE_URL:"https://krjryvtnzgwwhanmbdrn.supabase.co",SUPABASE_ANON_KEY:"anon",RESTAURANT_NAME:"Ichiraku Ramen",TAGLINE:"Ramen",PRICE_PREFIX:"Ref",CURRENCY:"USD",LOCALE:"es-VE",SERVICE_PERCENT:10,ORDER_ACTIONS:false};' }));
  // Misma dirección que la carta real, interceptada: nunca sale a internet.
  let tasa = { rate: 100, date: hoy }, promos = [];
  await p.route("https://krjryvtnzgwwhanmbdrn.supabase.co/**", (r) => {
    const u = r.request().url();
    if (u.includes("/rpc/menu_tasa")) return tasa ? r.fulfill({ contentType: "application/json", body: JSON.stringify(tasa) }) : r.fulfill({ status: 404, body: "" });
    if (u.includes("/rpc/menu_promos")) return r.fulfill({ contentType: "application/json", body: JSON.stringify(promos) });
    return r.fulfill({ contentType: "application/json", body: JSON.stringify(u.includes("/categories") ? m.categories : m.dishes) });
  });

  await p.goto("http://localhost:8799/index.html"); await p.waitForSelector("#menu article");
  ok(await p.evaluate(() => { const i = document.querySelector("header .brandlogo"); return i && i.complete && i.naturalWidth > 0; }), "se ve el logo del gato arriba");
  ok((await p.textContent("#name")) === "Ichiraku Ramen", "con el nombre del restaurante");
  ok((await p.textContent("#tasa")) === "Tasa euro BCV de hoy: Bs 100,00 por 1 €", "muestra la tasa del día (" + (await p.textContent("#tasa")) + ")");
  const gyo = p.locator("article", { hasText: "Gyozas" }).first();
  ok(JSON.stringify(await gyo.locator(".pbs").allTextContents()) === '["Bs 500"]', "Gyozas (Ref 5) también dice Bs 500 al lado del precio");
  const pollo = p.locator("article", { hasText: "Pollo Kobayashi" }).first();
  // Cada precio en su esfera: el tamaño como etiqueta, «REF» pequeño, el número grande y debajo su equivalente en Bs
  const esferas = await pollo.locator(".prow").evaluateAll((rs) => rs.map((r) => ["b", "i", "em", ".pbs"].map((q) => r.querySelector(q).textContent).join(" ")));
  ok(JSON.stringify(esferas) === '["Peq REF 8 Bs 800","Gr REF 15 Bs 1.500"]', "los platos con tamaños dicen el precio de cada uno en su esfera y en Bs (" + esferas.join(" | ") + ")");
  ok(await p.evaluate(() => { const s = [...document.querySelectorAll("#menu section")], m = (t) => s.find((x) => x.querySelector("h2").textContent.startsWith(t)).dataset.maid;
    return m("Ramen") === "miso" && m("Bebidas") === "dango" && m("Postres") === "dango" && m("Entradas") === "imo" && m("Sushi") === "imo"; }),
    "cada categoría lleva el color de su maid: Ramen = Miso, Bebidas y Postres = Dango, Entradas y Sushi = Imo");
  ok(await p.evaluate(() => [...document.querySelectorAll("#menu .dish .photo")].every((i) => i.parentElement.classList.contains("plate"))), "cada foto va en su platito");

  // El total del pedido también en bolívares (Ref 5 + 10 % de servicio = Ref 5,50 = Bs 550)
  await p.evaluate(() => localStorage.setItem("menu-order-v1", JSON.stringify([{ id: 4, v: "", o: "", n: "", q: 1 }])));
  await p.reload(); await p.waitForSelector("#menu article");
  await p.click("#orderbar"); await p.waitForSelector("#orderSheet[open]");
  ok(/Bs 550$/.test(await p.textContent("#osTotal")), "el total del pedido también sale en Bs (" + (await p.textContent("#osTotal")) + ")");
  await p.keyboard.press("Escape");

  // Al volver otro día con la misma carta, se actualiza la tasa (no se queda la guardada en el teléfono)
  tasa = { rate: 120, date: hoy };
  await p.reload(); await esperar(p, () => /120,00/.test(document.getElementById("tasa").textContent)).catch(() => {});
  ok((await p.textContent("#tasa")).includes("Bs 120,00") && /Bs 600/.test(await gyo.textContent()), "si cambia la tasa, la carta guardada en el teléfono se actualiza");

  // Fin de semana: la tasa del viernes sigue valiendo («vigente»). Si es más vieja, dice de qué día es.
  const antes = (n) => new Date(Date.parse(hoy) - n * 864e5).toISOString().slice(0, 10);
  tasa = { rate: 120, date: antes(2) };
  await p.reload(); await esperar(p, () => /vigente/.test(document.getElementById("tasa").textContent)).catch(() => {});
  ok((await p.textContent("#tasa")) === "Tasa euro BCV vigente: Bs 120,00 por 1 €", "en fin de semana dice «vigente» con la tasa del viernes");
  tasa = { rate: 120, date: antes(6) };
  const dm = antes(6).slice(8, 10) + "/" + antes(6).slice(5, 7);
  await p.reload(); await esperar(p, (x) => document.getElementById("tasa").textContent.includes("del " + x), dm).catch(() => {});
  ok((await p.textContent("#tasa")).startsWith("Tasa euro BCV del " + dm), "si la tasa es vieja, dice de qué día es (" + (await p.textContent("#tasa")) + ")");

  // Promoción de hoy: banner arriba, precio tachado con el nuevo (y su Bs) y el total del pedido con la promo
  promos = [{ id: 1, name: "Happy hour", percent: 20, start: "00:00", end: "23:59", dish_ids: [], category_ids: [1], ahora: true },
            { id: 2, name: "Noche", percent: 10, start: "00:00", end: "23:58", dish_ids: [], category_ids: [], ahora: true }];
  await p.reload(); await esperar(p, () => !document.getElementById("promoBar").hidden).catch(() => {});
  const barra = await p.textContent("#promoBar");
  ok(/Happy hour: 20 % menos en Entradas · todo el día[\s\S]*¡Ahora!/.test(barra), "arriba anuncia la promoción de hoy y que vale ahora (todo el día)");
  if (new Date(Date.now() - 4 * 3600e3).toISOString().slice(11, 16) < "23:58") ok(/Noche: 10 % menos en platos seleccionados · hoy de 12:00 a\. m\. a 11:58 p\. m\./.test(barra), "con horario, dice de qué hora a qué hora");
  const gyoP = p.locator("article", { hasText: "Gyozas" }).first();
  ok(/Happy hour -20 %/.test(await gyoP.textContent()) && (await gyoP.locator(".price s").textContent()) === "5" && (await gyoP.locator(".price em").textContent()) === "4" &&
     (await gyoP.locator(".pbs").textContent()) === "Bs 480", "el plato muestra la promo, el precio normal tachado, el nuevo y su Bs");
  await p.click("#orderbar"); await p.waitForSelector("#orderSheet[open]");
  ok(/Ref 4\.4 · Bs 528$/.test(await p.textContent("#osTotal")), "el total del pedido sale con la promoción (" + (await p.textContent("#osTotal")) + ")");
  await p.keyboard.press("Escape");
  promos = [];

  // Sin tasa (servidor sin la función o sin internet para eso): la carta sale igual, solo en Ref
  tasa = null;
  await p.reload(); await esperar(p, () => document.getElementById("tasa").hidden).catch(() => {});
  ok(await p.isHidden("#tasa") && !(await p.locator(".pbs").count()), "sin tasa no muestra bolívares");
  ok((await gyo.locator(".price i").textContent()) === "REF" && (await gyo.locator(".price em").textContent()) === "5", "y la carta se ve igual en Ref");
  const dibujos = await p.$$eval("main section > h2", (l) => l.map((h) => { const i = h.querySelector("img.dibujo"); return h.firstChild.textContent.trim() + ":" + (i && i.complete && i.naturalWidth > 0 ? i.getAttribute("src").split("/").pop() : "-"); }));
  ok(dibujos.length > 0 && dibujos.every((t) => !/:-$/.test(t)) && dibujos.some((t) => /^Entradas:gyoza\.svg$/.test(t)), "cada sección trae su dibujo (" + dibujos.join(", ") + ")");
  const bien = await p.evaluate(() => { const b = document.querySelector(".bienvenida"); if (!b) return null;
    return { imgs: [...b.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth > 0).length, links: [...b.querySelectorAll(".nombres a")].map((a) => a.firstChild.textContent.trim() + ">" + (document.querySelector(a.getAttribute("href") + " > h2") || { firstChild: { textContent: "?" } }).firstChild.textContent.trim()) }; });
  ok(bien && bien.imgs === 3 && bien.links.join(",") === "Miso>Ramen,Dango>Postres,Imo>Entradas", "la bienvenida trae a las tres maids y cada una lleva a su parte (" + (bien ? bien.links.join(", ") : "no está") + ")");
  ok(err.length === 0, "sin errores de JavaScript" + (err.length ? ": " + err.join(" | ") : ""));
  await b.close(); srv.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DE LA CARTA PASARON");
})();
