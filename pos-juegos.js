// Juegos del personal con fichas: tragamonedas, ruleta y blackjack (ventana #jgoDlg de pos.html; estilos en juegos.css).
// Las fichas se ganan con las misiones del día y cada jugada cuesta una. Lo que sale lo decide SIEMPRE el servidor
// (jgo_tragamonedas, jgo_ruleta, jgo_bj_empezar y jgo_bj_accion): aquí solo se anima lo que devolvió y se muestra el
// premio. Cada respuesta trae los contadores al día (fichas, puntos, ganado_hoy, tope_dia) y el resultado en palabras
// (mensaje), que va debajo del juego. Lo que dice Shibu en su globito sale de data/shibu.json (shibuFrase, pos-shibu.js).
// Se abre con abrirJuegos(). Con «reducir movimiento» en el equipo no hay giros ni confeti: el resultado sale de una vez.
"use strict";
var JGO = {
  emp: null,          // de quién es lo que está en pantalla (si entra otra persona, todo vuelve a empezar)
  vista: "menu",      // menu · slot · rul · bj
  ocupado: false,     // hay una jugada en curso (esperando al servidor o animando): no se puede empezar otra
  st: { fichas: null, puntos: null, ganado_hoy: 0, tope_dia: 3, activo: true },
  bjMostrado: null    // blackjack: la última respuesta que ya terminó de verse en la mesa (los botones y el id van según esta)
};
var JGO_VISTAS = { menu: "jgoMenu", slot: "jgoSlot", rul: "jgoRul", bj: "jgoBj" };
var JGO_EMO = { shibu: "🐶", ramen: "🍜", sushi: "🍣", taiyaki: "🐟", dango: "🍡", estrella: "⭐" };
var JGO_NOM = { shibu: "Shibu", ramen: "Ramen", sushi: "Sushi", taiyaki: "Taiyaki", dango: "Dango", estrella: "Estrella" };
// Orden de los símbolos en cada carrete (distinto en cada uno para que no giren parejos)
var JGO_ORDEN = [
  ["ramen", "shibu", "sushi", "estrella", "taiyaki", "dango"],
  ["sushi", "dango", "ramen", "taiyaki", "shibu", "estrella"],
  ["taiyaki", "estrella", "dango", "shibu", "ramen", "sushi"]];
var JGO_QUIETO = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

function jgoPts(n) { return n + (n === 1 ? " punto" : " puntos"); }
// ¿Girar ya, mientras responde el servidor? Solo si según los últimos contadores la jugada va a pasar; si no (sin
// fichas o con el tope del día lleno) se espera su respuesta para no girar en vano. Igual decide el servidor.
function jgoGiraYa() { var s = JGO.st; return s.fichas !== 0 && !(s.ganado_hoy >= s.tope_dia); }
// Una frase de Shibu (data/shibu.json); si el archivo no cargó, el texto de respaldo. Nunca decide un resultado.
function jgoFrase(tipo, resp) { return (typeof shibuFrase === "function" && shibuFrase(tipo)) || resp || ""; }
function jgoAhora() { return performance.now() / 1000; }
function jgoMod(a) { return ((a % 360) + 360) % 360; }
// ¿Se anima? No con «reducir movimiento», ni con la ventana cerrada, ni si ese juego no está a la vista, ni mientras
// jgoAcabarYa() termina todo de golpe (así no queda un efecto a medias que se repita al volver a ese juego)
var jgoCortando = false;
function jgoAnima(vista) { return !jgoCortando && !(JGO_QUIETO && JGO_QUIETO.matches) && $("jgoDlg").open && !document.hidden && (!vista || JGO.vista === vista); }
// Arranca desde quieto hasta la velocidad v en A segundos y sigue a v
function jgoArranque(p0, v, A, t) { return t <= 0 ? p0 : t < A ? p0 + v * t * t / (2 * A) : p0 + v * (t - A / 2); }
// Curva de Hermite: sale de p0 con velocidad v0 y llega a p1 con velocidad v1 en T segundos (frenadas sin saltos)
function jgoHermite(p0, v0, p1, v1, T, t) {
  var s = Math.max(0, Math.min(1, t / T)), s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * T * v0 + (3 * s2 - 2 * s3) * p1 + (s3 - s2) * T * v1;
}

// ---------------------------------------------------------------- Animación: un solo bucle para lo que se mueve
// Cada animación tiene paso(t) (devuelve true al terminar) y fin() (salta al final). jgoAcabarYa() termina todo de una
// vez: al cambiar de juego o cerrar la ventana, lo que estaba girando queda en su resultado.
var JGO_ANIM = [], jgoRaf = 0;
function jgoAnimar(paso, fin) {
  var a = { paso: paso, fin: fin, hecho: false };
  JGO_ANIM.push(a); if (!jgoRaf) jgoRaf = requestAnimationFrame(jgoCuadro);
  return a;
}
function jgoCuadro() {
  jgoRaf = 0; var t = jgoAhora(), l = JGO_ANIM; JGO_ANIM = [];
  l.forEach(function (a) { if (a.hecho) return; if (a.paso(t)) a.hecho = true; else JGO_ANIM.push(a); });
  if (JGO_ANIM.length && !jgoRaf) jgoRaf = requestAnimationFrame(jgoCuadro);
}
function jgoAcabarYa() {
  var l = JGO_ANIM; JGO_ANIM = []; if (jgoRaf) cancelAnimationFrame(jgoRaf); jgoRaf = 0;
  jgoCortando = true;
  try { l.forEach(function (a) { if (!a.hecho) { a.hecho = true; a.fin(); } }); jgoColaYa(); } finally { jgoCortando = false; }
}
// Pasos con pausas (el reparto del blackjack); jgoColaYa() hace los que faltan sin esperar
var JGO_COLA = [], jgoColaT = 0;
function jgoCola(fn, espera) { JGO_COLA.push([fn, espera]); if (!jgoColaT) jgoColaSigue(); }
function jgoColaSigue() {
  jgoColaT = 0; var p = JGO_COLA.shift(); if (!p) return;
  try { p[0](); } catch (e) { console.error(e); }   // un paso que falla no deja la mesa trabada
  var ms = jgoAnima("bj") ? p[1] : 0;
  if (ms) jgoColaT = setTimeout(jgoColaSigue, ms); else jgoColaSigue();
}
function jgoColaYa() { clearTimeout(jgoColaT); jgoColaT = 0; while (JGO_COLA.length) try { JGO_COLA.shift()[0](); } catch (e) { console.error(e); } }

