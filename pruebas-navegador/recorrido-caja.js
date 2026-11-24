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
  let autoDialog = true;  // las pruebas que necesitan responder un diálogo a mano lo apagan un momento
  page.on("dialog", (d) => { if (autoDialog) d.accept().catch(() => {}); });
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8");
  await page.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "supabase-falso.js"), "utf8") }));
  const S = (fn) => page.evaluate(fn);
  const pin = async (emp, code) => { for (const k of code) await page.click(`#pad [data-k="${k}"]`); };

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
    const meta = await page.textContent("#summary .s.meta").catch(() => "");
    ok(/Meta de hoy · 71 %/.test(meta) && /Ref 320/.test(meta) && /de Ref 450/.test(meta) && await page.isVisible("#summary .s.meta .bar i"),
      "quien cobra ve la meta del día con su barra (Ref 320 de Ref 450, 71 %)");
    ok(!(await page.isVisible("#annDlg")) && await S(() => window.__S.anns[0].read.includes(2)), "«Entendido» confirma la lectura y cierra");
    ok(true, "la cajera entra con su PIN");
    // Entrar solo con el PIN, sin tocar el nombre: la base dice de quién es
    await page.click("#btnUser"); await page.waitForSelector("#pin:not(.hidden)");
    ok(await page.isVisible("#pad") && /Escribe tu PIN para entrar/.test(await page.textContent("#pinTitle")), "al bloquear, el teclado del PIN ya está a la vista (no hay que elegir el nombre)");
    for (const k of "9999") await page.click(`#pad [data-k="${k}"]`); await page.waitForTimeout(300);
    ok(/PIN incorrecto/.test(await page.textContent("#pinErr")) && await page.isVisible("#pin"), "un PIN que no es de nadie no entra");
    for (const k of "2222") await page.click(`#pad [data-k="${k}"]`); await page.waitForSelector("#tablesView:not(.hidden)", { timeout: 5000 });
    await page.waitForTimeout(300); if (await page.isVisible("#annDlg")) await page.click('#annBody [data-annok]').catch(() => {});
    ok(/Cajera/.test(await page.textContent("#btnUser")) && await S(() => U && U.id === 2 && U.charge), "con solo su PIN entra la cajera, con su permiso de cobrar");
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

    // Para llevar ya cobrado y listo en cocina: la caja lo ve en «Listos para entregar» y lo marca entregado
    await S(() => { const s = window.__S, ahora = new Date().toISOString();
      s.orders.push({ id: 960, kind: "llevar", status: "cobrada", day_number: 31, label: "Para llevar: Ana", opened_at: ahora, service_pct: 0 });
      s.items.push({ id: 961, order_id: 960, dish_id: 1, name: "Gyozas", variant: "", option: "", notes: "", qty: 1, unit_price: 6, status: "enviado", sent_at: ahora, ready_at: ahora }); });
    await S(() => refreshState()); await page.click('#areas [data-area="Para llevar"]'); await page.waitForTimeout(250);
    ok(/Listos para entregar[\s\S]*#31 · Entregado/.test(await page.textContent("#areaBody")), "la caja ve los pedidos para llevar ya cobrados y listos en cocina");
    await page.click('#areaBody [data-entregar="960"]'); await page.waitForTimeout(500);
    ok(await S(() => !!window.__S.items.find((i) => i.id === 961).served_at) && !/#31 · Entregado/.test(await page.textContent("#areaBody")),
      "al tocar «Entregado» queda entregado y sale de la lista (y de la pantalla de pedidos listos)");

    // Mesa: plato con nota, enviar, cobrar en efectivo
    await page.click('#areas [data-area="Feria"]'); await page.click('#areaBody [data-table] .num:text-is("3")'); await page.waitForSelector("#orderView:not(.hidden)");
    ok(await page.locator('#cats [data-cat="top"].on').count() === 1 && /Gyozas/.test(await page.textContent("#dishes")), "la carta abre en «Lo más pedido»");
    ok(!(await page.isVisible("#cancel")) && !(await page.isVisible("#discount")), "anular y descuento quedan plegados en «Más opciones»");
    await page.click("#moreBtn");
    ok(await page.isVisible("#cancel") && await page.isVisible("#move"), "«Más opciones» muestra dividir, descuento, mover y anular");
    await page.click("#moreBtn");
    await page.click('#cats button:has-text("Entradas")'); await page.click('#dishes button:has-text("Gyozas")');
    ok(!(await page.isVisible("#dishDlg")) && /Gyozas/.test(await page.textContent("#lines")), "toque rápido: un toque añade el plato sin abrir ventana");
    await page.click('#dishes button:has-text("Gyozas")');
    ok(/^2$/.test((await page.locator("#lines .line.new b").first().textContent()).trim()), "otro toque suma uno más en la misma línea");
    await page.locator("#lines .line.new [data-dec]").first().click(); await page.locator("#lines .line.new [data-dec]").first().click();
    await page.click('#dishes button:has-text("Pollo Kobayashi")');
    ok(await page.isVisible("#dishDlg") && /Tamaño/.test(await page.textContent("#dishVariants")), "un plato con tamaños abre la ventana para elegir");
    await page.click("#dishCancel");
    await page.click('#dishes button:has-text("Gyozas")', { delay: 650 }); await page.waitForTimeout(150);
    ok(await page.isVisible("#dishDlg"), "mantener presionado abre la ventana (cantidad, opción y nota)");
    await page.click("#dishCancel");
    ok(!(await page.locator("#lines .line.new").count()), "el toque largo no añade nada por su cuenta");
    await page.click('#dishes button:has-text("Gyozas")', { button: "right" });
    ok(await page.isVisible("#dishDlg"), "en la laptop, el clic derecho también abre la ventana");
    // Notas rápidas: primero las del plato, después las de toda la carta; se tocan en vez de escribirlas
    const chips = await page.evaluate(() => [...document.querySelectorAll("#dishNotes [data-nota]")].map((b) => b.textContent).join(","));
    ok(chips === "bien doradas,sin salsa,sin picante,poco picante,sin cebollín", "notas rápidas: primero las del plato, después las de toda la carta (" + chips + ")");
    await page.click('#dishNotes [data-nota="bien doradas"]'); await page.click('#dishNotes [data-nota="sin picante"]');
    ok((await page.inputValue("#dishNote")) === "bien doradas, sin picante" && await page.locator("#dishNotes button.on").count() === 2, "tocar notas las agrega a la nota (y se marcan)");
    await page.click('#dishNotes [data-nota="bien doradas"]'); await page.click('#dishNotes [data-nota="sin picante"]');
    ok((await page.inputValue("#dishNote")) === "", "y tocarlas otra vez las quita");
    await page.click('#dishNotes [data-nota="sin salsa"]'); await page.click("#dishAdd");
    await page.locator("#lines .line.new .t").last().click(); await page.waitForSelector("#askDlg[open]");
    ok(await page.locator("#askChips [data-nota]").count() === 5 && !(await page.evaluate(() => !!document.activeElement && document.activeElement.id === "askInput")),
      "al tocar el plato para cambiar la nota salen las notas rápidas, sin abrir el teclado");
    await page.click('#askChips [data-nota="poco picante"]');
    ok((await page.inputValue("#askInput")) === "sin salsa, poco picante", "en la nota del plato pedido también se agregan con un toque");
    await page.click('#askChips [data-nota="poco picante"]'); await page.click("#askOk"); await page.waitForTimeout(200);
    await page.click("#send"); await page.waitForTimeout(300);
    ok(await S(() => window.__S.items.some((i) => i.notes === "sin salsa" && i.status === "enviado")), "el plato llega a cocina con su nota");
    // Precuenta: la primera sale; si se vuelve a tocar antes de 5 minutos pregunta (vale también la de otra tablet)
    const cajaJobs = () => S(() => window.__S.jobs.filter((j) => j === "caja").length);
    const preguntas = []; let responder = "no";
    const enDialogo = (d) => { preguntas.push(d.message()); (responder === "sí" ? d.accept() : d.dismiss()).catch(() => {}); };
    autoDialog = false; page.on("dialog", enDialogo);
    const j0 = await cajaJobs();
    await page.click("#precuenta"); await page.waitForTimeout(400);
    ok((await cajaJobs()) === j0 + 1 && !preguntas.length, "la primera precuenta sale sin preguntar");
    await page.click("#precuenta"); await page.waitForTimeout(400);
    ok(/ya salió a las [^(]+\(hace 1 segundo\)/.test(preguntas[0] || "") && /Imprimir otra de todos modos/.test(preguntas[0]) && (await cajaJobs()) === j0 + 1,
      "si ya salió, pregunta antes de imprimir otra y, si dicen que no, no la imprime (" + (preguntas[0] || "").split("\n")[0] + ")");
    const precuentaHace = (min) => page.evaluate((m) => { const o = window.__S.orders.find((x) => x.status === "abierta" && x.precuenta_at);
      o.precuenta_at = new Date(Date.now() - m * 60000).toISOString(); return Promise.all([loadOrder(), refreshState()]); }, min);
    await precuentaHace(4);
    await page.click("#precuenta"); await page.waitForTimeout(400);
    ok(/\(hace 4 minutos\)/.test(preguntas[1] || "") && (await cajaJobs()) === j0 + 1, "a los 4 minutos todavía pregunta (" + (preguntas[1] || "").split("\n")[0] + ")");
    responder = "sí"; await precuentaHace(4.5);
    await page.click("#precuenta"); await page.waitForTimeout(400);
    ok(preguntas.length === 3 && (await cajaJobs()) === j0 + 2, "si dicen que sí, imprime otra");
    await precuentaHace(6);
    await page.click("#precuenta"); await page.waitForTimeout(400);
    ok(preguntas.length === 3 && (await cajaJobs()) === j0 + 3, "pasados 5 minutos sale sin preguntar");
    await page.evaluate((t) => { window.__S.orders.find((x) => x.status === "abierta" && x.precuenta_at).precuenta_at = t; }, new Date(Date.now() - 2 * 60000).toISOString());
    await S(() => refreshState()); responder = "no";
    await page.evaluate((t) => { cur.data.precuenta_at = t; }, new Date(Date.now() - 10 * 60000).toISOString());  // en esta tablet, la última es de hace 10 min
    await page.click("#precuenta"); await page.waitForTimeout(400);
    ok(preguntas.length === 4 && /\(hace 2 minutos\)/.test(preguntas[3]) && (await cajaJobs()) === j0 + 3,
      "si la sacó otra tablet hace 2 minutos (se ve en el mapa), también pregunta");
    page.off("dialog", enDialogo); autoDialog = true;
    // En el mapa: la mesa que pidió la cuenta dice hace cuánto, y a los 5 minutos se avisa
    await page.evaluate((t) => { window.__S.orders.find((x) => x.status === "abierta" && x.precuenta_at).precuenta_at = t; }, new Date(Date.now() - 7 * 60000).toISOString());
    await page.click("#back"); await page.waitForSelector("#tablesView:not(.hidden)"); await S(() => refreshState()); await page.waitForTimeout(300);
    const t3 = (await page.locator('#areaBody [data-table]:has(.num:text-is("3"))').textContent()).replace(/\s+/g, " ");
    ok(/cuenta hace 7 min/.test(t3) && /esperando/.test(t3) && /Mesas esperando[\s\S]*pidió la cuenta hace 7 min/.test(await page.textContent("#banners")),
      "la mesa que pidió la cuenta hace 7 min lo dice y se avisa arriba (" + t3 + ")");
    await page.click('#areaBody [data-table] .num:text-is("3")'); await page.waitForSelector("#orderView:not(.hidden)");
    await page.click("#pay"); await page.waitForTimeout(200);
    if (await page.isVisible("#cliDlg")) { await page.fill("#cQ", "04241234567"); await page.waitForSelector("#cName:visible, #cFicha:visible"); if (await page.isVisible("#cName")) await page.fill("#cName", "Cliente Caja"); await page.click("#cOk"); await page.waitForSelector("#payDlg[open]"); }
    const orden = await page.evaluate(() => [...document.querySelectorAll("#payMethods [data-m]")].slice(0, 2).map((b) => b.dataset.m + (b.classList.contains("top") ? "*" : "")).join(","));
    ok(orden === "punto_debito*,pago_movil*", "al cobrar, punto y pago móvil salen primero y más grandes (" + orden + ")");
    await page.click('#payMethods [data-m="punto_debito"]'); await page.waitForTimeout(200);
    ok(!(await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains("amt"))) && !(await page.isDisabled("#payOk")),
      "todo con punto: un toque y queda listo para confirmar, sin abrir el teclado");
    await page.locator("#payLines .pay .del").first().click(); await page.waitForTimeout(150);
    await page.click('#payMethods [data-m="efectivo_usd"]');
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

    // Mesa ocupada: el mapa dice quién está tomando el pedido; al entrar se pregunta y, si entra, a la otra se le cierra
    await S(() => { const S2 = window.__S, mesa = ST.tables.find((x) => x.area === "Feria" && x.number === 7);
      const o = { id: 900, kind: "mesa", table_id: mesa.id, label: "", status: "abierta", service_pct: 10, opened_at: new Date().toISOString(), opened_by_id: 1 }; S2.orders.push(o);
      window.__ATT = { 900: { id: 1, name: "Mesera", dev: "Tablet Barra #otra" } }; });
    await S(() => refreshState()); await page.click('#areas [data-area="Feria"]'); await page.waitForTimeout(200);
    const tile7 = page.locator('#areaBody [data-table]:has(.num:text-is("7"))');
    ok(await tile7.evaluate((b) => b.classList.contains("att")) && /Tomando pedido/.test(await tile7.locator(".st").textContent()) && (await tile7.locator(".pill.att").textContent()) === "Mesera",
      "en el mapa, la mesa dice «Tomando pedido» y quién (Mesera)");
    ok(/Tomando pedido/.test(await page.textContent("#areaBody .legend")), "la leyenda explica «Tomando pedido»");
    autoDialog = false;
    let pregunta = ""; page.once("dialog", (d) => { pregunta = d.message(); d.dismiss().catch(() => {}); });
    await tile7.click(); await page.waitForTimeout(400);
    ok(/Mesera está tomando el pedido en Feria 7/.test(pregunta) && /Entrar igual/.test(pregunta) && !(await page.isVisible("#orderView")) && (await S(() => window.__ATT[900].name)) === "Mesera",
      "al tocar la mesa pregunta «¿Entrar igual?» y, si no, no entra ni le quita la mesa a nadie");
    page.once("dialog", (d) => d.accept().catch(() => {}));
    await tile7.click(); await page.waitForSelector("#orderView:not(.hidden)");
    ok((await S(() => window.__ATT[900].name)) === "Cajera" && (await S(() => window.__ATTCALLS.some((c) => c.p_order === 900 && c.p_tomar === true))),
      "si entra igual, la mesa pasa a quien entró (a la otra tablet se le cierra)");
    // Otra persona entra mientras esta tablet tiene platos sin enviar: se le cierra, avisa y lo anotado queda en la mesa
    await page.click('#cats button:has-text("Entradas")'); await page.click('#dishes button:has-text("Gyozas")'); await page.click('#dishes button:has-text("Gyozas")');
    await S(() => { window.__ATT[900] = { id: 3, name: "Ayudante", dev: "Tablet Tokio #zz" }; });
    await S(() => attBeat()); await page.waitForSelector("#tablesView:not(.hidden)"); await page.waitForTimeout(300);
    const cierre = await page.isVisible("#notice") ? await page.textContent("#notice .nmsg") : "";
    ok(/Ayudante entró a Feria 7 y se te cerró la mesa/.test(cierre) && /\(2 platos\) quedó guardado en la mesa como «sin enviar»/.test(cierre), "a quien atendía se le cierra la mesa con un aviso de quién entró");
    ok(await S(() => window.__S.items.some((i) => i.order_id === 900 && i.status === "pendiente" && i.name === "Gyozas" && i.qty === 2)),
      "lo que tenía anotado (2 Gyozas) queda en la mesa como «sin enviar», no se pierde");
    ok(!(await S(() => window.__soltar === 900)), "al cerrársela no suelta la mesa de quien entró");
    await page.click("#notice [data-nok]"); await page.waitForTimeout(200);
    autoDialog = true;
    await S(() => { delete window.__ATT[900]; const o = window.__S.orders.find((x) => x.id === 900); o.status = "anulada"; }); await S(() => refreshState());
    // Al volver al mapa, la mesa queda libre de inmediato
    await page.click('#areaBody [data-table] .num:text-is("8")'); await page.waitForSelector("#orderView:not(.hidden)");
    const o8 = await S(() => cur.order);
    ok((await S(() => window.__ATT[cur.order] && window.__ATT[cur.order].name)) === "Cajera", "al abrir una mesa libre, queda tomando el pedido quien la abrió");
    await page.click("#back"); await page.waitForTimeout(300);
    ok(await page.evaluate((x) => window.__soltar === x && !window.__ATT[x], o8), "al volver al mapa, la mesa queda libre");

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
    await S(() => { window.__S.premios = [{ quien: "Mesera", premio: "Taiyaki", qty: 1, valor: 2.5 }]; });
    await page.click("#btnCaja"); await page.waitForTimeout(300);
    ok(await page.isVisible('#cashBody [data-ctab="res"].on') && await page.isVisible("#cashBody [data-ctab=cierre]"), "la caja se abre en «Resumen», con pestañas para cerrar y herramientas");
    ok(/Premios de misiones \(1\)[\s\S]*Mesera · 1 Taiyaki · Ref 2,50 en la carta/.test(await page.textContent("#cashBody")),
      "el resumen muestra los premios de misiones del turno (quién, qué y lo que vale en la carta)");
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
    // Salida de caja con foto de la factura (se achica a JPG y se sube al bucket privado «facturas»)
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.click('#cashBody [data-ctab="tools"]'); await page.click("#cashOutBtn");
    for (const v of ["5", "$", "Compra de hielo"]) { await page.fill("#askInput", v); await page.click("#askOk"); await page.waitForTimeout(150); }
    ok(await page.isVisible("#photoDlg") && await page.isDisabled("#photoOk"), "después del motivo pide la foto de la factura (se puede seguir sin foto)");
    await page.setInputFiles("#photoFile", { name: "factura.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector("#photoPrev:not([hidden])", { timeout: 5000 });
    await page.click("#photoOk"); await page.waitForTimeout(400);
    const salida = await S(() => ({ out: window.__out, up: (window.__S.uploads || []).slice(-1)[0] }));
    ok(salida.up && salida.up.bucket === "facturas" && salida.up.type === "image/jpeg" && /^\d{4}-\d{2}\/[0-9a-f]{32}\.jpg$/.test(salida.up.path), "la foto se sube como JPG al espacio privado de facturas");
    ok(salida.out && salida.out.p_photo === salida.up.path && salida.out.p_reason === "Compra de hielo", "la salida queda registrada con su foto");
    // Si no se puede subir (sin internet), pregunta y registra sin la foto
    await S(() => { window.__UPLOAD_FAIL = true; });
    await page.click("#cashOutBtn");
    for (const v of ["2", "$", "Propina delivery"]) { await page.fill("#askInput", v); await page.click("#askOk"); await page.waitForTimeout(150); }
    await page.setInputFiles("#photoFile", { name: "factura.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector("#photoPrev:not([hidden])", { timeout: 5000 }); await page.click("#photoOk"); await page.waitForTimeout(400);
    ok(await S(() => window.__out.p_reason === "Propina delivery" && !window.__out.p_photo), "si la foto no sube, avisa y registra la salida sin foto");
    await S(() => { window.__UPLOAD_FAIL = false; });
    // Mercancía con foto
    await page.click('#cashBody [data-ctab="tools"]'); await page.click("#buyBtn"); await page.waitForSelector("#listDlg[open]");
    await page.locator('#listBody [data-ing="3"]').fill("12");
    await page.click("#buyPhoto"); await page.setInputFiles("#photoFile", { name: "factura.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector("#photoPrev:not([hidden])", { timeout: 5000 }); await page.click("#photoOk"); await page.waitForTimeout(200);
    ok(/Foto lista/.test(await page.textContent("#buyPhoto")), "en «Llegó mercancía» se puede adjuntar la foto de la factura");
    await page.click("#savePurchase"); await page.waitForTimeout(400);
    ok(await S(() => /^\d{4}-\d{2}\/[0-9a-f]{32}\.jpg$/.test(window.__buyPhoto || "") && window.__buy[0].qty === 12), "la mercancía queda registrada con su foto");
    await page.click('#cashBody [data-ctab="cierre"]');
    ok(await page.isVisible('#cashBody .cnt[data-m="efectivo_usd"]') && !(await page.isVisible('#cashBody .cnt[data-m="pago_movil"]')), "el cierre empieza por el efectivo, un paso a la vez");
    ok(await page.isVisible("#cashTotalDiff") && await page.isVisible("#cstepNext"), "la diferencia y «Siguiente» quedan fijos abajo");
    await page.click('#cashBody [data-bills="1"]');
    await page.locator('#cashBody .bcnt[data-den="10"]').fill("1"); await page.locator('#cashBody .bcnt[data-den="5"]').fill("1");
    ok((await page.locator('#cashBody .cnt[data-m="efectivo_usd"]').inputValue()) === "15.00", "contar billetes: 1 de $10 + 1 de $5 = 15");
    const ciego = await S(() => {
      const fila = document.querySelector('#cashBody tr[data-row="efectivo_usd"]'), vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.offsetParent !== null;
      return { esperado: vis(fila.querySelector(".ev")), aviso: vis(fila.querySelector(".eb")), dif: vis(fila.querySelector(".cdiff")) && fila.querySelector(".cdiff").textContent.trim() !== "",
               pie: document.getElementById("cashTotalDiff").textContent };
    });
    ok(!ciego.esperado && ciego.aviso && !ciego.dif && /se ve al revisar/.test(ciego.pie), "cierre ciego: el efectivo se cuenta sin ver lo esperado ni la diferencia");
    await page.click("#cstepNext");
    ok(await page.isVisible('#cashBody .cnt[data-m="pago_movil"]') && /cierre de lote/.test(await page.textContent("#cstepHelp")), "paso 2: bolívares en banco, con la explicación del lote");
    await page.locator('#cashBody .cnt[data-m="pago_movil"]').fill("247.98");
    await page.locator('#cashBody .cnt[data-m="pago_movil"]').dispatchEvent("input");
    ok(await page.locator("#cashBody .cwarn").count() > 0, "avisa si el pago móvil parece escrito en dólares");
    await page.click('#cashBody [data-cstep="5"]');
    ok(await page.isVisible("#doClose") && await page.isVisible("#cashNotes") && await page.isVisible('#cashBody .cnt[data-m="efectivo_usd"]'), "el último paso muestra todo para revisar, la nota y el botón de enviar");
    ok(await page.isVisible('#cashBody tr[data-row="efectivo_usd"] .ev') && !/se ve al revisar/.test(await page.textContent("#cashTotalDiff")), "al revisar ya se ve lo esperado y la diferencia");
    // Si después de ver lo esperado cambia lo contado, el primer conteo queda en la nota
    await page.click('#cashBody [data-cstep="1"]');
    ok(await page.isVisible('#cashBody tr[data-row="efectivo_usd"] .ev'), "lo ya visto no se vuelve a esconder");
    await page.locator('#cashBody .cnt[data-m="efectivo_usd"]').fill("16"); await page.locator('#cashBody .cnt[data-m="efectivo_usd"]').dispatchEvent("input");
    await page.click('#cashBody [data-cstep="5"]');
    await page.click("#doClose"); await page.waitForTimeout(300);
    ok(!(await S(() => !!window.__closed)), "no deja cerrar con diferencia grande sin nota");
    ok(await page.isVisible("#closeErr") && /Falta la nota para cerrar/.test(await page.textContent("#closeErr")), "explica junto al botón que falta la nota (no solo un aviso que se va)");
    await page.fill("#cashNotes", "Vuelto dado por pago móvil"); await page.locator("#cashNotes").dispatchEvent("input");
    ok(!(await page.isVisible("#closeErr")), "al escribir la nota desaparece el aviso");
    await page.click("#doClose"); await page.waitForSelector("#repDlg[open]", { timeout: 5000 });
    ok(true, "con la nota escrita, el cierre avanza a la revisión");
    ok(/Vuelto dado por pago móvil · Conteo antes de ver lo esperado: efectivo \$ 15,00/.test(await page.textContent("#repBody")), "la nota del cierre lleva el primer conteo (15) porque se cambió después de ver lo esperado");
    // Al día siguiente (sin recargar la página) el cierre vuelve a empezar ciego, desde el efectivo
    await page.click("#repSend"); await page.waitForTimeout(500);
    ok(await S(() => !!window.__closed), "cierra la caja");
    if (await page.isVisible("#cashDlg[open]")) await page.keyboard.press("Escape");
    await page.click("#btnCaja"); await page.waitForTimeout(300);
    await page.click("#openCash"); await page.waitForTimeout(1500);
    if (!(await page.isVisible('#cashBody [data-ctab="cierre"]'))) { await page.click("#btnCaja"); await page.waitForTimeout(300); }
    await page.click('#cashBody [data-ctab="cierre"]');
    const dia2 = await S(() => { const fila = document.querySelector('#cashBody tr[data-row="efectivo_usd"]'), vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.offsetParent !== null;
      return { esperado: vis(fila && fila.querySelector(".ev")), efectivo: vis(document.querySelector('#cashBody .cnt[data-m="efectivo_usd"]')), banco: vis(document.querySelector('#cashBody .cnt[data-m="pago_movil"]')) }; });
    ok(!dia2.esperado && dia2.efectivo && !dia2.banco, "al día siguiente el cierre vuelve a empezar ciego y por el efectivo");
  } catch (e) {
    fallos++; console.log("FALLÓ: " + e.message.split("\n")[0]);
  }
  ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  await browser.close(); server.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DEL NAVEGADOR PASARON");
})();
