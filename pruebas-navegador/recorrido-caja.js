// Recorre la app de caja en un navegador real con un Supabase falso (supabase-falso.js).
// Uso: node pruebas-navegador/recorrido-caja.js   (necesita Playwright y Chromium)
// Sirve el sitio con un servidor propio en el puerto 8799 y falla si algo no responde como debe.
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
  await new Promise((r) => server.listen(8799, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8");
  await page.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "supabase-falso.js"), "utf8") }));
  const S = (fn) => page.evaluate(fn);
  const pin = async (emp, code) => { await page.click(`#people [data-emp="${emp}"]`); for (const k of code) await page.click(`#pad [data-k="${k}"]`); };

  try {
    // Equipo y PIN
    await page.goto("http://localhost:8799/pos.html");
    await page.fill("#devEmail", "tablet@ejemplo.test"); await page.fill("#devPass", "x"); await page.click("#device button");
    // Asistencia: marcar llegada con el PIN, sin entrar a la tablet
    await page.click("#markMode"); await pin(1, "1111"); await page.waitForSelector("#markDlg[open]", { timeout: 5000 });
    ok(/Llegué/.test(await page.textContent("#markOpts")), "al marcar, le ofrece «Llegué»");
    await page.click('#markOpts [data-mark="in"]'); await page.waitForTimeout(300);
    ok(await S(() => (window.__S.marks || []).some((m) => m.emp === 1 && m.kind === "in")), "la llegada queda marcada");
    ok(!(await page.isVisible("#tablesView")), "marcar no entra a la tablet");
    await S(() => { window.__S.anns = [{ id: 900, title: "Delantal obligatorio", body: "Desde hoy", by: "Gestión", at: new Date().toISOString(), read: [] }]; });
    await pin(2, "2222"); await page.waitForSelector("#tablesView:not(.hidden)", { timeout: 5000 });
    await page.waitForSelector("#annDlg[open]", { timeout: 3000 });
    ok(/Delantal obligatorio/.test(await page.textContent("#annBody")), "al entrar le sale el aviso pendiente");
    await page.click('#annBody [data-annok="900"]'); await page.waitForTimeout(300);
    ok(!(await page.isVisible("#annDlg")) && await S(() => window.__S.anns[0].read.includes(2)), "«Entendido» confirma la lectura y cierra");
    ok(true, "la cajera entra con su PIN");
    ok(await page.isVisible("#health") && await page.locator('#health [data-h="lap"].ok').count() === 1, "arriba se ve Internet · Laptop · Impresora en verde");
    await S(() => { window.__BRIDGE = new Date(Date.now() - 10 * 60000).toISOString(); }); await S(() => refreshState()); await page.waitForTimeout(200);
    ok(await page.locator('#health [data-h="lap"].bad').count() === 1, "si la laptop no se conecta hace rato, «Laptop» se pone en rojo");
    await page.click("#health"); await page.waitForTimeout(250);
    ok(/laptop de caja no se conecta/.test(await page.textContent("#notice")), "al tocar el indicador explica qué pasa y qué revisar");
    await page.waitForTimeout(4500);
    ok(await page.isVisible("#notice"), "el aviso queda fijo arriba (no se va solo)");
    await page.click("#notice [data-nok]"); await page.waitForTimeout(300);
    ok(!(await page.evaluate(() => document.getElementById("notice").classList.contains("show"))), "«Entendido» lo cierra");
    await S(() => { window.__BRIDGE = undefined; }); await S(() => refreshState());
    // La pantalla se apaga y se vuelve a encender (Supabase avisa SIGNED_IN) o se renueva la conexión: la sesión sigue
    await S(() => { window.__authEmit("SIGNED_IN"); window.__authEmit("TOKEN_REFRESHED"); }); await page.waitForTimeout(400);
    ok(await page.isVisible("#tablesView") && !(await page.isVisible("#pin")), "al volver a encender la pantalla no se cierra la sesión");

    // Abrir caja
    await page.click("#btnCaja"); await page.waitForTimeout(200); await page.click("#openCash"); await page.waitForTimeout(300);
    ok(await S(() => !!window.__S.session), "abre la caja");
    await page.click("#cashClose").catch(() => {});

    // Mesa: plato con nota, enviar, cobrar en efectivo
    await page.click('#areas [data-area="Feria"]'); await page.click('#areaBody [data-table] .num:text-is("3")'); await page.waitForSelector("#orderView:not(.hidden)");
    ok(await page.locator('#cats [data-cat="top"].on').count() === 1 && /Gyozas/.test(await page.textContent("#dishes")), "la carta abre en «Lo más pedido»");
    ok(!(await page.isVisible("#cancel")) && !(await page.isVisible("#discount")), "anular y descuento quedan plegados en «Más opciones»");
    await page.click("#moreBtn");
    ok(await page.isVisible("#cancel") && await page.isVisible("#move"), "«Más opciones» muestra dividir, descuento, mover y anular");
    await page.click("#moreBtn");
    await page.click('#cats button:has-text("Entradas")'); await page.click('#dishes button:has-text("Gyozas")');
    ok(await page.isVisible("#dishDlg"), "el plato abre su ventana (cantidad, opción y nota)");
    await page.fill("#dishNote", "sin salsa"); await page.click("#dishAdd");
    await page.click("#send"); await page.waitForTimeout(300);
    ok(await S(() => window.__S.items.some((i) => i.notes === "sin salsa" && i.status === "enviado")), "el plato llega a cocina con su nota");
    await page.click("#pay"); await page.waitForTimeout(200); await page.click('#payMethods [data-m="efectivo_usd"]');
    await page.click('#payLines [data-bill="20"]'); await page.click('#payLines [data-bill="5"]');
    ok((await page.locator("#payLines .amt").first().inputValue()) === "25.00", "billetes $20 + $5 ponen 25 en el monto");
    ok(await page.isDisabled("#payOk") && await page.locator("#changeAsk.need").count() === 1, "con vuelto, no deja confirmar hasta elegir cómo se entrega");
    await page.setViewportSize({ width: 1280, height: 700 }); // tablet Fire HD 8 con la barra del navegador
    const pie = await page.evaluate(() => { const r = document.getElementById("payOk").getBoundingClientRect(); return r.bottom <= window.innerHeight && r.top >= 0; });
    ok(pie, "«Confirmar cobro» queda a la vista en la tablet sin tener que bajar");
    await page.click('#payMethods [data-m="zelle"]'); await page.waitForTimeout(250);
    const visto = await page.evaluate(() => { const l = [...document.querySelectorAll("#payLines .pay")].pop().getBoundingClientRect(), f = document.querySelector("#payDlg .payfoot").getBoundingClientRect(); return l.bottom <= f.top + 1 && l.top >= 0; });
    ok(visto, "el pago recién añadido queda a la vista, sin quedar tapado por el pie fijo");
    await page.locator("#payLines .pay").last().locator(".del").click();
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.click('#changeCur [data-cur="MIX"]');
    // Dos pases de punto: el primero por la mitad, «+ Otro pase» pone lo que falta
    const pagos0 = await page.locator("#payLines .pay").count();
    await page.click('#payMethods [data-m="punto_debito"]');
    ok(/Sobran|Cubre todo/.test(await page.locator("#payLines .pay").nth(pagos0).locator("[data-after]").textContent()), "cada pago dice cuánto queda después de él");
    await page.locator("#payLines .pay").nth(pagos0).locator(".del").click();
    const vuelto = await page.textContent("#payRest");
    ok(/^\$ \d+ \+ Bs/.test(vuelto.trim()), "vuelto mixto: dólares enteros más bolívares (" + vuelto.trim() + ")");
    let aviso = ""; page.once("dialog", (d) => { aviso = d.message(); });
    await page.click("#payOk"); await page.waitForTimeout(400);
    ok(await S(() => window.__S.orders.some((o) => o.status === "cobrada")), "la mesa se cobra en efectivo");
    ok(/Entrega de vuelto: \$ [\d.,]+ \+ Bs/.test(aviso), "avisa el vuelto mixto al cobrar (" + aviso + ")");

    // Mesa abierta por error: se borra al salir
    await page.click('#areas [data-area="Feria"]'); await page.click('#areaBody [data-table] .num:text-is("6")'); await page.waitForSelector("#orderView:not(.hidden)");
    await page.click("#back"); await page.waitForTimeout(300);
    ok(await S(() => !!window.__drop), "una mesa vacía se borra al salir");

    // Delivery de Yummy: sin costo de envío
    await page.click('#areas [data-area="Delivery"]'); await page.click("#newDeliv");
    await page.selectOption("#dChan", "yummy");
    ok(!(await page.isVisible("#dFee")), "en Yummy no se pide costo de delivery");
    await page.fill("#dPhone", "0414-123.45.67"); await page.waitForTimeout(700);
    ok(await page.inputValue("#dName") === "Ana Frecuente" && /casa azul/.test(await page.inputValue("#dAddr")), "con el teléfono se llenan el nombre y la dirección del cliente");
    ok(/3 pedidos[\s\S]*Suele pedir: Gyozas/.test(await page.textContent("#dCard")), "muestra la ficha: pedidos y lo que suele pedir");
    await page.fill("#dPhone", ""); await page.fill("#dAddr", "");
    await page.fill("#dName", "Cliente Yummy"); await page.click("#dOk"); await page.waitForSelector("#orderView:not(.hidden)");
    ok(await S(() => window.__S.orders.some((o) => o.channel === "yummy" && o.delivery_fee === 0)), "el pedido queda como Yummy");
    await page.click("#back"); await page.waitForTimeout(300);

    // Cierre: arqueo con diferencia pide nota
    await page.click("#btnCaja"); await page.waitForTimeout(300);
    ok(await page.isVisible('#cashBody [data-ctab="res"].on') && await page.isVisible("#cashBody [data-ctab=cierre]"), "la caja se abre en «Resumen», con pestañas para cerrar y herramientas");
    await S(() => notice("Prueba de aviso con la caja abierta", "err")); await page.waitForTimeout(300);
    ok(await S(() => { const r = document.getElementById("notice").getBoundingClientRect(), el = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return !!(el && el.closest("#notice")); }),
      "un aviso se ve por encima de la ventana de caja abierta (no queda detrás)");
    await page.click("#notice [data-nok]"); await page.waitForTimeout(300);
    ok(await page.isVisible("#cashDlg") && !(await page.isVisible("#notice")), "«Entendido» cierra el aviso y la caja sigue abierta");
    await S(() => notice("Aviso que debe quedar al cerrar la ventana", "err")); await page.waitForTimeout(250);
    await page.click("#cashClose"); await page.waitForTimeout(350);
    ok(await page.isVisible("#notice") && /quedar al cerrar/.test(await page.textContent("#notice")), "si se cierra la ventana sin tocar «Entendido», el aviso sigue a la vista");
    await page.click("#notice [data-nok]"); await page.waitForTimeout(300);
    await page.click("#btnCaja"); await page.waitForTimeout(300);
    await page.click('#cashBody [data-ctab="tools"]');
    await page.click("#uniBtn"); await page.waitForSelector("#uniDlg[open]");
    await page.click('#uniBody [data-uni="1"] [data-ok="1"]'); await page.waitForTimeout(200);
    ok(await S(() => window.__S.uni && window.__S.uni[1] === true), "la cajera anota el uniforme de quien llegó");
    await page.click("#uniClose");
    ok(await page.locator("#cashBody .banner", { hasText: "Bolívares de hoy" }).count() > 0, "recuerda los bolívares del día en la caja");
    await page.click('#cashBody [data-ctab="cierre"]');
    ok(await page.isVisible('#cashBody .cnt[data-m="efectivo_usd"]') && !(await page.isVisible('#cashBody .cnt[data-m="pago_movil"]')), "el cierre empieza por el efectivo, un paso a la vez");
    ok(await page.isVisible("#cashTotalDiff") && await page.isVisible("#cstepNext"), "la diferencia y «Siguiente» quedan fijos abajo");
    await page.click('#cashBody [data-bills="1"]');
    await page.locator('#cashBody .bcnt[data-den="10"]').fill("1"); await page.locator('#cashBody .bcnt[data-den="5"]').fill("1");
    ok((await page.locator('#cashBody .cnt[data-m="efectivo_usd"]').inputValue()) === "15.00", "contar billetes: 1 de $10 + 1 de $5 = 15");
    await page.click("#cstepNext");
    ok(await page.isVisible('#cashBody .cnt[data-m="pago_movil"]') && /cierre de lote/.test(await page.textContent("#cstepHelp")), "paso 2: bolívares en banco, con la explicación del lote");
    await page.locator('#cashBody .cnt[data-m="pago_movil"]').fill("247.98");
    await page.locator('#cashBody .cnt[data-m="pago_movil"]').dispatchEvent("input");
    ok(await page.locator("#cashBody .cwarn").count() > 0, "avisa si el pago móvil parece escrito en dólares");
    await page.click('#cashBody [data-cstep="5"]');
    ok(await page.isVisible("#doClose") && await page.isVisible("#cashNotes") && await page.isVisible('#cashBody .cnt[data-m="efectivo_usd"]'), "el último paso muestra todo para revisar, la nota y el botón de enviar");
    await page.click("#doClose"); await page.waitForTimeout(300);
    ok(!(await S(() => !!window.__closed)), "no deja cerrar con diferencia grande sin nota");
    ok(await page.isVisible("#closeErr") && /Falta la nota para cerrar/.test(await page.textContent("#closeErr")), "explica junto al botón que falta la nota (no solo un aviso que se va)");
    await page.fill("#cashNotes", "Vuelto dado por pago móvil"); await page.locator("#cashNotes").dispatchEvent("input");
    ok(!(await page.isVisible("#closeErr")), "al escribir la nota desaparece el aviso");
    await page.click("#doClose"); await page.waitForSelector("#repDlg[open]", { timeout: 5000 });
    ok(true, "con la nota escrita, el cierre avanza a la revisión");
  } catch (e) {
    fallos++; console.log("FALLÓ: " + e.message.split("\n")[0]);
  }
  ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  await browser.close(); server.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DEL NAVEGADOR PASARON");
})();
