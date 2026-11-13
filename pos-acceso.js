// Equipo, PIN, asistencia y vista de teléfono
"use strict";
// ---------------------------------------------------------------- Dispositivo y PIN
function deviceLogin() {
  U = null; ["pin", "tablesView", "orderView", "btnCaja", "btnUser"].forEach(function (id) { show(id, false); }); show("device", true);
}
// Nombre de este equipo («Caja», «Tablet Edo»…): se guarda en el equipo y va en cada cobro
function devName() { try { return localStorage.getItem("pos-equipo") || ""; } catch (e) { return ""; } }
function devId() {
  var id = ""; try { id = localStorage.getItem("pos-equipo-id") || ""; } catch (e) {}
  if (!/^[a-z0-9]{8,40}$/.test(id)) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), function (b) { return (b % 36).toString(36); }).join(""); try { localStorage.setItem("pos-equipo-id", id); } catch (e) {} }
  return id;
}
// El nombre lo asigna administración: cada equipo se reporta y toma el nombre que tenga en el sistema
function deviceHello() {
  q(sb.rpc("pos_device_hello", { p_id: devId(), p_ua: navigator.userAgent, p_local_name: devName() })).then(function (n) { if (n && n !== devName()) setDevName(n); }).catch(function () {});
}
setInterval(function () { if (U) deviceHello(); }, 300000);
function setDevName(n) { try { localStorage.setItem("pos-equipo", n); } catch (e) {} $("devNameTxt").textContent = n || "sin nombre"; }
setDevName(devName());
$("devRename").addEventListener("click", function () {
  ask({ title: "Nombre de este equipo", help: "Escribe exactamente «Caja» solo en la laptop de caja. Ejemplos: Tablet Edo, Tablet Feria.", value: devName() || "Tablet " }).then(function (v) {
    if (v === null) return; setDevName(String(v).trim().slice(0, 30));
  });
});
$("device").addEventListener("submit", function (e) {
  setDevName($("devName").value);
  e.preventDefault(); $("devErr").textContent = "";
  sb.auth.signInWithPassword({ email: $("devEmail").value.trim(), password: $("devPass").value })
    .then(function (r) { if (r.error) $("devErr").textContent = "No se pudo activar: " + r.error.message; });
});
$("devOut").addEventListener("click", function () { if (confirm("¿Desactivar este dispositivo? Habrá que volver a escribir la cuenta de sala.")) sb.auth.signOut(); });

