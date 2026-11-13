// Recorre en un navegador real la parte de WhatsApp de la caja: aviso de pedido nuevo, aceptar,
// rechazar con motivo, avisar «en camino», confirmar una reserva y responder un chat.
// Uso: node pruebas-navegador/recorrido-whatsapp.js   (necesita Playwright y Chromium)
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

// Funciones de WhatsApp imitadas en memoria (las reales están en supabase/whatsapp.sql y se prueban en 70-whatsapp.sql).
const FAKE_WA = `
(function(){
  var R = window.__R, W = window.__W = { calls: [], orders: [], active: [], reservations: [], convs: [], msgs: {} };
  function call(n, a){ W.calls.push({ fn: n, args: a }); }
  R.wa_pending = function(a){ call('wa_pending', a); return JSON.parse(JSON.stringify({ orders: W.orders, reservations: W.reservations, active: W.active, unread: W.convs.reduce(function(s,c){return s+c.unread},0) })); };
  R.wa_accept = function(a){ call('wa_accept', a); var o = W.orders.find(function(x){return x.id===a.p_order}); W.orders = W.orders.filter(function(x){return x!==o});
    W.active.push(Object.assign({}, o, { status:'aceptado', pos_order_id: 555, label: 'Delivery: ' + o.customer_name })); return 555; };
  R.wa_reject = function(a){ call('wa_reject', a); W.orders = W.orders.filter(function(x){return x.id!==a.p_order}); };
  R.wa_notify_ready = function(a){ call('wa_notify_ready', a); W.active = W.active.filter(function(x){return x.pos_order_id!==a.p_pos_order}); };
  R.wa_reservation_set = function(a){ call('wa_reservation_set', a); W.reservations = W.reservations.filter(function(x){return x.id!==a.p_id}); };
  R.wa_inbox = function(){ return W.convs; };
  R.wa_thread = function(a){ var c = W.convs.find(function(x){return x.id===a.p_conv}); c.unread = 0; return W.msgs[a.p_conv] || []; };
  R.wa_reply = function(a){ call('wa_reply', a); (W.msgs[a.p_conv] = W.msgs[a.p_conv] || []).push({ id: 99, direction:'out', body: a.p_text, status:'pendiente', sent_by:'Cajera', created_at: new Date().toISOString() });
    W.convs.find(function(x){return x.id===a.p_conv}).bot_paused = true; return 1; };
  R.wa_set_paused = function(a){ call('wa_set_paused', a); W.convs.find(function(x){return x.id===a.p_conv}).bot_paused = a.p_paused; };
})();`;

const ORDER = { id: 41, status: "por_aceptar", kind: "delivery", zone: "Centro", delivery_fee: 2, total: 27, total_bs: 1417.5, subtotal: 25,
  items: [{ dish_id: 1, name: "Pollo Kobayashi", variant: "Gr", option: "", notes: "", qty: 1, unit_price: 15 }, { dish_id: 2, name: "Gyozas", variant: "", option: "", notes: "salsa teriyaki", qty: 2, unit_price: 5 }],
  address: "Calle 5, casa 12", location: { latitude: 10.18, longitude: -67.97 }, customer_name: "Naruto Uzumaki", doc_id: "V12345678",
  payment_method: "pago_movil", payment_ref: "123456", payment_media: "998877665544", has_payment_media: true, phone: "584141234567", wa_name: "Naruto",
  submitted_at: new Date().toISOString() };