// ---------------------------------------------------------------- Ventana, contadores y Shibu
function abrirJuegos() {
  if (!U) return;
  if (JGO.emp !== U.id) jgoReiniciar();
  JGO.emp = U.id;
  var d = $("jgoDlg");
  if (!d.open) d.showModal();
  jgoVista("menu", true);
  jgoDice("Un momento…");
  // Las frases y la cara de Shibu (data/shibu.json) ya suelen estar cargadas desde que entró; si no, se esperan aquí
  var frases = typeof shibuFrases === "function" ? shibuFrases() : Promise.resolve();
  jgoShibuImg();
  rpc("jgo_estado").then(function (r) { return frases.then(function () { return r; }); }).then(function (r) {
    jgoTomar(r, true); jgoShibuImg(); jgoRulCasillas(r && r.casillas);
    if (JGO.vista === "menu") jgoSaludo(r && r.mensaje);
  }).catch(function (e) { jgoError(e, true); });
}
// Toma los contadores de una respuesta. Con todo=false solo las fichas: la ficha se gasta al jugar, pero los puntos se
// ven cuando termina la animación (si no, se sabría el resultado antes de que paren los carretes).
function jgoTomar(r, todo) {
  if (!r) return;
  var s = JGO.st;
  if (r.fichas != null) s.fichas = num(r.fichas);
  if (todo) {
    if (r.puntos != null) s.puntos = num(r.puntos);
    if (r.ganado_hoy != null) s.ganado_hoy = num(r.ganado_hoy);
    if (r.tope_dia != null) s.tope_dia = num(r.tope_dia) || 3;
    if (r.activo != null) s.activo = r.activo !== false;
    if (r.casillas) jgoRulCasillas(r.casillas);
  }
  jgoPintaCont(); jgoBotones();
}
function jgoPintaCont() {
  var s = JGO.st, t = Math.max(1, Math.min(10, s.tope_dia || 3)), g = Math.max(0, Math.min(t, s.ganado_hoy || 0)), h = "";
  $("jgoFichas").textContent = "Fichas: " + (s.fichas == null ? "–" : s.fichas);
  $("jgoPuntos").textContent = "Puntos: " + (s.puntos == null ? "–" : s.puntos);
  $("jgoHoy").textContent = "Hoy ganaste " + g + " de " + t + " puntos jugando";
  for (var i = 0; i < t; i++) h += "<i" + (i < g ? ' class="on"' : "") + "></i>";
  $("jgoPips").innerHTML = h;
  $("jgoFichasBox").classList.toggle("cero", s.fichas === 0);
  show("jgoApagado", !s.activo);
  $("jgoDlg").classList.toggle("apagado", !s.activo);
}
function jgoBotones() {
  var act = JGO.st.activo, oc = JGO.ocupado, bj = JGO.bjMostrado, jugando = !!bj && bj.estado === "jugando";
  document.querySelectorAll("#jgoMenu [data-jgo]").forEach(function (b) { b.disabled = !act; });
  $("jgoGirar").disabled = !act || oc;
  $("jgoRulGirar").disabled = !act || oc;
  show("jgoRepartir", !bj); show("jgoOtra", !!bj && !jugando); show("jgoPedir", jugando); show("jgoPlantarse", jugando);
  $("jgoRepartir").disabled = $("jgoOtra").disabled = !act || oc;
  $("jgoPedir").disabled = $("jgoPlantarse").disabled = oc;
}
function jgoOcupado(juego) {
  JGO.ocupado = !!juego;
  ["slot", "rul", "bj"].forEach(function (k) { $(JGO_VISTAS[k]).classList.toggle("girando", juego === k); });
  jgoBotones();
}
function jgoVista(v, abriendo) {
  var antes = JGO.vista;
  if (antes !== v) { jgoAcabarYa(); jgoSinEfectos(); }   // lo que se estaba animando queda en su resultado
  JGO.vista = v;
  Object.keys(JGO_VISTAS).forEach(function (k) { show(JGO_VISTAS[k], k === v); });
  jgoBotones(); if (!abriendo) jgoSaludo();
  $("jgoDlg").scrollTop = 0;
  if (abriendo) return;
  // El foco no se queda en un botón escondido: al juego, en «Volver»; al menú, en la tarjeta del juego de antes
  var f = v === "menu" ? document.querySelector('#jgoMenu [data-jgo="' + antes + '"]') : document.querySelector("#" + JGO_VISTAS[v] + " [data-volver]");
  if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* sin foco */ }
}
// Al entrar a cada parte. En el menú habla Shibu (sus frases); dentro de cada juego, el globito da la instrucción.
function jgoSaludo(msg) {
  var s = JGO.st;
  if (!s.activo) return jgoDice("Los juegos están apagados por hoy", "info");
  if (JGO.vista === "slot") return jgoDice("Toca «Girar»: tres iguales pagan 3 puntos.");
  if (JGO.vista === "rul") return jgoDice("Toca «Girar»: si sale x1, x2 o x3, ganas esos puntos.");
  if (JGO.vista === "bj") return jgoDice(JGO.bjMostrado && JGO.bjMostrado.estado === "jugando" ? "Tienes una mano en juego: ¿pides otra carta o te plantas?" : "Pide cartas hasta acercarte a 21, sin pasarte.");
  if (msg) return jgoDice(msg);
  if (s.fichas === 0) return jgoDice(jgoFrase("sin_fichas", "Sin fichas por ahora: las misiones del día te dan más."));
  if (s.ganado_hoy >= s.tope_dia) return jgoDice(jgoFrase("tope", "Ya ganaste el tope de hoy. Vuelve mañana."));
  jgoDice(jgoFrase("juego_hola", "¿A qué jugamos?"));
}
// Lo que dice Shibu cuando termina una jugada: si el tope del día recortó el premio (al_tope, lo dice el servidor), lo
// del tope; si no, premio mayor, premio, empate o sin premio
function jgoVozFin(r, mayor) {
  var p = num(r.premio);
  if (r.al_tope) return jgoFrase("tope", r.mensaje);
  if (p > 0) return jgoFrase(mayor ? "juego_mayor" : "juego_gana", r.mensaje);
  if (r.estado === "empate") return jgoFrase("juego_empate", r.mensaje);
  return jgoFrase("juego_pierde", r.mensaje);
}
var JGO_TOPE = "llegaste al tope de hoy";
function jgoDice(txt, tipo) {
  var b = $("jgoBub");
  b.textContent = txt;
  b.className = "shibu-bub" + (tipo ? " " + tipo : "");
  if (jgoAnima()) { void b.offsetWidth; b.classList.add("pop"); }
}
// Cuando el servidor no deja jugar. «No tienes fichas…» y «Ya ganaste el tope de hoy…» van debajo del juego tal como
// los dice el servidor, y Shibu lo comenta con su frase; los demás errores los dice el globito. Todo sigue usable.
function jgoSinRed(e) { return /Failed to fetch|NetworkError|Load failed|network|ERR_/i.test(errMsg(e)); }
var JGO_RES = { slot: "jgoSlotRes", rul: "jgoRulRes", bj: "jgoBjRes" };
function jgoError(e, delEstado) {
  var m = errMsg(e);
  if (/PIN incorrecto/.test(m)) { fail(e); return; }   // vuelve a la pantalla del PIN
  var tipo = jgoSinRed(e) ? "" : /No tienes fichas/.test(m) ? "sin_fichas" : /tope de hoy/.test(m) ? "tope" : "";
  if (tipo && JGO_RES[JGO.vista]) { jgoRes(JGO_RES[JGO.vista], m, "aviso"); jgoDice(jgoFrase(tipo, m), "info"); }
  else jgoDice(jgoSinRed(e) ? "No hay conexión con el sistema. Revisa el internet y vuelve a intentarlo." : m, "error");
  // Los contadores, al día con el servidor (por si cambiaron en otro equipo)
  if (U && !delEstado && !jgoSinRed(e)) rpc("jgo_estado").then(function (r) { jgoTomar(r, true); }).catch(function () { /* se queda lo que había */ });
}
// La cara de Shibu: la misma imagen de la bienvenida (data/shibu.json → "imagen"). Mientras no esté, o si no carga,
// queda el círculo naranja con su nombre.
function jgoShibuImg() {
  var img = document.querySelector("#jgoDlg .shibu-img"), badge = document.querySelector("#jgoDlg .shibu-badge");
  var src = typeof SHIBU !== "undefined" && SHIBU.frases && SHIBU.frases.imagen;
  if (!img || !badge) return;
  if (!src) { img.hidden = true; img.removeAttribute("src"); badge.hidden = false; return; }
  if (img.getAttribute("src") === src) return;
  img.onload = function () { img.hidden = false; badge.hidden = true; };
  img.onerror = function () { img.hidden = true; badge.hidden = false; };
  img.src = src;
}
// Resultado debajo del juego: texto, el premio resaltado (si hay) y una nota chica (si el tope del día lo recortó)
function jgoRes(id, txt, cls, premio, nota) {
  var el = $(id);
  el.className = "jgo-res" + (cls ? " " + cls : "");
  el.innerHTML = txt ? '<span' + (cls === "gana" && jgoAnima() ? ' class="nuevo"' : "") + ">" + esc(txt) + (premio ? " <b>" + esc(premio) + "</b>" : "") +
    (nota ? " <small>(" + esc(nota) + ")</small>" : "") + "</span>" : "";
}
// Confeti con los colores de la marca cuando hay premio (nunca con «reducir movimiento»)
function jgoFiesta(vista) {
  if (!jgoAnima()) return;
  var box = document.createElement("div"), h = "", col = ["var(--accent)", "var(--jgo-celeste)", "var(--jgo-oro)", "var(--ink)", "#fff"];
  box.className = "jgo-confeti"; box.setAttribute("aria-hidden", "true");
  for (var i = 0; i < 42; i++) {
    h += '<i style="left:' + (Math.random() * 100).toFixed(1) + "%;background:" + col[i % col.length] + ";--d:" + (Math.random() * 0.35).toFixed(2) + "s;--t:" +
      (1.1 + Math.random() * 0.8).toFixed(2) + "s;--x:" + Math.round(Math.random() * 120 - 60) + "px;--r:" + Math.round(360 + Math.random() * 540) + 'deg"></i>';
  }
  box.innerHTML = h; vista.appendChild(box);
  setTimeout(function () { box.remove(); }, 2400);
}
// Fuera el confeti y los efectos de una sola vez (repartir, golpe del carrete, brinco del premio…): una animación CSS
// vuelve a empezar cada vez que su juego se muestra otra vez
var JGO_EFECTOS = ["entra", "tope", "nuevo", "late", "pop"];
function jgoSinEfectos() {
  document.querySelectorAll("#jgoDlg .jgo-confeti").forEach(function (x) { x.remove(); });
  document.querySelectorAll("#jgoDlg ." + JGO_EFECTOS.join(", #jgoDlg .")).forEach(function (x) { JGO_EFECTOS.forEach(function (k) { x.classList.remove(k); }); });
}
// Otra persona entró en la tablet: nada de lo que había queda a la vista
function jgoReiniciar() {
  jgoAcabarYa();
  JGO.st = { fichas: null, puntos: null, ganado_hoy: 0, tope_dia: 3, activo: true };
  JGO.ocupado = false; JGO.bjMostrado = null;
  JGO_SLOT = null; JGO_RJ = null;
  jgoRes("jgoSlotRes", ""); jgoRes("jgoRulRes", ""); jgoRes("jgoBjRes", "Toca «Repartir» para empezar", "pista");
  JGO_CAR.forEach(function (c) { c.el.classList.remove("gana"); });
  jgoHub(null);
  $("jgoBjJ").innerHTML = ""; $("jgoBjC").innerHTML = ""; $("jgoBjTotJ").textContent = ""; $("jgoBjTotC").textContent = ""; JGO_BJV = { j: [], c: [] };
  ["slot", "rul", "bj"].forEach(function (k) { $(JGO_VISTAS[k]).classList.remove("girando"); });
  jgoPintaCont(); jgoBotones();
}

