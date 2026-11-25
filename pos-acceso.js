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
  try { if (typeof shibuSalir === "function") shibuSalir(); } catch (e) { console.error(e); }   // Shibu nunca frena el salir
  U = null; pinBuf = ""; selected = null; if (typeof READY !== "undefined") READY = null; if (typeof META !== "undefined") META = null; syncFull(); show("bottomNav", false); show("orderBar", false); document.body.classList.remove("has-bar");
  ["tablesView", "orderView", "btnCaja", "btnUser"].forEach(function (id) { show(id, false); }); show("pin", true); show("padBox", true); show("pinSide", false);
  drawDots(); $("pinErr").textContent = ""; pinWhoTxt();
  if (typeof waStop === "function") waStop();
  if ($("health")) $("health").classList.add("hidden");
  $("people").innerHTML = staffList.map(function (s) { return '<button type="button" data-emp="' + s.id + '">' + avatar(s.name, s.id) + "<span>" + esc(s.name) + "</span></button>"; }).join("");
  closeDialogs(); if (typeof setMarking === "function" && marking) setMarking(false);
}
var selected = null, pinBuf = "";
// Con el PIN basta: la base sabe de quién es. Los nombres no se muestran: solo salen si dos personas comparten PIN
// y hay que tocar el suyo.
function pinWhoTxt() {
  $("pinWho").textContent = selected ? "PIN de " + selected.name + " · toca tu nombre otra vez para quitarlo"
    : "Ese PIN lo tienen dos personas: toca tu nombre y vuelve a escribir tu PIN.";
}
$("people").addEventListener("click", function (e) {
  var b = e.target.closest("[data-emp]"); if (!b) return;
  var s2 = staffList.find(function (s) { return String(s.id) === b.dataset.emp; });
  selected = selected && s2 && selected.id === s2.id ? null : s2;
  document.querySelectorAll("#people button").forEach(function (x) { x.classList.toggle("on", !!selected && x === b); });
  pinBuf = ""; $("pinErr").textContent = ""; drawDots(); pinWhoTxt();
});
$("pad").innerHTML = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].map(function (k) { return '<button type="button" data-k="' + k + '">' + k + "</button>"; }).join("");
function drawDots() { $("dots").textContent = "●".repeat(pinBuf.length) + "○".repeat(Math.max(0, 4 - pinBuf.length)); }
$("pad").addEventListener("click", function (e) {
  var b = e.target.closest("[data-k]"); if (!b) return;
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
  $("pinTitle").textContent = on ? "Escribe tu PIN para marcar" : "Escribe tu PIN para entrar";
  $("markMode").textContent = on ? "← Volver" : "🕘 Marcar llegada o salida";
  selected = null; pinBuf = ""; show("padBox", true); show("pinSide", false); drawDots(); $("pinErr").textContent = ""; pinWhoTxt();
  document.querySelectorAll("#people button").forEach(function (x) { x.classList.remove("on"); });
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
  if (!emp) {
    // Solo el PIN: la base dice de quién es (sin marcar entrada si es para marcar llegada o salida)
    q(sb.rpc("pos_pin_login", { p_pin: pin, p_entrar: !marking })).then(function (r) {
      if (!r || !r.ok) { pinBuf = ""; drawDots(); $("pinErr").textContent = (r && r.error) || "PIN incorrecto"; if (r && r.elegir) { $("pinWho").textContent = "Toca tu nombre y vuelve a escribir tu PIN."; show("pinSide", true); } return; }
      var who = staffList.find(function (s) { return s.id === r.id; }) || { id: r.id, name: r.name };
      if (marking) { selected = who; tryPin(); return; }   // marcar sigue el camino de siempre, ya con la persona
      entrar(who, pin, r);
    }).catch(function (err) { pinBuf = ""; drawDots(); $("pinErr").textContent = errMsg(err); });
    return;
  }
  if (marking) {
    q(sb.rpc("pos_mark_status", { p_emp: emp.id, p_pin: pin })).then(function (st) {
      pinBuf = ""; drawDots(); markWho = { id: emp.id, name: emp.name, pin: pin }; drawMark(st); $("markDlg").showModal();
    }).catch(function (err) { pinBuf = ""; drawDots(); $("pinErr").textContent = /PIN/.test(errMsg(err)) ? "PIN incorrecto" : errMsg(err); });
    return;
  }
  q(sb.rpc("pos_check_pin", { p_emp: emp.id, p_pin: pin })).then(function (r) {
    if (!r || !r.ok) { pinBuf = ""; drawDots(); $("pinErr").textContent = (r && r.error) || "PIN incorrecto"; return; }
    entrar(emp, pin, r);
  }).catch(fail);
}
function entrar(emp, pin, r) {
  U = { id: emp.id, name: r.name || emp.name, pin: pin, charge: !!r.can_charge };
  document.body.classList.toggle("nocharge", !U.charge);
  show("pin", false); show("btnCaja", true); show("btnUser", true); $("btnUser").innerHTML = avatar(U.name, U.id) + '<span class="quien">' + esc(U.name) + '</span><span class="salir muted">· Salir</span>';
  touch(); keepAwake(); syncFull(); goTables(); showAnnouncements({ id: U.id, pin: U.pin }); loadTopDishes(); loadNotas(); loadPromos(); loadMeta(); waStart();
  try { if (typeof shibuEntrar === "function") shibuEntrar(); } catch (e) { console.error(e); }
}
$("btnUser").addEventListener("click", lock);
// Bloqueo automático tras 10 minutos sin uso.
var idle;
function touch() { clearTimeout(idle); if (U) idle = setTimeout(function () { toast("Sesión bloqueada por inactividad"); lock(); }, 600000); }
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
// Pantalla completa: el botón está siempre arriba, también en la pantalla del PIN y en la app instalada.
// Una vez puesta, la tablet vuelve sola a pantalla completa con el primer toque si se sale (al recargar, con el teclado…).
// El mismo botón la quita. Si la app ya abre en pantalla completa (instalada así), el botón no hace falta.
var appFull = !!(window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches) && !(document.fullscreenElement || document.webkitFullscreenElement);
var canFull = !appFull && !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
var FULL_ON = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
var FULL_OFF = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function wantFull() { try { return localStorage.getItem("pos-full") === "1"; } catch (e) { return false; } }
function goFull() {
  var el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen;
  try { var r = f && f.call(el); if (r && r.catch) r.catch(function () {}); } catch (e) {}
}
function exitFull() {
  var f = document.exitFullscreen || document.webkitExitFullscreen;
  try { var r = f && f.call(document); if (r && r.catch) r.catch(function () {}); } catch (e) {}
}
function syncFull() {
  show("btnFull", canFull); if (!canFull) return;
  var b = $("btnFull"), on = isFull(), t = on ? "Salir de pantalla completa" : "Pantalla completa";
  if (b.dataset.on !== String(on)) { b.dataset.on = String(on); b.innerHTML = on ? FULL_OFF : FULL_ON; b.setAttribute("aria-label", t); b.title = t; }
}
if (canFull) {
  $("btnFull").addEventListener("click", function () {
    if (isFull()) { try { localStorage.removeItem("pos-full"); } catch (e) {} exitFull(); }
    else { try { localStorage.setItem("pos-full", "1"); } catch (e) {} goFull(); }
  });
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) { document.addEventListener(ev, syncFull); });
  // Si ya se eligió pantalla completa, se recupera con el primer toque (los navegadores exigen un toque), con o sin sesión.
  document.addEventListener("pointerdown", function (e) {
    if (e.target && e.target.closest && e.target.closest("#btnFull")) return;   // el botón decide
    if (wantFull() && !isFull()) goFull();
  }, true);
}
syncFull();
// La maid del día en la pantalla del PIN. Sale en las tablets y en la laptop, acostadas o paradas; en teléfonos no sale
// y la imagen ni se descarga. Cada día le toca a una (Miso, Dango, Imo) y cada una tiene 10 frases que se turnan.
// Su alto es una parte del alto de la pantalla (MAID_ESCALA); si así tapara algún texto o botón, se achica hasta
// que no tape nada, y si no cabe, ese día no sale.
var MAID_ESCALA = { acostada: 0.62, parada: 0.34 };
var MAIDS = [
  { img: "miso", hola: "¡Okaerinasai!", frases: [
    "¿Listos para el ramen? Yo ya revisé todo dos veces.",
    "Respira, sonríe y escribe tu PIN. Hoy sale todo bien.",
    "Imaginé mil cosas que podían salir mal… y no pasó ninguna.",
    "Cada cliente que entra llega a casa. Recíbelo así.",
    "Un buen caldo no se apura. Una buena maid tampoco.",
    "Si algo se complica, avísame. Aquí nadie atiende solo.",
    "Fui la primera de mi clase. Hoy la primera mesa es tuya.",
    "Mi perrito me despidió en la puerta. Ahora te recibo yo.",
    "Horrores cósmicos: vencidos. Hora pico: vamos por ella.",
    "Si cerramos bonito, hoy me premio con puré."] },
  { img: "dango-moto", hola: "¡Okaerinasaiii!", frases: [
    "¡Hoy va a ser un día dulce! Lo presiento.",
    "¡Llegué volando en mi moto para verte!",
    "Sonrisa puesta, delantal puesto… ¿y tu PIN? ¡Eso!",
    "¡Ofrece un postre en cada mesa! Bueno… o dos.",
    "Me distraje mirando los postres. ¿Qué hacía? ¡Ah, tu PIN!",
    "¡Atender mesas es lo que más me gusta después de los dulces!",
    "Anoche serví bobas dormida. ¡Hoy despierta lo hago mejor!",
    "¡Cada cliente es un amigo que todavía no conoces!",
    "Hoy no se me cae ni un plato… ¡creo!",
    "Al salir me voy de compras. ¡Pero primero, a brillar!"] },
  { img: "imo", hola: "Okaerinasai…", frases: [
    "Escribe tu PIN y a jugar.",
    "Nivel nuevo desbloqueado: el turno de hoy. Dificultad: normal.",
    "Mi café y yo te damos la bienvenida. Sobre todo el café.",
    "Saqué tu carta del tarot: hoy cobras sin errores. No me falles.",
    "Guarda la partida y entra. Las mesas no se atienden solas.",
    "Si la tablet se cuelga, no la sacudas. Llámame.",
    "Hice las cuentas: sonreír sube las propinas. Tú verás.",
    "No cocino, pero sirvo como profesional. Tú también.",
    "Misión del día: sobrevivir a la hora pico. Recompensa: café.",
    "Sí, sí, ya dije okaerinasai. Ahora escribe tu PIN."] }
];
// Silueta de cada maid en 32 franjas de arriba abajo: desde dónde hasta dónde hay dibujo (en % del ancho de la imagen).
// Sirve para acomodarla en el hueco libre sin tapar nada.
var MAID_SILUETA = {
  "miso": [[48,70],[46,74],[40,78],[39,81],[41,87],[2,90],[0,99],[16,100],[19,96],[25,93],[32,86],[39,86],[36,88],[30,92],[28,93],[30,93],[37,93],[43,76],[45,73],[47,71],[49,70],[51,74],[51,75],[51,75],[51,76],[53,77],[56,79],[58,81],[59,81],[60,80],[60,74],[60,69]],
  "dango-moto": [[41,61],[39,64],[37,67],[36,71],[32,73],[33,91],[30,91],[12,88],[12,86],[16,90],[16,90],[11,89],[8,84],[22,81],[20,86],[19,87],[18,87],[17,90],[16,97],[16,99],[16,100],[16,100],[14,100],[12,96],[11,95],[9,92],[7,89],[2,87],[0,68],[1,69],[17,69],[21,69]],
  "imo": [[42,66],[23,72],[16,73],[9,98],[6,100],[7,100],[16,99],[16,98],[19,97],[20,92],[42,89],[38,78],[32,85],[30,93],[25,93],[23,91],[22,86],[27,78],[34,79],[32,80],[32,82],[31,85],[30,88],[29,89],[27,89],[25,89],[23,88],[17,91],[13,92],[0,93],[0,94],[8,93]]
};
// Dónde y de qué alto va la maid sin tapar nada. Prueba de grande a chica: abajo a la derecha (saliéndose un poco por
// abajo) o parada junto al teclado si a su derecha queda espacio. El globito va a la izquierda, lo más cerca posible
// de su cara, o encima de su cabeza. Devuelve null si no cabe. (La página de prueba de tamaños usa esta misma función.)
// o: { W, H, prop (ancho/alto de la imagen), sil, max (alto máximo), estorbos [rect], teclado (rect o null), globos [{w,h}] }
function colocarMaid(o) {
  function choca(c) {
    for (var i = 0; i < o.estorbos.length; i++) { var e = o.estorbos[i]; if (c.l < e.right && c.r > e.left && c.t < e.bottom && c.b > e.top) return true; }
    return false;
  }
  var lugares = [function (a) { return { x1: o.W - 36, y1: o.H + a * 0.08 }; }];
  if (o.teclado && o.W - o.teclado.right >= 130) lugares.push(function () { return { x1: o.W - 10, y1: o.teclado.bottom }; });
  for (var a = Math.round(o.max); a >= 180; a -= 6) {
    for (var k = 0; k < lugares.length; k++) {
      var L = lugares[k](a), w = a * o.prop, x0 = L.x1 - w, y0 = L.y1 - a, fh = a / o.sil.length, bandas = [], i;
      if (x0 < 8 || y0 < 0) continue;
      for (i = 0; i < o.sil.length && y0 + i * fh < o.H; i++) {
        var f = o.sil[i];
        if (f[1] > f[0]) bandas.push({ l: x0 + w * f[0] / 100, r: x0 + w * f[1] / 100, t: y0 + i * fh, b: y0 + (i + 1) * fh });
      }
      if (bandas.some(choca)) continue;
      for (var gi = 0; gi < o.globos.length; gi++) {
        var G = o.globos[gi];
        for (var t = y0 + a * 0.04; t <= y0 + a * 0.22 && t + G.h <= o.H - 8; t += 6) {   // junto a la cara, no más abajo
          var der = o.W;
          bandas.forEach(function (b) { if (b.b > t && b.t < t + G.h) der = Math.min(der, b.l); });
          var c = { l: der - 8 - G.w, r: der - 8, t: t, b: t + G.h };
          if (c.l >= 8 && !choca(c)) return { alto: a, x: x0, y: y0, globo: c, g: gi };
        }
        var hx = x0 + w * (o.sil[1][0] + o.sil[1][1]) / 200, cl = Math.max(8, Math.min(hx - G.w / 2, o.W - 10 - G.w));
        var c2 = { l: cl, r: cl + G.w, t: y0 - G.h - 6, b: y0 - 6 };
        if (c2.t >= 0 && !choca(c2)) return { alto: a, x: x0, y: y0, globo: c2, g: gi };
      }
    }
  }
  return null;
}
(function maidDelDia() {
  var mq = window.matchMedia && window.matchMedia("(min-width: 600px) and (min-height: 480px)");
  if (!mq || !mq.matches) return;
  var dia = Math.floor((Date.now() - 4 * 3600e3) / 864e5), m = MAIDS[dia % MAIDS.length];   // el día cambia a medianoche en Venezuela
  var img = $("maidPin"), bub = $("maidBub"), pin = $("pin"), rg = document.createRange(), pend = false;
  bub.innerHTML = esc(m.hola) + "<small>" + esc(m.frases[Math.floor(dia / MAIDS.length) % m.frases.length]) + "</small>";
  // Lo que no se puede tapar: la barra de arriba y los textos y botones de la pantalla del PIN
  function estorbos() {
    var out = [document.querySelector("header").getBoundingClientRect()];
    pin.querySelectorAll("h2, p, button").forEach(function (el) {
      var r;
      if (el.tagName === "BUTTON") r = el.getBoundingClientRect(); else { rg.selectNodeContents(el); r = rg.getBoundingClientRect(); }
      if (r.width && r.height) out.push(r);
    });
    return out;
  }
  // Dónde están de verdad las teclas (la caja del teclado ocupa todo el ancho aunque las teclas vayan al centro)
  function teclado() {
    var t = { left: 1e9, top: 1e9, right: 0, bottom: 0, width: 0 };
    $("pad").querySelectorAll("button").forEach(function (b) {
      var r = b.getBoundingClientRect();
      if (r.width) { t.left = Math.min(t.left, r.left); t.top = Math.min(t.top, r.top); t.right = Math.max(t.right, r.right); t.bottom = Math.max(t.bottom, r.bottom); t.width = t.right - t.left; }
    });
    return t;
  }
  function acomodar() {
    pend = false;
    var W = window.innerWidth, H = window.innerHeight, r = null, angosto = 170;
    if (mq.matches && img.naturalWidth && !pin.classList.contains("hidden")) {
      bub.hidden = false; bub.style.cssText = "left:0;top:0;right:auto;bottom:auto";   // un instante, para medirlo (no llega a pintarse)
      var g1 = { w: bub.offsetWidth, h: bub.offsetHeight }, pad = teclado();
      angosto = Math.max(130, Math.min(170, pad.width ? W - pad.right - 22 : 170));   // el angosto cabe al lado del teclado
      bub.style.maxWidth = angosto + "px";
      var g2 = { w: bub.offsetWidth, h: bub.offsetHeight };
      r = colocarMaid({ W: W, H: H, prop: img.naturalWidth / img.naturalHeight, sil: MAID_SILUETA[m.img], max: H * (W > H ? MAID_ESCALA.acostada : MAID_ESCALA.parada),
        estorbos: estorbos(), teclado: pad.width ? pad : null, globos: g2.w < g1.w ? [g1, g2] : [g1] });
    }
    img.hidden = bub.hidden = !r;
    if (!r) return;
    img.style.cssText = "left:" + Math.round(r.x) + "px;top:" + Math.round(r.y) + "px;height:" + r.alto + "px;right:auto;bottom:auto";
    bub.style.cssText = "left:" + Math.round(r.globo.l) + "px;top:" + Math.round(r.globo.t) + "px;right:auto;bottom:auto" + (r.g ? ";max-width:" + angosto + "px" : "");
  }
  function pedir() { if (!pend) { pend = true; requestAnimationFrame(acomodar); } }
  img.addEventListener("load", pedir); window.addEventListener("resize", pedir); window.addEventListener("scroll", pedir, { passive: true });
  if (window.MutationObserver) new MutationObserver(pedir).observe(pin, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden"] });
  img.src = "assets/maids/" + m.img + ".webp";
})();
var wake = null;
function keepAwake() {
  try { if (navigator.wakeLock && !wake && document.visibilityState === "visible") navigator.wakeLock.request("screen").then(function (w) { wake = w; w.addEventListener("release", function () { wake = null; }); }).catch(function () {}); } catch (e) {}
}
document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && U) keepAwake(); });

function rpc(name, args) { return q(sb.rpc(name, Object.assign({ p_emp: U.id, p_pin: U.pin }, args || {}))); }
