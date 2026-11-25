// Sistema de ventas de Ichiraku (sala y caja). Funciona con supabase/pos.sql.
// El programa está en varias partes que se cargan en orden (pos.html) y comparten nombres:
// pos-base → pos-acceso → pos-mesas → pos-pedido → pos-cobro → pos-caja.
// Base: configuración, ayudantes y estado compartido
"use strict";
var C = window.MENU_CONFIG || {};
var $ = function (id) { return document.getElementById(id); };
function show(id, on) { $(id).classList.toggle("hidden", !on); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; }
var nf2 = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function ref(n) { return "Ref " + nf2.format(n || 0); }
function bs(n) { return "Bs " + nf2.format(n || 0); }
// Ventanas abiertas, en el orden en que se abrieron (la última es la que está al frente)
var MODALS = [];
(function () {
  var P = window.HTMLDialogElement && HTMLDialogElement.prototype, sm = P && P.showModal;
  if (!sm) return;
  P.showModal = function () { sm.apply(this, arguments); var d = this; MODALS = MODALS.filter(function (x) { return x !== d && x.open; }); MODALS.push(d); };
})();
function topModal() { for (var i = MODALS.length - 1; i >= 0; i--) if (MODALS[i].open) return MODALS[i]; return null; }
// Avisos importantes: quedan fijos arriba hasta tocar «Entendido» (los errores ya no desaparecen solos).
// Con una ventana abierta (cobro, caja…) el aviso sale arriba dentro de ella: por fuera quedaría detrás
// y no se podría tocar. Si esa ventana se cierra sin tocar «Entendido», el aviso sigue a la vista.
function notice(msg, kind) {
  var n = $("notice");
  if (!n) {
    n = document.createElement("div"); n.id = "notice"; n.setAttribute("role", "alert");
    n.addEventListener("click", function (e) { if (e.target.closest("[data-nok]")) n.classList.remove("show"); });
  }
  n._msg = msg; n._kind = kind;
  var dlg = topModal();
  if (n.parentNode !== (dlg || document.body)) {
    if (dlg) {
      dlg.insertBefore(n, dlg.firstChild);
      dlg.addEventListener("close", function () { if (n.parentNode === dlg && n.classList.contains("show")) notice(n._msg, n._kind); }, { once: true });
    } else document.body.appendChild(n);
  }
  // Fuera de una ventana: debajo de la barra de arriba, para que el indicador y «Caja» sigan a la vista
  var h = document.querySelector("header"), hb = h ? h.getBoundingClientRect().bottom : 0;
  n.style.top = dlg ? "" : (hb > 0 ? Math.round(hb) + 8 : 10) + "px";
  n.className = "notice show " + (kind || "err") + (dlg ? " inmodal" : "");
  n.innerHTML = '<span class="nmsg">' + esc(msg) + '</span><button type="button" data-nok>Entendido</button>';
}
// Sonido corto de aviso (plato listo). El navegador solo deja sonar después de que alguien tocó la pantalla:
// el primer toque (el PIN) prepara el audio.
var AUDIO = null;
document.addEventListener("pointerdown", function () {
  try { if (!AUDIO) AUDIO = new (window.AudioContext || window.webkitAudioContext)(); if (AUDIO.state === "suspended") AUDIO.resume(); } catch (e) { AUDIO = null; }
}, true);
function chime() {
  try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* sin vibración */ }
  if (!AUDIO) return;
  try {
    [880, 1318.5].forEach(function (f, i) {
      var o = AUDIO.createOscillator(), g = AUDIO.createGain(), t = AUDIO.currentTime + i * 0.18;
      o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(AUDIO.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.start(t); o.stop(t + 0.45);
    });
  } catch (e) { /* sin sonido: queda el aviso en pantalla */ }
}
// Campanita (Edgar, 25/11, página «Animaciones y sonidos», sonido D): suena cuando un pedido sale a cocina, en caja y en sala
function campanita() {
  if (!AUDIO) return;
  try {
    [[880, 0.36, 1.3], [2429, 0.14, 0.7], [4752, 0.07, 0.35]].forEach(function (p) {
      var o = AUDIO.createOscillator(), g = AUDIO.createGain(), t = AUDIO.currentTime;
      o.type = "sine"; o.frequency.value = p[0]; o.connect(g); g.connect(AUDIO.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p[1], t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);
      o.start(t); o.stop(t + p[2] + 0.03);
    });
  } catch (e) { /* sin sonido: queda el aviso en pantalla */ }
}
// Brillo al tocar un botón (Edgar, 25/11, opción 5: «solo ese»). Se dibuja encima del botón, en su mismo lugar y con sus
// mismas esquinas, sin cambiar su estilo; dentro de una ventana (dialog) va en la ventana para quedar por encima.
var BRILLO_QUIETO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
document.addEventListener("pointerdown", function (ev) {
  if (BRILLO_QUIETO) return;
  var b = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!b || b.disabled || b.hasAttribute("data-sin-brillo")) return;
  var r = b.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return;
  var fx = document.createElement("span"), cs = getComputedStyle(b);
  fx.className = "brillo-fx"; fx.setAttribute("aria-hidden", "true");
  fx.style.cssText = "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;border-radius:" + cs.borderRadius;
  fx.appendChild(document.createElement("i"));
  (b.closest("dialog[open]") || document.body).appendChild(fx);
  setTimeout(function () { fx.remove(); }, 700);
}, true);
function toast(msg, err) { if (err) { notice(msg, "err"); return; } var t = $("toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, err ? 4000 : 2200); }
function errMsg(e) { return (e && (e.message || e.error_description)) || String(e); }
function fail(e) { console.error(e); toast(errMsg(e), true); if (/PIN incorrecto/.test(errMsg(e))) lock(); }

if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY) { show("noconfig", true); throw new Error("Falta configurar Supabase en config.js"); }
var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }

var METHODS = [
  ["efectivo_usd", "Efectivo $", "REF"], ["efectivo_bs", "Efectivo Bs", "BS"], ["pago_movil", "Pago móvil", "BS"],
  ["punto_debito", "Punto débito", "BS"], ["punto_credito", "Punto crédito", "BS"], ["zelle", "Zelle", "REF"],
  ["binance", "Binance", "REF"], ["paypal", "PayPal", "REF"]];
var MNAME = {}; METHODS.forEach(function (m) { MNAME[m[0]] = m[1]; });
// Logos: Zelle, Binance y PayPal de Simple Icons (CC0; las marcas son de sus dueños); los demás son iconos propios.
var LOGO = {"efectivo_usd": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#15803d\"/><rect x=\"4.5\" y=\"9\" width=\"23\" height=\"14\" rx=\"2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><text x=\"16\" y=\"19.8\" text-anchor=\"middle\" font-family=\"system-ui,sans-serif\" font-size=\"9.5\" font-weight=\"800\" fill=\"#fff\">$</text></svg>", "efectivo_bs": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#166534\"/><rect x=\"4.5\" y=\"9\" width=\"23\" height=\"14\" rx=\"2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><text x=\"16\" y=\"19.8\" text-anchor=\"middle\" font-family=\"system-ui,sans-serif\" font-size=\"7.5\" font-weight=\"800\" fill=\"#fff\">Bs</text></svg>", "pago_movil": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#0f766e\"/><rect x=\"10.5\" y=\"5.5\" width=\"11\" height=\"21\" rx=\"2.5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><circle cx=\"16\" cy=\"22.5\" r=\"1.3\" fill=\"#fff\"/><path d=\"M14 10.5h4.5M16.2 8.5l2.3 2-2.3 2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M18 16.5h-4.5M15.8 14.5l-2.3 2 2.3 2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>", "punto_debito": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#1d4ed8\"/><rect x=\"5\" y=\"9\" width=\"22\" height=\"15\" rx=\"2.5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M5 13.5h22\" stroke=\"#fff\" stroke-width=\"2.6\"/><text x=\"16\" y=\"21.6\" text-anchor=\"middle\" font-family=\"system-ui,sans-serif\" font-size=\"6.2\" font-weight=\"800\" fill=\"#fff\">DÉB</text></svg>", "punto_credito": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#7c3aed\"/><rect x=\"5\" y=\"9\" width=\"22\" height=\"15\" rx=\"2.5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M5 13.5h22\" stroke=\"#fff\" stroke-width=\"2.6\"/><text x=\"16\" y=\"21.6\" text-anchor=\"middle\" font-family=\"system-ui,sans-serif\" font-size=\"6.2\" font-weight=\"800\" fill=\"#fff\">CRÉ</text></svg>", "zelle": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#6d1ed4\"/><g transform=\"translate(6 6) scale(.8333)\"><path fill=\"#fff\" d=\"M13.559 24h-2.841a.483.483 0 0 1-.483-.483v-2.765H5.638a.667.667 0 0 1-.666-.666v-2.234a.67.67 0 0 1 .142-.412l8.139-10.382h-7.25a.667.667 0 0 1-.667-.667V3.914c0-.367.299-.666.666-.666h4.23V.483c0-.266.217-.483.483-.483h2.841c.266 0 .483.217.483.483v2.765h4.323c.367 0 .666.299.666.666v2.137a.67.67 0 0 1-.141.41l-8.19 10.481h7.665c.367 0 .666.299.666.666v2.477a.667.667 0 0 1-.666.667h-4.32v2.765a.483.483 0 0 1-.483.483Z\"/></g></svg>", "binance": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#181a20\"/><g transform=\"translate(6 6) scale(.8333)\"><path fill=\"#f0b90b\" d=\"M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z\"/></g></svg>", "paypal": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#003087\"/><g transform=\"translate(6 6) scale(.8333)\"><path fill=\"#fff\" d=\"M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087zM19.79 6.142c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.612c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.89-4.906z\"/></g></svg>"};
LOGO.cuenta = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#9a3412"/><circle cx="16" cy="12" r="4.5" fill="none" stroke="#fff" stroke-width="2"/><path d="M8 25c1.3-4.3 4.4-6.5 8-6.5s6.7 2.2 8 6.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
LOGO.propina = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#be185d"/><path d="M16 24s-7-4.3-7-9.2A3.8 3.8 0 0 1 16 12a3.8 3.8 0 0 1 7 2.8C23 19.7 16 24 16 24z" fill="#fff"/></svg>';
var MCUENTA = ["cuenta", "A cuenta (empleado)", "REF"], MYUMMY = ["yummy", "Yummy", "REF"];
function minfo(k) { return k === "cuenta" ? MCUENTA : k === "yummy" ? MYUMMY : METHODS.find(function (x) { return x[0] === k; }); }
// Pedido de Yummy (delivery de Yummy): se cobra con Yummy y no pide datos del cliente
function esYummy(d) { return !!d && d.channel === "yummy"; }
// Yummy: una bolsa de delivery (icono propio, no es el logo de Yummy)
LOGO.yummy = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#a21caf"/><path d="M9 13h14l-1.4 11.5H10.4z" fill="#fff"/><path d="M12.5 13v-2.2a3.5 3.5 0 0 1 7 0V13" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
function logo(k) { return '<span class="logo">' + (LOGO[k] || "") + "</span>"; }
var AREAS = ["Feria", "Tokio", "Edo"];
var IC = {
  send: '<path d="M4 12 20 4l-4 16-4-7-8-1z"/><path d="m12 13 8-9"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  move: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  box: '<path d="M4 7h16v13H4zM2 4h20v3H2zM10 11h4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.4.2 4.2 2 5 4.9"/>'
};
function icon(n) { return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + "</svg>"; }
function label(id, n, text) { $(id).innerHTML = icon(n) + "<span>" + esc(text) + "</span>"; }
var AV = ["#e5206b", "#2563c4", "#22784a", "#a85a00", "#7c3aed", "#0f766e", "#b3261e", "#4b5563"];
function avatar(name, id) { var t = String(name || "?").trim(); return '<span class="avatar" style="background:' + AV[(Number(id) || t.length) % AV.length] + '">' + esc(t.charAt(0).toUpperCase()) + "</span>"; }
label("precuenta", "receipt", "Precuenta"); label("pay", "cash", "Cobrar"); label("discount", "percent", "Descuento");
label("move", "move", "Mover"); label("cancel", "x", "Anular pedido"); label("back", "back", "Mesas"); label("btnCaja", "box", "Caja");

var U = null;              // { id, name, pin } persona que está usando el dispositivo
var ST = null;             // estado de sala (pos_state)
var MENU = { cats: [], dishes: [] };
var cur = { area: null, order: null, data: null, cart: [], cat: null };
try { cur.area = localStorage.getItem("pos-area") || "Tokio"; } catch (e) { cur.area = "Tokio"; }

// ---------------------------------------------------------------- Actualización automática
// Cada 5 minutos (y al volver a la pantalla) se compara la versión de los programas (los ?v= de pos.html) con la del
// servidor. Si hay una nueva, avisa y se recarga sola en un momento libre: en la pantalla del PIN tras 10 s sin tocarla,
// o en el mapa de mesas sin platos por enviar y 2 minutos sin tocarla. Nunca con una ventana abierta ni escribiendo.
var ACT = { nueva: false, toque: Date.now(), actual: "" };
function actFirma(html) { return (String(html).match(/(?:pos(?:-[a-z]+)?|reporte-cierre|monitoreo|juegos|shibu)\.(?:js|css)\?v=[0-9a-f]+/g) || []).sort().join(","); }
ACT.actual = actFirma(document.documentElement.innerHTML);
function actRevisar() {
  if (ACT.nueva || !ACT.actual) return Promise.resolve();
  return fetch(location.pathname + "?act=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
    var f = actFirma(t);
    if (f && f !== ACT.actual) { ACT.nueva = true; actAviso(); }
  }).catch(function () { /* sin red: se revisa en la próxima vuelta */ });
}
function actVisible(id) { var e = document.getElementById(id); return !!e && !e.classList.contains("hidden"); }
function actLibre() {
  if (document.querySelector("dialog[open]")) return false;
  var a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
  var quieto = Date.now() - ACT.toque;
  if (actVisible("pin")) return quieto > 10000;
  return actVisible("tablesView") && !(cur && cur.cart && cur.cart.length) && quieto > 120000;
}
function actRecargar() { location.replace(location.pathname + "?act=" + Date.now() + location.hash); }
function actQuizas() { if (ACT.nueva && actLibre()) actRecargar(); }
function actAviso() {
  if (document.getElementById("actAviso")) return;
  var el = document.createElement("div"); el.id = "actAviso"; el.className = "act-aviso"; el.setAttribute("role", "status");
  el.innerHTML = '<span>Hay una versión nueva del sistema: se actualiza sola en un momento libre.</span> <button type="button">Actualizar ahora</button>';
  el.querySelector("button").addEventListener("click", function () {
    if (cur && cur.cart && cur.cart.length) { toast("Primero envía o quita los platos que faltan por enviar"); return; }
    actRecargar();
  });
  document.body.appendChild(el);
}
["pointerdown", "keydown", "touchstart"].forEach(function (ev) { document.addEventListener(ev, function () { ACT.toque = Date.now(); }, { capture: true, passive: true }); });
document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") actRevisar(); });
setTimeout(actRevisar, 60000); setInterval(actRevisar, 5 * 60000); setInterval(actQuizas, 15000);