// ---------------------------------------------------------------- Tragamonedas
// Cada carrete dibuja solo las 4 casillas que se ven. La casilla k muestra orden[k mod 6], salvo las que el servidor
// manda poner («over»): al frenar, el símbolo que salió se pone en la casilla donde va a parar, que todavía no se ve.
var JGO_V = 18, JGO_A = 0.25, JGO_T = 0.5, JGO_ENTRE = 0.6;   // símbolos por segundo, arranque, frenada, entre paradas
var JGO_CAR = [], JGO_SLOT = null;
function jgoCarCrear() {
  var box = $("jgoCarretes");
  JGO_ORDEN.forEach(function (orden) {
    var el = document.createElement("div"), tira = document.createElement("div");
    el.className = "jgo-carrete"; el.setAttribute("role", "img"); tira.className = "jgo-tira"; el.appendChild(tira);
    var c = { el: el, orden: orden, p: 0, over: {}, celdas: [], plan: null, t0: 0, p0: 0, parado: true };
    for (var j = 0; j < 4; j++) { var s = document.createElement("span"); s.className = "jgo-sim"; s.setAttribute("aria-hidden", "true"); tira.appendChild(s); c.celdas.push(s); }
    box.appendChild(el); JGO_CAR.push(c); jgoCarPinta(c); jgoCarQuieto(c);
  });
}
function jgoCarSim(c, k) { var L = c.orden.length; return c.over[k] || c.orden[((k % L) + L) % L]; }
// La casilla k va en y = (1 + p − k) filas: con p entero, la casilla p queda en la fila del medio (la línea de premio)
function jgoCarPinta(c) {
  var b = Math.floor(c.p);
  for (var k = b - 1; k <= b + 2; k++) {
    var x = c.celdas[((k % 4) + 4) % 4];
    if (x._k !== k) { x._k = k; x.textContent = JGO_EMO[jgoCarSim(c, k)]; x.classList.remove("centro"); }
    x.style.transform = "translateY(" + ((1 + c.p - k) * 100).toFixed(2) + "%)";
  }
}
// Carrete quieto: qué quedó en la línea del medio (data-sym y el nombre para lectores de pantalla)
function jgoCarQuieto(c) {
  var k = Math.round(c.p), s = jgoCarSim(c, k), o = {};
  c.el.dataset.sym = s; c.el.setAttribute("aria-label", JGO_NOM[s]);
  c.celdas.forEach(function (x) { x.classList.toggle("centro", x._k === k); });
  for (var i = k - 2; i <= k + 2; i++) if (c.over[i]) o[i] = c.over[i];
  c.over = o;
}
function jgoCarPos(c, t) {
  var P = c.plan;
  if (!P || t < P.s) return jgoArranque(c.p0, JGO_V, JGO_A, t - c.t0);
  return t >= P.s + JGO_T ? P.K : jgoHermite(P.ps, JGO_V, P.K, 0, JGO_T, t - P.s);
}
// Frena desde el segundo s y para en la casilla K, a 3 o 4 casillas (todavía fuera de la vista), donde se pone «sim»
// (sin sim, para en lo que toque). Con esa distancia la frenada sale suave y sin pasarse.
function jgoCarPlan(c, s, sim) {
  var ps = jgoArranque(c.p0, JGO_V, JGO_A, s - c.t0), K = Math.ceil(ps + 3);
  if (sim) c.over[K] = sim;
  c.plan = { s: s, ps: ps, K: K };
}
function jgoCarPara(c, golpe) {
  c.parado = true; c.el.classList.remove("gira"); jgoCarQuieto(c);
  if (golpe) { c.el.classList.remove("tope"); void c.el.offsetWidth; c.el.classList.add("tope"); }
}
function jgoSlotJugar() {
  if (JGO.ocupado || !JGO.st.activo) return;
  jgoAcabarYa();
  var jug = { res: null, sims: null, girando: false, cortado: false, visto: false };
  JGO_SLOT = jug; jgoOcupado("slot");
  jgoRes("jgoSlotRes", "");
  JGO_CAR.forEach(function (c) { c.el.classList.remove("gana", "late"); });
  jgoDice(jgoFrase("juego_suerte", "Girando…"));
  if (jgoAnima("slot") && jgoGiraYa()) jgoSlotGira(jug);
  rpc("jgo_tragamonedas").then(function (r) {
    var sims = (r && Array.isArray(r.carretes) ? r.carretes : []).map(function (s) { return String(s).toLowerCase(); });
    if (sims.length !== 3 || sims.some(function (s) { return !JGO_EMO[s]; })) throw new Error("El servidor no devolvió los carretes. Avisa al encargado.");
    jug.res = r; jug.sims = sims; jgoTomar(r, false);
    if (!jug.girando && !jug.cortado && jgoAnima("slot")) jgoSlotGira(jug);
    if (jug.girando) jgoSlotFrena(jug, sims);
    else { jgoSlotPon(sims); jgoSlotFin(jug); }
  }).catch(function (e) {
    if (jug.girando && !JGO_CAR[0].plan) jgoSlotFrena(jug, null);   // paran sin premio
    jgoSlotListo(jug); jgoError(e);
  });
}
function jgoSlotGira(jug) {
  var t0 = jgoAhora(); jug.girando = true;
  JGO_CAR.forEach(function (c) {
    c.t0 = t0; c.p0 = c.p; c.plan = null; c.parado = false; c.el.classList.add("gira"); c.el.removeAttribute("data-sym");
    c.celdas.forEach(function (x) { x.classList.remove("centro"); });
  });
  $("jgoMaquina").classList.add("luces");
  jgoAnimar(function (t) { return jgoSlotPaso(jug, t); }, function () { jgoSlotCorta(jug); });
}
// Con resultado: gira al menos 0,8 s y paran uno tras otro (0,6 s entre cada uno). Sin resultado (error): paran ya.
function jgoSlotFrena(jug, sims) {
  var t = jgoAhora(), t0 = JGO_CAR[0].t0, s0 = Math.max(t, t0 + (sims ? 0.8 : JGO_A));
  JGO_CAR.forEach(function (c, i) { jgoCarPlan(c, s0 + (sims ? JGO_ENTRE * i : 0), sims ? sims[i] : null); });
}
function jgoSlotPaso(jug, t) {
  var todos = true;
  JGO_CAR.forEach(function (c) {
    if (c.parado) return;
    c.p = jgoCarPos(c, t); jgoCarPinta(c);
    if (c.plan && t >= c.plan.s + JGO_T) jgoCarPara(c, true);
    else { todos = false; if (c.plan && t >= c.plan.s) c.el.classList.remove("gira"); }   // sin desenfoque al frenar
  });
  if (!todos) return false;
  jug.girando = false; $("jgoMaquina").classList.remove("luces"); jgoSlotFin(jug);
  return true;
}
// Se cortó (cambio de juego o ventana cerrada): los carretes quedan ya en lo que salió
function jgoSlotCorta(jug) {
  jug.girando = false; jug.cortado = true; $("jgoMaquina").classList.remove("luces");
  JGO_CAR.forEach(function (c) { if (c.parado) return; c.p = c.plan ? c.plan.K : Math.round(c.p); jgoCarPinta(c); jgoCarPara(c, false); });
  if (jug.res) jgoSlotFin(jug);
}
// Sin animación: los carretes muestran de una vez lo que salió
function jgoSlotPon(sims) {
  JGO_CAR.forEach(function (c, i) {
    var k = Math.round(c.p); c.p = k; c.over[k] = sims[i];
    c.celdas.forEach(function (x) { x._k = null; }); jgoCarPinta(c); jgoCarPara(c, false);
  });
}
function jgoSlotFin(jug) {
  if (jug.visto) return;
  var r = jug.res; if (!r) { jgoSlotListo(jug); return; }
  jug.visto = true;
  jgoTomar(r, true);
  var p = num(r.premio);
  if (p > 0) {
    var n = {}; jug.sims.forEach(function (s) { n[s] = (n[s] || 0) + 1; });
    JGO_CAR.forEach(function (c, i) { var g = n[jug.sims[i]] > 1; c.el.classList.toggle("gana", g); c.el.classList.toggle("late", g && jgoAnima()); });
    jgoRes("jgoSlotRes", "¡Ganaste!", "gana", "+" + jgoPts(p), r.al_tope ? JGO_TOPE : "");
    jgoFiesta($("jgoSlot"));
  } else jgoRes("jgoSlotRes", r.mensaje || "Sin premio esta vez", "casi");
  // Tres iguales es el premio mayor: Shibu tiene frases propias para eso
  jgoDice(jgoVozFin(r, jug.sims[0] === jug.sims[1] && jug.sims[1] === jug.sims[2]), p > 0 ? "gana" : "");
  jgoSlotListo(jug);
}
function jgoSlotListo(jug) { if (JGO_SLOT !== jug) return; JGO_SLOT = null; jgoOcupado(null); }