var staffList = [];
function startDevice() {
  show("device", false); deviceHello();
  q(sb.rpc("pos_staff")).then(function (list) {
    staffList = list || [];
    if (!staffList.length) { $("people").innerHTML = '<p class="muted">Esta cuenta no está autorizada como dispositivo de sala, o nadie tiene PIN todavía (Gestión → Nómina).</p>'; }
    lock();
  }).catch(fail);
  loadMenu();
}
function lock() {
  U = null; pinBuf = ""; selected = null; show("btnFull", false); show("bottomNav", false); show("orderBar", false); document.body.classList.remove("has-bar");
  ["tablesView", "orderView", "btnCaja", "btnUser"].forEach(function (id) { show(id, false); }); show("pin", true); show("padBox", false);
  $("people").innerHTML = staffList.map(function (s) { return '<button type="button" data-emp="' + s.id + '">' + avatar(s.name, s.id) + "<span>" + esc(s.name) + "</span></button>"; }).join("");
  closeDialogs(); if (typeof setMarking === "function" && marking) setMarking(false);
}
var selected = null, pinBuf = "";
$("people").addEventListener("click", function (e) {
  var b = e.target.closest("[data-emp]"); if (!b) return;
  selected = staffList.find(function (s) { return String(s.id) === b.dataset.emp; });
  document.querySelectorAll("#people button").forEach(function (x) { x.classList.toggle("on", x === b); });
  pinBuf = ""; $("pinErr").textContent = ""; drawDots(); show("padBox", true);
});
$("pad").innerHTML = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].map(function (k) { return '<button type="button" data-k="' + k + '">' + k + "</button>"; }).join("");
function drawDots() { $("dots").textContent = "●".repeat(pinBuf.length) + "○".repeat(Math.max(0, 4 - pinBuf.length)); }
$("pad").addEventListener("click", function (e) {
  var b = e.target.closest("[data-k]"); if (!b || !selected) return;
  var k = b.dataset.k;
  if (k === "⌫") pinBuf = pinBuf.slice(0, -1);
  else if (k === "✓" || pinBuf.length < 4) { if (k !== "✓") pinBuf += k; }
  drawDots();
  if (pinBuf.length === 4) tryPin();
});
// ---- Asistencia: marcar con el PIN, sin entrar a la tablet
var marking = false, markWho = null;
var MARKS = { "in": "Llegué", break_start: "Salgo a descanso", break_end: "Volví del descanso", out: "Me voy" };
function setMarking(on) {
  marking = on; document.body.classList.toggle("marking", on);
  $("pinTitle").textContent = on ? "¿Quién va a marcar?" : "¿Quién está usando la tablet?";
  $("markMode").textContent = on ? "← Volver" : "🕘 Marcar llegada o salida";
  selected = null; pinBuf = ""; show("padBox", false); document.querySelectorAll("#people button").forEach(function (x) { x.classList.remove("on"); });
}
$("markMode").addEventListener("click", function () { setMarking(!marking); });
function drawMark(st) {
  $("markTitle").textContent = st.name || markWho.name;
  $("markToday").textContent = st.events.length ? "Hoy: " + st.events.map(function (e) { return MARKS[e.kind] ? MARKS[e.kind].toLowerCase() + " " + new Date(e.at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) : ""; }).filter(Boolean).join(" · ") : "Todavía no has marcado hoy.";
  $("markOpts").innerHTML = st.next.map(function (k) { return '<button type="button" class="' + (k === "in" || k === "break_end" ? "ok" : k === "out" ? "danger" : "") + '" data-mark="' + k + '">' + MARKS[k] + "</button>"; }).join("");
}
$("markOpts").addEventListener("click", function (e) {
  var b = e.target.closest("[data-mark]"); if (!b || !markWho) return; b.disabled = true;
  q(sb.rpc("pos_mark", { p_emp: markWho.id, p_pin: markWho.pin, p_kind: b.dataset.mark, p_device: devName() })).then(function () {
    toast(MARKS[b.dataset.mark] + " · " + new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) + " ✓");
    var who = markWho; $("markDlg").close(); markWho = null; setMarking(false);
    if (b.dataset.mark === "in") showAnnouncements({ id: who.id, pin: who.pin });
  }).catch(function (err) { b.disabled = false; toast(errMsg(err), true); });
});
$("markClose").addEventListener("click", function () { $("markDlg").close(); markWho = null; setMarking(false); });
function tryPin() {
  var emp = selected, pin = pinBuf;
  if (marking) {
    q(sb.rpc("pos_mark_status", { p_emp: emp.id, p_pin: pin })).then(function (st) {
      pinBuf = ""; drawDots(); markWho = { id: emp.id, name: emp.name, pin: pin }; drawMark(st); $("markDlg").showModal();
    }).catch(function (err) { pinBuf = ""; drawDots(); $("pinErr").textContent = /PIN/.test(errMsg(err)) ? "PIN incorrecto" : errMsg(err); });
    return;
  }
  q(sb.rpc("pos_check_pin", { p_emp: emp.id, p_pin: pin })).then(function (r) {
    if (!r || !r.ok) { pinBuf = ""; drawDots(); $("pinErr").textContent = (r && r.error) || "PIN incorrecto"; return; }
    U = { id: emp.id, name: r.name || emp.name, pin: pin, charge: !!r.can_charge };
    document.body.classList.toggle("nocharge", !U.charge);
    show("pin", false); show("btnCaja", true); show("btnUser", true); $("btnUser").innerHTML = avatar(U.name, U.id) + "<span>" + esc(U.name) + ' · <span class="muted">Salir</span></span>';
    touch(); keepAwake(); syncFull(); goTables(); showAnnouncements({ id: U.id, pin: U.pin });
  }).catch(fail);
}
$("btnUser").addEventListener("click", lock);
// Bloqueo automático tras 3 minutos sin uso.
var idle;
function touch() { clearTimeout(idle); if (U) idle = setTimeout(function () { toast("Sesión bloqueada por inactividad"); lock(); }, 180000); }
["pointerdown", "keydown"].forEach(function (ev) { document.addEventListener(ev, touch, true); });