(async () => {
  await new Promise((r) => server.listen(8798, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8");
  await page.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "supabase-falso.js"), "utf8") + FAKE_WA }));
  const S = (fn, arg) => page.evaluate(fn, arg);
  const pin = async (emp, code) => { await page.click(`#people [data-emp="${emp}"]`); for (const k of code) await page.click(`#pad [data-k="${k}"]`); };

  try {
    // ---------------------------------------------------------------- Carta: «Pedir por WhatsApp»
    const carta = await (await browser.newContext({ viewport: { width: 400, height: 820 } })).newPage();
    carta.on("pageerror", (e) => errores.push("carta: " + e.message));
    carta.on("dialog", (d) => { errores.push("carta alerta: " + d.message()); d.accept().catch(() => {}); });
    const m = JSON.parse(menu);
    let cartBody = null, waUrl = null;
    await carta.route("**/config.js", (r) => r.fulfill({ contentType: "application/javascript", body:
      'window.MENU_CONFIG={SUPABASE_URL:"https://krjryvtnzgwwhanmbdrn.supabase.co",SUPABASE_ANON_KEY:"anon",RESTAURANT_NAME:"Ichiraku Ramen",PRICE_PREFIX:"Ref",CURRENCY:"USD",LOCALE:"es-VE",' +
      'WHATSAPP_NUMBER:"+58 414 000 0000",WHATSAPP_ORDERS:true,SERVICE_PERCENT:10,ORDER_ACTIONS:false};' }));
    // Misma dirección que la carta real (la política de seguridad solo permite esa), pero interceptada: nunca sale a internet.
    await carta.route("https://krjryvtnzgwwhanmbdrn.supabase.co/**", (r) => {
      const u = r.request().url();
      if (u.includes("/rpc/wa_cart_create")) { cartBody = JSON.parse(r.request().postData()); return r.fulfill({ contentType: "application/json", body: '{"code":"K7M2P","subtotal":25}' }); }
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(u.includes("/categories") ? m.categories : m.dishes) });
    });
    await carta.route("https://wa.me/**", (r) => { waUrl = r.request().url(); return r.fulfill({ contentType: "text/html", body: "<p>WhatsApp</p>" }); });
    await carta.addInitScript(() => localStorage.setItem("menu-order-v1", JSON.stringify([{ id: 2, v: "Gr", o: "", n: "", q: 1 }, { id: 4, v: "", o: "", n: "salsa teriyaki", q: 2 }])));
    await carta.goto("http://localhost:8798/index.html");
    await carta.click("#orderbar"); await carta.waitForSelector("#orderSheet[open]");
    ok(await carta.isVisible("#osWaOrder"), "la carta muestra «Pedir por WhatsApp» cuando está activado");
    await carta.click("#osWaOrder"); await carta.waitForURL(/wa\.me/, { timeout: 5000 });
    ok(JSON.stringify(cartBody && cartBody.p_items) === JSON.stringify([{ dish_id: 2, variant: "Gr", option: "", notes: "", qty: 1 }, { dish_id: 4, variant: "", option: "", notes: "salsa teriyaki", qty: 2 }]),
      "manda los platos (sin precios: el servidor los calcula)");
    ok(/wa\.me\/584140000000\?text=/.test(waUrl || "") && decodeURIComponent(waUrl).includes("pedido K7M2P") && decodeURIComponent(waUrl).includes("2 × Gyozas"),
      "abre WhatsApp con el código del pedido y el resumen");
    await carta.context().close();

    await page.goto("http://localhost:8798/pos.html");
    await page.fill("#devEmail", "tablet@ejemplo.test"); await page.fill("#devPass", "x"); await page.click("#device button");
    await pin(2, "2222"); await page.waitForSelector("#tablesView:not(.hidden)", { timeout: 5000 });
    await page.waitForSelector("#btnWa:not(.hidden)", { timeout: 5000 });
    ok(true, "al entrar aparece el botón WhatsApp");
    ok(!(await page.isVisible("#waBadge")), "sin nada pendiente no hay número");

    // Llega un pedido y una reserva (la caja consulta cada 8 s)
    await S((o) => { window.__W.orders.push(o); window.__W.reservations.push({ id: 7, name: "Hinata", people: 4, reserved_for: new Date(Date.now() + 864e5).toISOString(), area: "Edo", notes: "Cumpleaños", phone: "584149999999" }); }, ORDER);
    await page.waitForSelector("#waBanner", { timeout: 10000 });
    ok(/1 pedido por aceptar/.test(await page.textContent("#banners")), "aparece el aviso «WhatsApp: 1 pedido por aceptar»");
    const badge = (await page.textContent("#waBadge")).trim();
    ok(badge === "2", "el botón cuenta pedido + reserva (" + badge + ")");

    await page.click("#waBanner"); await page.waitForSelector("#waDlg[open]");
    const card = await page.textContent("#waBody");
    ok(/Naruto Uzumaki/.test(card) && /Calle 5, casa 12/.test(card) && /Ref 27,00/.test(card) && /123456/.test(card), "el pedido muestra cliente, dirección, total y referencia");
    ok(/salsa teriyaki/.test(card) && /Pago móvil/.test(card), "con notas y método de pago");
    ok(await page.isVisible('#waBody a[href*="maps.google.com/?q=10.18"]'), "con enlace a la ubicación");

    // Captura del pago: la función devuelve una imagen y la caja debe mostrarla (no un ícono roto).
    let mediaBody = null, mediaAuth = null;
    await page.route("**/functions/v1/whatsapp", (r) => { mediaBody = JSON.parse(r.request().postData() || "{}"); mediaAuth = r.request().headers()["authorization"];
      return r.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }); });
    await page.click('#waBody [data-waimg="998877665544"]'); await page.waitForSelector("#waImgDlg[open]");
    await page.waitForFunction(() => { const i = document.getElementById("waImg"); return i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 });
    ok(mediaBody && mediaBody.action === "media" && mediaBody.id === "998877665544" && mediaAuth === "Bearer token-prueba", "pide la captura con la sesión de la caja");
    ok(/Compárala/.test(await page.textContent("#waImgHelp")), "la captura del pago se ve como imagen");
    await page.click("#waImgClose"); await page.unroute("**/functions/v1/whatsapp");
    await page.click('#waBody [data-waaccept="41"]'); await page.waitForTimeout(500);
    ok(await S(() => window.__W.calls.some((c) => c.fn === "wa_accept" && c.args.p_order === 41 && c.args.p_pin === "2222")), "Aceptar llama a wa_accept con el PIN de quien acepta");
    ok(await S(() => (window.__invokes || []).some((i) => i.fn === "whatsapp" && i.body.action === "flush")), "y pide enviar el aviso al cliente al momento");
    await page.waitForSelector('#waBody [data-waready="555"]', { timeout: 10000 });
    ok(/va en camino/.test(await page.textContent('#waBody [data-waready="555"]')), "el aceptado ofrece «Avisar: va en camino»");
    await page.click('#waBody [data-waready="555"]'); await page.waitForTimeout(500);
    ok(await S(() => window.__W.calls.some((c) => c.fn === "wa_notify_ready" && c.args.p_pos_order === 555)), "avisar «en camino» llega a la base");

    // Rechazar otro pedido con motivo
    await S((o) => { window.__W.orders.push(Object.assign({}, o, { id: 42, customer_name: "Sasuke" })); }, ORDER);
    await page.click('#waTabs [data-watab="orders"]'); await page.waitForSelector('#waBody [data-wareject="42"]', { timeout: 10000 });
    await page.click('#waBody [data-wareject="42"]'); await page.waitForSelector("#askDlg[open]");
    await page.fill("#askInput", "Se acabaron las gyozas"); await page.click("#askOk"); await page.waitForTimeout(500);
    ok(await S(() => window.__W.calls.some((c) => c.fn === "wa_reject" && c.args.p_order === 42 && c.args.p_reason === "Se acabaron las gyozas")), "Rechazar pide el motivo y lo envía");

    // Reserva
    await page.click('#waTabs [data-watab="res"]');
    ok(/Hinata/.test(await page.textContent("#waBody")) && /4 personas/.test(await page.textContent("#waBody")), "la reserva se ve con nombre y personas");
    await page.click('#waBody [data-wares="7"][data-st="confirmada"]'); await page.waitForTimeout(500);
    ok(await S(() => window.__W.calls.some((c) => c.fn === "wa_reservation_set" && c.args.p_status === "confirmada")), "Confirmar reserva llega a la base");

    // Chats
    await S(() => { window.__W.convs.push({ id: 3, phone: "584141234567", name: "Naruto", unread: 1, bot_paused: false, in_window: true, last_msg_at: new Date().toISOString(), last: "¿tienen ramen picante?" });
      window.__W.msgs[3] = [{ id: 1, direction: "in", body: "¿tienen ramen picante?", status: "recibido", sent_by: "", created_at: new Date().toISOString() }]; });
    await page.click('#waTabs [data-watab="chats"]'); await page.waitForSelector('#waBody [data-waconv="3"]', { timeout: 5000 });
    await page.click('#waBody [data-waconv="3"]'); await page.waitForSelector("#waText", { timeout: 5000 });
    ok(/ramen picante/.test(await page.textContent("#waMsgs")), "se abre la conversación");
    await page.fill("#waText", "¡Sí! El Kyojuro está picante 🌶️"); await page.click("#waSend"); await page.waitForTimeout(2200);
    ok(await S(() => window.__W.calls.some((c) => c.fn === "wa_reply" && /Kyojuro/.test(c.args.p_text))), "responder a mano llega a la base");
    await page.waitForSelector("#waBot", { timeout: 5000 });
    ok(true, "después de responder ofrece «Devolver al bot»");
    await page.click("#waBot"); await page.waitForTimeout(500);
    ok(await S(() => window.__W.calls.some((c) => c.fn === "wa_set_paused" && c.args.p_paused === false)), "devolver el chat al bot");

    // Al bloquear la tablet se oculta
    await page.click("#waClose"); await page.click("#btnUser"); await page.waitForTimeout(300);
    ok(!(await page.isVisible("#btnWa")), "al salir, el botón de WhatsApp se oculta");
    ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  } catch (e) {
    fallos++; console.log("FALLÓ: " + e.message);
  } finally {
    await browser.close(); server.close();
  }
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODO EL RECORRIDO DE WHATSAPP EN CAJA PASÓ");
})();