// ---------------------------------------------------------------- Ruleta (rueda de premios)
// Una rueda de 15 casillas que gira; arriba, una flecha marca la que sale. 12 casillas tienen la cara de Shibu (sin
// premio) y 3 pagan x1, x2 y x3 (1, 2 o 3 puntos): se gana 3 de cada 15 veces (20 %). La casilla la decide el servidor
// (jgo_ruleta): la rueda gira mientras responde y frena justo en esa casilla. La lista de casillas también la manda el
// servidor (jgo_estado → casillas); esta es la de respaldo.
var JGO_CASILLAS = [3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0];
var JGO_WV = 420, JGO_WA = 0.35, JGO_WF = 2.6;   // grados por segundo, arranque y frenada
var JGO_RUL = { w: 0, cara: "" }, JGO_RJ = null;
function jgoPaso() { return 360 / JGO_CASILLAS.length; }
function jgoCuna(r1, r2, a1, a2) {
  function pt(r, a) { a = a * Math.PI / 180; return (r * Math.sin(a)).toFixed(2) + " " + (-r * Math.cos(a)).toFixed(2); }
  return "M" + pt(r2, a1) + "A" + r2 + " " + r2 + " 0 0 1 " + pt(r2, a2) + "L" + pt(r1, a2) + "A" + r1 + " " + r1 + " 0 0 0 " + pt(r1, a1) + "Z";
}
// La cara de Shibu en una casilla: su imagen (data/shibu.json → «imagen») o, mientras no esté, 🐶 en un círculo naranja
function jgoCaraSvg() {
  var img = JGO_RUL.cara;
  return '<circle r="12.5" class="r-shibu"/>' + (img ? '<image href="' + esc(img) + '" x="-11" y="-11" width="22" height="22" clip-path="url(#jgoCaraClip)" preserveAspectRatio="xMidYMid slice"/>'
    : '<text class="r-cara">🐶</text>');
}
function jgoRuedaCrear() {
  var P = jgoPaso(), h = '<svg viewBox="-104 -112 208 216" aria-hidden="true"><defs><clipPath id="jgoCaraClip"><circle r="11"/></clipPath></defs>' +
    '<circle r="99" class="r-borde"/><g id="jgoRueda">';
  JGO_CASILLAS.forEach(function (m, i) {
    var a = i * P;
    h += '<path class="r-cas ' + (m ? "c-premio" : "c-" + (i % 2 ? "a" : "b")) + '" d="' + jgoCuna(30, 94, a - P / 2, a + P / 2) + '"/>' +
      '<g transform="rotate(' + a.toFixed(2) + ') translate(0 -66)">' + (m ? '<text class="r-mult">x' + m + "</text>" : jgoCaraSvg()) + "</g>";
  });
  h += '</g><circle r="30" class="r-centro"/><text id="jgoHubN" class="r-hubn">?</text>' +
    '<path class="r-flecha" d="M-11 -109 L11 -109 L0 -88 Z"/></svg>';
  $("jgoRuedaBox").innerHTML = h;
  jgoRulPinta();
}
// La lista de casillas que manda el servidor y la cara de Shibu: si cambiaron, se vuelve a dibujar (nunca mientras gira)
function jgoRulCasillas(l) {
  var img = (typeof SHIBU !== "undefined" && SHIBU.frases && SHIBU.frases.imagen) || "";
  var ok = Array.isArray(l) && l.length >= 2 && l.every(function (x) { return x >= 0 && x <= 3; });
  if (JGO_RJ || ((!ok || l.join() === JGO_CASILLAS.join()) && img === JGO_RUL.cara)) return;
  if (ok) JGO_CASILLAS = l.map(Number);
  JGO_RUL.cara = img; jgoRuedaCrear(); jgoPremiosRul();
}
function jgoPremiosRul() {
  var ms = JGO_CASILLAS.filter(function (m) { return m > 0; }).sort();
  $("jgoRulPremios").innerHTML = "<b>Premios:</b> " + ms.map(function (m) { return "x" + m + " = " + jgoPts(m); }).join(" · ") + " · Shibu = nada";
}
function jgoRulPinta() { $("jgoRueda").setAttribute("transform", "rotate(" + jgoMod(JGO_RUL.w).toFixed(2) + ")"); }
// El centro de la rueda: «?» mientras gira; después lo que salió (x1, x2, x3 o la cara de Shibu)
function jgoHub(m) {
  var el = $("jgoHubN");
  el.textContent = m == null ? "?" : m ? "x" + m : "🐶";
  el.setAttribute("class", "r-hubn" + (m ? " gana" : ""));
  document.querySelectorAll("#jgoRueda .r-cas").forEach(function (x) { x.classList.remove("sale"); });
}
function jgoRulJugar() {
  if (JGO.ocupado || !JGO.st.activo) return;
  jgoAcabarYa();
  var jug = { res: null, k: null, girando: false, cortado: false, visto: false, plan: null, t0: 0, w0: 0 };
  JGO_RJ = jug; jgoOcupado("rul");
  jgoRes("jgoRulRes", ""); jgoHub(null);
  jgoDice(jgoFrase("juego_suerte", "Girando…"));
  jgoALaVista($("jgoRuedaBox"));
  if (jgoAnima("rul") && jgoGiraYa()) jgoRulGira(jug);
  rpc("jgo_ruleta").then(function (r) {
    var k = r ? parseInt(r.casilla, 10) : NaN;
    if (!(k >= 0 && k < JGO_CASILLAS.length)) throw new Error("El servidor no devolvió la casilla. Avisa al encargado.");
    jug.res = r; jug.k = k; jgoTomar(r, false);
    if (!jug.girando && !jug.cortado && jgoAnima("rul")) jgoRulGira(jug);
    if (jug.girando) jgoRulFrena(jug, k);
    else { jgoRulPon(k); jgoRulFin(jug); }
  }).catch(function (e) {
    if (jug.girando && !jug.plan) jgoRulFrena(jug, null);   // frena donde caiga, sin premio
    jgoRulListo(jug); jgoError(e);
  });
}
// En el teléfono la rueda puede quedar fuera de la vista: al girar, la ventana sube hasta ella
function jgoALaVista(el) {
  var d = $("jgoDlg").getBoundingClientRect(), r = el.getBoundingClientRect(), pie = $("jgoRul").querySelector(".jgo-jugar").offsetHeight;
  if (r.top >= d.top && r.bottom <= d.bottom - pie) return;
  try { el.scrollIntoView({ block: "center", behavior: jgoAnima() ? "smooth" : "auto" }); } catch (e) { el.scrollIntoView(); }
}
function jgoRulGira(jug) {
  jug.girando = true; jug.t0 = jgoAhora(); jug.w0 = JGO_RUL.w; jug.plan = null;
  $("jgoRuedaBox").classList.add("gira");
  jgoAnimar(function (t) { return jgoRulPaso(jug, t); }, function () { jgoRulCorta(jug); });
}
function jgoRulW(jug, t) {   // ángulo de la rueda: arranca, gira parejo y frena (curva de Hermite) hasta la casilla
  var P = jug.plan;
  if (!P || t < P.s) return jgoArranque(jug.w0, JGO_WV, JGO_WA, t - jug.t0);
  return t >= P.s + JGO_WF ? P.W : jgoHermite(P.ws, JGO_WV, P.W, 0, JGO_WF, t - P.s);
}
// Frena para que la casilla k quede bajo la flecha (arriba). Gira al menos 0,8 s. Con una frenada de entre un tercio y dos
// tercios de lo que recorrería a toda velocidad, la rueda va siempre más lenta, sin saltos ni vueltas atrás.
function jgoRulFrena(jug, k) {
  var s = Math.max(jgoAhora(), jug.t0 + (k != null ? 0.8 : JGO_WA)), ws = jgoRulW(jug, s), d0 = JGO_WV * JGO_WF / 3 + 1;
  jug.plan = { s: s, ws: ws, W: ws + d0 + (k != null ? jgoMod(-k * jgoPaso() - (ws + d0)) : 0) };
}
function jgoRulPaso(jug, t) {
  JGO_RUL.w = jgoRulW(jug, t); jgoRulPinta();
  if (!jug.plan || t < jug.plan.s + JGO_WF) return false;
  jug.girando = false; $("jgoRuedaBox").classList.remove("gira"); jgoRulFin(jug);
  return true;
}
// Se cortó (cambio de juego o ventana cerrada): la rueda queda ya en lo que salió
function jgoRulCorta(jug) {
  jug.girando = false; jug.cortado = true; $("jgoRuedaBox").classList.remove("gira");
  if (jug.plan) { JGO_RUL.w = jug.plan.W; jgoRulPinta(); }
  if (jug.res) jgoRulFin(jug);
}
// Sin animación: la rueda queda de una vez con la casilla bajo la flecha
function jgoRulPon(k) { JGO_RUL.w = jgoMod(-k * jgoPaso()); jgoRulPinta(); }
function jgoRulFin(jug) {
  if (jug.visto) return;
  var r = jug.res; if (!r) { jgoRulListo(jug); return; }
  jug.visto = true;
  jgoTomar(r, true);
  var k = jug.k, m = r.mult != null ? num(r.mult) : (JGO_CASILLAS[k] || 0), p = num(r.premio), cas = document.querySelectorAll("#jgoRueda .r-cas")[k];
  jgoHub(m);
  if (cas) cas.classList.add("sale");
  if (p > 0) { jgoRes("jgoRulRes", "¡x" + m + "!", "gana", "+" + jgoPts(p), r.al_tope ? JGO_TOPE : ""); jgoFiesta($("jgoRul")); }
  else jgoRes("jgoRulRes", m ? "¡x" + m + "! Pero ya " + JGO_TOPE : "Salió Shibu: sin premio esta vez", "casi");
  jgoDice(jgoVozFin(r, false), p > 0 ? "gana" : "");
  jgoRulListo(jug);
}
function jgoRulListo(jug) { if (JGO_RJ !== jug) return; JGO_RJ = null; jgoOcupado(null); }