// ---------------------------------------------------------------- Teléfono: barras inferiores y pantalla encendida
function syncBars() {
  var inTables = U && !$("tablesView").classList.contains("hidden"), inOrder = U && !$("orderView").classList.contains("hidden");
  show("bottomNav", !!inTables); show("orderBar", !!inOrder);
  document.body.classList.toggle("has-bar", !!(inTables || inOrder));
  document.querySelectorAll("#bottomNav [data-go]").forEach(function (b) {
    var g = b.dataset.go; b.classList.toggle("on", g === "caja" ? false : g === "mesas" ? AREAS.concat(["Para llevar", "Delivery"]).indexOf(cur.area) >= 0 : cur.area === g);
  });
  if (ST) { var n = ST.orders.filter(function (o) { return o.precuenta_at; }).length; $("navDue").textContent = n; show("navDue", n > 0); }
}
$("bottomNav").addEventListener("click", function (e) {
  var b = e.target.closest("[data-go]"); if (!b) return; var g = b.dataset.go;
  if (g === "caja") { openCash(); return; }
  if (g === "mesas") { var last; try { last = localStorage.getItem("pos-last-area"); } catch (e2) {} cur.area = last || "Tokio"; }
  else cur.area = g;
  try { localStorage.setItem("pos-area", cur.area); } catch (e3) {}
  drawTables(); window.scrollTo(0, 0);
});
$("obToggle").addEventListener("click", function () { $("toggleMenu").click(); syncOrderBar(); window.scrollTo(0, 0); });
var obChanged = 0;
$("obSend").addEventListener("click", function () {
  var m = this.dataset.mode;
  // Al enviar, este mismo botón pasa a «Precuenta» o «Cobrar»: un segundo toque seguido no debe imprimir ni cobrar
  if (m !== "send" && Date.now() - obChanged < 2500) { toast("Listo. Si quieres la " + (m === "pay" ? "cuenta" : "precuenta") + ", vuelve a tocar en un momento"); return; } if (m === "pay") $("pay").click(); else if (m === "bill") $("precuenta").click(); else $("send").click();
});
function syncOrderBar() {
  if (!cur.data) return;
  var g = $("orderGrid"), showingMenu = g.classList.contains("show-menu"), pending = cur.cart.length + cur.data.items.filter(function (i) { return i.status === "pendiente"; }).length;
  var count = cur.cart.reduce(function (s2, c) { return s2 + c.qty; }, 0) + cur.data.items.filter(function (i) { return i.status !== "anulado"; }).reduce(function (s2, i) { return s2 + num(i.qty); }, 0);
  $("obCount").textContent = count + (count === 1 ? " plato" : " platos") + (pending ? " · " + pending + " sin enviar" : "");
  $("obTotal").textContent = ref(cur.due || 0);
  $("obToggle").textContent = showingMenu ? "Ver cuenta" : "Ver carta";
  // Botón principal según el momento: enviar lo nuevo → cobrar (o pedir la precuenta si no puede cobrar)
  var hasItems = cur.data.items.some(function (i) { return i.status !== "anulado"; }), b = $("obSend");
  var mode = pending ? "send" : !hasItems ? "none" : U && U.charge ? "pay" : "bill";
  if (b.dataset.mode !== mode) obChanged = Date.now(); // el botón cambió: no se acepta un toque «de rebote»
  b.dataset.mode = mode;
  b.disabled = b.dataset.mode === "none";
  b.textContent = { send: "Enviar (" + pending + ")", pay: "Cobrar", bill: "Precuenta", none: "Enviar" }[b.dataset.mode];
  b.className = b.dataset.mode === "pay" ? "ok" : "primary";
}
// Pantalla completa (para tablets sin «instalar app», como las Fire con Silk)
var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone;
var canFull = !standalone && (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function goFull() {
  var el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen;
  try { var r = f && f.call(el); if (r && r.catch) r.catch(function () {}); } catch (e) {}
}
function syncFull() { show("btnFull", !!(canFull && U && !isFull())); }
if (canFull) {
  $("btnFull").addEventListener("click", function () { goFull(); try { localStorage.setItem("pos-full", "1"); } catch (e) {} });
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) { document.addEventListener(ev, syncFull); });
  // Si ya se eligió pantalla completa, se recupera con el primer toque (los navegadores exigen un toque).
  document.addEventListener("pointerdown", function () {
    var want = false; try { want = localStorage.getItem("pos-full") === "1"; } catch (e) {}
    if (want && U && !isFull()) goFull();
  }, true);
}
var wake = null;
function keepAwake() {
  try { if (navigator.wakeLock && !wake && document.visibilityState === "visible") navigator.wakeLock.request("screen").then(function (w) { wake = w; w.addEventListener("release", function () { wake = null; }); }).catch(function () {}); } catch (e) {}
}
document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && U) keepAwake(); });

function rpc(name, args) { return q(sb.rpc(name, Object.assign({ p_emp: U.id, p_pin: U.pin }, args || {}))); }