// ---------------------------------------------------------------- Blackjack
// Las cartas llegan como «A♠», «10♥»…; una carta boca abajo llega como null. La mesa se pone al día con cada respuesta:
// primero las cartas nuevas del jugador, después se voltea la del crupier y luego las que él sacó, con pausas.
var JGO_BJV = { j: [], c: [] };   // lo que ya está en la mesa (null = boca abajo)
var JGO_PALO = { "♠": "picas", "♥": "corazones", "♦": "diamantes", "♣": "tréboles" };
function jgoBjEmpezar() {
  if (JGO.ocupado || !JGO.st.activo) return;
  jgoAcabarYa(); jgoOcupado("bj");
  jgoDice(jgoFrase("juego_suerte", "Barajando…"));
  rpc("jgo_bj_empezar").then(function (r) {
    jgoBjValida(r); jgoBjMostrar(r, true);   // los contadores, al terminar de repartir (jgoBjFin)
  }).catch(function (e) { jgoOcupado(null); jgoError(e); });
}
function jgoBjAccion(acc) {
  var bj = JGO.bjMostrado;
  if (JGO.ocupado || !bj || bj.estado !== "jugando") return;
  jgoAcabarYa(); jgoOcupado("bj");
  rpc("jgo_bj_accion", { p_id: bj.id, p_accion: acc }).then(function (r) {
    jgoBjValida(r); jgoBjMostrar(r, false);
  }).catch(function (e) {
    jgoOcupado(null);
    // Sin conexión la mano sigue (se puede volver a intentar); si el servidor la rechazó, se reparte otra
    if (!jgoSinRed(e)) { JGO.bjMostrado = null; jgoBotones(); }
    jgoError(e);
  });
}
function jgoBjValida(r) { if (!r || !Array.isArray(r.jugador) || !Array.isArray(r.crupier) || !r.estado) throw new Error("El servidor no devolvió la mano. Avisa al encargado."); }
function jgoBjMostrar(r, nueva) {
  var J = r.jugador, Cr = r.crupier, sim = nueva ? { j: [], c: [] } : { j: JGO_BJV.j.slice(), c: JGO_BJV.c.slice() }, i;
  function da(lado, carta, espera) { sim[lado].push(carta); jgoCola(function () { jgoBjDa(lado, carta); }, espera); }
  if (nueva) {
    jgoCola(function () {
      $("jgoBjJ").innerHTML = ""; $("jgoBjC").innerHTML = ""; JGO_BJV = { j: [], c: [] };
      $("jgoBjTotJ").textContent = ""; $("jgoBjTotC").textContent = ""; jgoRes("jgoBjRes", "");
    }, 150);
    // Reparto: jugador, crupier, jugador y la segunda del crupier boca abajo
    if (J.length) da("j", J[0], 300);
    if (Cr.length) da("c", Cr[0], 300);
    if (J.length > 1) da("j", J[1], 300);
    if (Cr.length > 1) da("c", null, 300);
  }
  while (sim.j.length < J.length) da("j", J[sim.j.length], 380);
  jgoCola(function () { $("jgoBjTotJ").textContent = r.total != null ? r.total : ""; }, 0);
  for (i = 0; i < sim.c.length && i < Cr.length; i++) {
    if (sim.c[i] == null && Cr[i] != null) (function (k, carta) { sim.c[k] = carta; jgoCola(function () { jgoBjVoltea(k, carta); }, 650); })(i, Cr[i]);
  }
  while (sim.c.length < Cr.length) da("c", Cr[sim.c.length], 650);
  jgoCola(function () { jgoBjFin(r); }, 0);
}
function jgoBjDa(lado, carta) {
  var d = document.createElement("div");
  d.className = "jgo-carta" + (jgoAnima("bj") ? " entra" : ""); d.setAttribute("role", "img");
  d.innerHTML = '<div class="jgo-carta-in"><div class="cara"></div><div class="dorso"></div></div>';
  if (carta == null) { d.classList.add("tapada"); d.setAttribute("aria-label", "Carta boca abajo"); } else jgoCartaCara(d, carta);
  $(lado === "j" ? "jgoBjJ" : "jgoBjC").appendChild(d); JGO_BJV[lado].push(carta);
}
function jgoCartaCara(d, carta) {
  var t = String(carta).replace(/[\uFE0E\uFE0F]/g, "").trim(), palo = t.slice(-1), rango = t.slice(0, -1), P = esc(palo) + "\uFE0E";
  d.classList.toggle("roja", palo === "♥" || palo === "♦");
  d.dataset.carta = t;
  d.setAttribute("aria-label", (rango === "A" ? "As" : rango) + " de " + (JGO_PALO[palo] || palo));
  d.querySelector(".cara").innerHTML = '<span class="esq">' + esc(rango) + "<i>" + P + '</i></span><span class="pinta">' + P + '</span><span class="esq abajo">' + esc(rango) + "<i>" + P + "</i></span>";
}
function jgoBjVoltea(i, carta) {
  var d = $("jgoBjC").children[i];
  if (!d) { jgoBjDa("c", carta); return; }
  jgoCartaCara(d, carta); d.classList.remove("tapada"); JGO_BJV.c[i] = carta;
}
// La mesa ya muestra la respuesta. Los contadores se ponen al día recién aquí, también la ficha de la mano: así no se
// adelanta nada (una mano que terminó al repartir, o un empate que devuelve la ficha).
function jgoBjFin(r) {
  JGO.bjMostrado = r;
  var fin = r.estado !== "jugando";
  jgoTomar(r, fin);
  $("jgoBjTotC").textContent = fin ? (r.total_crupier != null ? r.total_crupier : "") : JGO_BJV.c.indexOf(null) >= 0 ? "?" : "";
  if (fin) {
    var p = num(r.premio), e = r.estado;
    var t = e === "blackjack" ? "¡Blackjack!" : e === "gano" ? "¡Ganaste la mano!" : e === "empate" ? "Empate: te devolvemos la ficha" : num(r.total) > 21 ? "Te pasaste de 21" : "Gana el crupier";
    // al_tope: la mano terminó con el día ya lleno (otros juegos lo llenaron mientras seguía abierta) y suma menos o nada
    jgoRes("jgoBjRes", t, p > 0 ? "gana" : e === "empate" ? "empate" : "casi", p > 0 ? "+" + jgoPts(p) : "", r.al_tope ? JGO_TOPE : "");
    jgoDice(jgoVozFin(r, false), p > 0 ? "gana" : "");
    if (p > 0) jgoFiesta($("jgoBj"));
  } else {
    jgoRes("jgoBjRes", "");
    jgoDice(r.mensaje || "Tienes " + r.total + ". ¿Pides otra carta o te plantas?");
  }
  jgoOcupado(null);
}

// ---------------------------------------------------------------- Arranque: se arma todo una vez y se conectan los botones
jgoCarCrear(); jgoRuedaCrear(); jgoPremiosRul(); jgoPintaCont();
jgoRes("jgoBjRes", "Toca «Repartir» para empezar", "pista");
$("jgoCerrar").innerHTML = icon("x") + "<span>Cerrar</span>";
document.querySelectorAll("#jgoDlg [data-volver]").forEach(function (b) {
  b.innerHTML = icon("back") + "<span>Volver</span>";
  b.addEventListener("click", function () { jgoVista("menu"); });
});
$("jgoCerrar").addEventListener("click", function () { $("jgoDlg").close(); });
$("jgoDlg").addEventListener("close", function () { jgoAcabarYa(); jgoSinEfectos(); });   // lo que giraba queda en su resultado
["animationend", "animationcancel"].forEach(function (ev) {
  $("jgoDlg").addEventListener(ev, function (e) {
    var t = e.target; if (!t.classList) return;
    JGO_EFECTOS.forEach(function (k) { if (k !== "late") t.classList.remove(k); });
    if (t.classList.contains("centro") && t.closest(".jgo-carrete")) t.closest(".jgo-carrete").classList.remove("late");
  });
});
// Al elegir, la carta «se usa»: salta un poco antes de abrir su juego
$("jgoMenu").addEventListener("click", function (e) {
  var b = e.target.closest("[data-jgo]"); if (!b || b.disabled || b.classList.contains("usando")) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { jgoVista(b.dataset.jgo); return; }
  b.classList.add("usando");
  setTimeout(function () { b.classList.remove("usando"); jgoVista(b.dataset.jgo); }, 300);
});
$("jgoGirar").addEventListener("click", jgoSlotJugar);
$("jgoRulGirar").addEventListener("click", jgoRulJugar);
$("jgoRepartir").addEventListener("click", jgoBjEmpezar);
$("jgoOtra").addEventListener("click", jgoBjEmpezar);
$("jgoPedir").addEventListener("click", function () { jgoBjAccion("pedir"); });
$("jgoPlantarse").addEventListener("click", function () { jgoBjAccion("plantarse"); });
jgoBotones();
