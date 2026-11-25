// ---------------------------------------------------------------- Misiones de Shibu (pedido de Edgar, 24/11)
// Shibu, el jefe, recibe a la maid la primera vez del día con sus 3 misiones y celebra cada misión cumplida.
// «Mi perfil» (botón de la barra de arriba) es una pantalla completa con su carnet y las secciones Hoy, Mis ventas,
// Top maid y Expendedora, más «Jugar». En la expendedora la maid compra con sus puntos y el premio sale a cocina de una
// vez (queda en el cierre de caja).
// Todo lo decide la base (mis_estado, tienda_canjear): la tablet solo muestra. Las frases salen de data/shibu.json.
// Mejoras que eligió Edgar: el sello de Shibu cae sobre la misión cumplida, los puntos vuelan a la chapita de arriba,
// un aviso chico cuando avanza una misión, el carnet de Mi perfil y el «Top maid» del mes en un podio olímpico griego.
// La expendedora es una máquina de premios dentro de Mi perfil (pos-tienda.js).
var SHIBU = { frases: null, est: null, timer: null, vistos: {}, desde: {}, chipPts: null, retener: false, avisos: [], avisosT: 0,
  pronto: 0, rectFiesta: null, topVisto: {}, comVistos: {}, sesion: 0, seq: 0, celebrados: {}, saludado: false };
// Lo que contesta la base tarde (de una maid que ya salió, o una revisión vieja) no se pinta (revisión del 25/11)
function shibuVigente(ses) { return !!U && ses === SHIBU.sesion; }
var NIVEL_TXT = { 0: "Extra del día", 1: "Fácil", 2: "Media", 3: "Difícil" };
// Comodines (Edgar, 25/11): de dónde salió una misión propia de la maid
var ORIGEN_TXT = { extra_facil: "📜 Pergamino", extra_dificil: "📜 Pergamino", doble_media: "📜 Pergamino", sorpresa: "🎲 Sorpresa",
                   cambio: "🔄 Cambiada", mapa: "🗺️ Del mapa" };
var INSIGNIA_IC = { estrella: "⭐", ramen: "🍜", taiyaki: "🐟" };
var MIS_PLATA = ["ventas", "promedio", "primera", "vs_ayer", "vs_semana", "top_ventas", "equipo_meta"];
var SHIBU_REVISA_MS = 30000;

function shibuQuieto() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
function shibuFrases() {
  if (SHIBU.frases) return Promise.resolve(SHIBU.frases);
  return fetch("data/shibu.json", { cache: "no-cache" }).then(function (r) { return r.json(); })
    .then(function (j) { SHIBU.frases = j || {}; return SHIBU.frases; }).catch(function () { SHIBU.frases = {}; return SHIBU.frases; });
}
function shibuFrase(tipo) { return shibuFraseConPose(tipo).t; }
// Cada frase sale con su pose (Edgar las eligió el 25/11 en la página «Poses de Shibu»): data/shibu.json → "poses_frases",
// en el mismo orden que las frases. «cara» es el círculo con su cara; sin pose elegida queda la del momento.
function shibuFraseConPose(tipo) {
  var l = (SHIBU.frases && SHIBU.frases[tipo]) || [];
  if (!l.length) return { t: "", pose: null };
  var i = Math.floor(Math.random() * l.length), pf = SHIBU.frases.poses_frases && SHIBU.frases.poses_frases[tipo];
  var pose = pf && typeof pf[i] === "string" && /^[a-z0-9-]+$/.test(pf[i]) ? pf[i] : null;
  return { t: shibuNovata(l[i]), pose: pose };
}
function shibuPoseSrc(pose) { return pose && pose !== "cara" ? "assets/shibu/" + pose + ".webp" : (SHIBU.frases && SHIBU.frases.imagen) || ""; }
// Mejora de nivel (Edgar, 25/11): desde el nivel 1 de estrellas, Shibu la llama por su nombre en vez de «novata»
function shibuNovata(t) {
  var e = SHIBU.est, mj = e && e.mejoras, n = e && e.estrellas ? e.estrellas.nivel || 0 : 0;
  if (!t || !mj || mj.nombre == null || n < mj.nombre) return t;
  var nom = String(e.nombre || (typeof U !== "undefined" && U && U.name) || "").split(" ")[0];
  return nom ? t.replace(/\bnovata\b/gi, nom) : t;
}
// La cara de Shibu: su PNG cuando esté (data/shibu.json → "imagen"); mientras, un círculo naranja con su nombre
function shibuCara(cls) {
  var img = SHIBU.frases && SHIBU.frases.imagen;
  return '<span class="shibu-cara ' + (cls || "") + (img ? " con-img" : "") + '">' + (img ? '<img src="' + esc(img) + '" alt="Shibu">' : "<b>Shibu</b>") + "</span>";
}
// Shibu de cuerpo entero en cada momento (data/shibu.json → «poses», de las 22 poses aprobadas del pack de Shibu).
// Sin pose para ese momento, queda su cara en el círculo grande.
function shibuPose(momento, anim, pose) {
  if (pose === "cara") return shibuCara("grande " + (anim || ""));
  var p = pose ? shibuPoseSrc(pose) : SHIBU.frases && SHIBU.frases.poses && SHIBU.frases.poses[momento];
  if (!p || !/^assets\//.test(p)) return shibuCara("grande " + (anim || ""));
  return '<span class="shibu-pose ' + esc(momento) + " " + (anim || "") + '"><img src="' + esc(p) + '" alt="Shibu"></span>';
}
// La frase sale letra por letra, como si Shibu la estuviera escribiendo
function shibuEscribe(el, txt) {
  clearInterval(el._t); el.textContent = "";
  if (!txt) return;
  if (shibuQuieto()) { el.textContent = txt; return; }
  var i = 0; el._t = setInterval(function () { i++; el.textContent = txt.slice(0, i); if (i >= txt.length) clearInterval(el._t); }, 28);
}
function shibuDialogoAbierto() { return !!document.querySelector("dialog[open]"); }

// ---- Al entrar y al salir
function shibuEntrar() {
  shibuSalir();
  shibuFrases().then(function () { return shibuPoll(true); });
  SHIBU.timer = setInterval(function () { shibuPoll(false); }, SHIBU_REVISA_MS);
}
function shibuSalir() {
  clearInterval(SHIBU.timer); clearTimeout(SHIBU.pronto); clearTimeout(SHIBU.avisosT);
  SHIBU.timer = null; SHIBU.est = null; SHIBU.vistos = {}; SHIBU.desde = {}; SHIBU.chipPts = null; SHIBU.retener = false;
  SHIBU.avisos = []; SHIBU.rectFiesta = null; SHIBU.topVisto = {}; SHIBU.comVistos = {};
  SHIBU.sesion++; SHIBU.celebrados = {}; SHIBU.saludado = false;
  // La pestaña «Maids» de la anterior no se ve ni un momento
  if (typeof cur !== "undefined" && cur.area === "Maids" && $("areaBody")) $("areaBody").innerHTML = "";
  // La máquina queda libre para la que entra (una compra a medias de la anterior ya no se pinta)
  if (typeof VM !== "undefined") {
    if (typeof vmSuelta === "function") { try { vmSuelta(false); } catch (e) { /* sin máquina dibujada */ } }
    VM.modo = "premios"; VM.ocupada = false; VM.revisando = false; VM.sel = null; VM.selId = null; VM.datos = null;
  }
  show("btnShibu", false);
  var box = $("shibuAvisos"); if (box) box.innerHTML = "";
  // Lo de una maid no lo ve la siguiente que entra
  HUB.ventas = null; HUB.ventasAt = 0; HUB.ventasErr = ""; HUB.pidiendo = null; HUB.firma = ""; HUB.firmaLado = "";
  if ($("perfilLado")) $("perfilLado").innerHTML = "";
  ["shibuDlg", "perfilDlg"].forEach(function (id) { var d = $(id); if (d && d.open) d.close(); });
}
// Después de mandar a cocina o de cobrar, las misiones se revisan enseguida (sin esperar la vuelta de 30 s)
function shibuPronto() {
  if (!U) return;
  clearTimeout(SHIBU.pronto);
  SHIBU.pronto = setTimeout(function () { shibuPoll(false); }, 2500);
}
// Revisa las misiones. Al entrar, la bienvenida sale una vez al día.
function shibuPoll(alEntrar) {
  if (!U || (typeof SR !== "undefined" && SR.on)) return Promise.resolve();
  var quien = U.id, ses = SHIBU.sesion, n = ++SHIBU.seq;
  return rpc("mis_estado").then(function (e) {
    if (!U || U.id !== quien || !shibuVigente(ses) || n !== SHIBU.seq) return;   // ya hay otra más nueva
    // Una celebración que ya salió en esta sesión no se repite (la base todavía no había anotado que se vio)
    if (e && e.nuevos) e.nuevos = e.nuevos.filter(function (x) { return !SHIBU.celebrados[x.id]; });
    SHIBU.est = e;
    if (e && e.juega) {
      var nuevos = e.nuevos || [], top = shibuTopPendiente(e);
      // Los puntos nuevos no se suman de golpe: llegan volando a la chapita cuando se cierra la celebración
      if (SHIBU.chipPts == null) SHIBU.chipPts = (e.puntos || 0) - nuevos.reduce(function (s, x) { return s + (x.puntos || 0) + (x.comodin || 0); }, 0) - (top ? top.puntos || 0 : 0);
      if (nuevos.length || top) SHIBU.retener = true;
      nuevos.forEach(function (n) {
        if (SHIBU.desde[n.id] != null) return;
        var v = SHIBU.vistos[e.fecha + "|" + (n.slot != null ? n.slot : n.nivel)];
        SHIBU.desde[n.id] = v && v.pct < 100 ? v.pct : 60;
      });
      if (!alEntrar) shibuAvanzo(e);
      shibuRecuerda(e);
      // Si va a salir la bienvenida o una celebración, los avisos de comodines esperan a que se cierre
      shibuComAvisos(e, (alEntrar && !e.saludo_hoy) || nuevos.length > 0 || !!top);
    }
    shibuChip(); shibuBadge();
    if (!e || !e.juega) return;
    if (alEntrar && !e.saludo_hoy && !SHIBU.saludado) shibuCuandoLibre(shibuBienvenida);
    else if ((e.nuevos || []).length || shibuTopPendiente(e)) shibuCuandoLibre(shibuSiguiente);
    shibuHubAlDia();
    shibuTabRedibuja();
  }).catch(function () {});
}
function shibuTopPendiente(e) { var p = e && e.top_premio; return p && !SHIBU.topVisto[p.id] ? p : null; }
// Lo que queda por celebrar: primero el premio del Top maid del mes, después las misiones cumplidas
function shibuSiguiente() {
  var e = SHIBU.est; if (!U || !e || !e.juega) return;
  if (shibuTopPendiente(e)) shibuTopPremio(); else if ((e.nuevos || []).length) shibuCelebra();
}
// Espera a que se cierren los avisos u otra ventana antes de mostrar a Shibu
// Libre: sin ventanas abiertas, en el mapa de mesas (no tomando un pedido) y sin tocar la pantalla hace 2 s
function shibuLibre() {
  if (shibuDialogoAbierto()) return false;
  var ov = $("orderView"); if (ov && !ov.classList.contains("hidden")) return false;
  if (typeof ACT !== "undefined" && ACT.toque && Date.now() - ACT.toque < 2000) return false;
  return true;
}
function shibuCuandoLibre(fn) {
  var n = 0, ses = SHIBU.sesion;
  (function intenta() {
    if (!shibuVigente(ses)) return;
    if (shibuLibre()) { fn(); return; }
    if (++n < 180) setTimeout(intenta, 1000);
  })();
}

// ---- Botón «Mi perfil» de la barra de arriba: «★ 1/3 · 12 pts»; al tocarlo abre Mi perfil
function shibuChip() {
  var e = SHIBU.est, ok = !!(U && e && e.juega);
  show("btnShibu", ok);
  if (!ok) return;
  var m = e.misiones || [], hechas = m.filter(function (x) { return x.hecha; }).length;
  var pts = SHIBU.retener && SHIBU.chipPts != null ? SHIBU.chipPts : (e.puntos || 0);
  if (!SHIBU.retener) SHIBU.chipPts = pts;
  // En pantallas angostas se esconde primero «★ 1/4 ·» y en el teléfono también «Mi perfil» (queda el ícono con los puntos)
  $("btnShibu").innerHTML = shibuIc(HUB_IC.perfil) + '<span class="pf-txt"><b>Mi perfil</b><small><span class="pf-mis">★ ' + hechas + "/" + m.length +
    ' · </span><span class="chip-pts">' + pts + "</span> pts</small></span>";
  $("btnShibu").setAttribute("aria-label", "Mi perfil: " + hechas + " de " + m.length + " misiones, " + pts + " puntos");
}
$("btnShibu").addEventListener("click", function () { shibuPerfil("hoy"); });
// Un número que sube (o baja) contando hasta su valor nuevo
function shibuCuentaEn(el, desde, hasta, ms) {
  if (!el) return;
  cancelAnimationFrame(el._cuenta);
  if (shibuQuieto() || desde === hasta) { el.textContent = hasta; return; }
  var t0 = performance.now(), dur = ms || 700;
  (function paso(t) {
    var k = Math.min(1, (t - t0) / dur), v = Math.round(desde + (hasta - desde) * (1 - Math.pow(1 - k, 3)));
    el.textContent = v;
    if (k < 1) el._cuenta = requestAnimationFrame(paso);
  })(t0);
}
// Los puntos y la ficha de la celebración vuelan hasta la chapita y el número sube contando
function shibuVuela(r0, pts, fichas) {
  var chip = $("btnShibu"), e = SHIBU.est || {}, ses = SHIBU.sesion;
  var desde = SHIBU.chipPts == null ? (e.puntos || 0) : SHIBU.chipPts;
  // Si todavía queda otra celebración, la chapita sube solo lo de esta; si no, llega al saldo de la base
  var sigue = (e.nuevos || []).length > 0 || !!shibuTopPendiente(e), hasta = sigue ? desde + pts : (e.puntos || 0);
  function suma() { if (!shibuVigente(ses)) return; SHIBU.retener = sigue; SHIBU.chipPts = hasta; shibuChip(); shibuCuentaEn(chip.querySelector(".chip-pts"), desde, hasta); }
  var r1 = chip && !chip.classList.contains("hidden") ? chip.getBoundingClientRect() : null;
  if (shibuQuieto() || !r1 || !r1.width || !r0 || !document.body.animate) { suma(); return; }
  var n = Math.max(2, Math.min(7, pts + fichas)), x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
  var x1 = r1.left + Math.min(20, r1.width / 2), y1 = r1.top + r1.height / 2, llegaron = 0;
  for (var i = 0; i < n; i++) (function (i) {
    var m = document.createElement("i");
    m.className = "shibu-moneda" + (i < fichas ? " ficha" : "");
    document.body.appendChild(m);
    var jx = (Math.random() - 0.5) * 80, jy = (Math.random() - 0.5) * 24;
    var mx = (x0 + x1) / 2 + jx, my = Math.min(y0, y1) - 50 - Math.random() * 70;
    var a = m.animate([
      { transform: "translate(" + (x0 + jx / 3) + "px," + y0 + "px) scale(.5)", opacity: 0 },
      { transform: "translate(" + (x0 + jx) + "px," + (y0 + jy - 26) + "px) scale(1.15)", opacity: 1, offset: 0.18 },
      { transform: "translate(" + mx + "px," + my + "px) scale(1)", opacity: 1, offset: 0.58 },
      { transform: "translate(" + x1 + "px," + y1 + "px) scale(.5)", opacity: 0.9 }
    ], { duration: 950, delay: i * 120, easing: "cubic-bezier(.45,0,.55,1)", fill: "both" });
    a.onfinish = function () {
      m.remove();
      chip.classList.remove("recibe"); void chip.offsetWidth; chip.classList.add("recibe");
      if (++llegaron === 1) suma();
    };
  })(i);
}

// ---- Avisos de avance: un cartelito que entra por la derecha y se va solo (no abre ventanas)
function shibuNiv(x) { return x.extra ? 0 : x.nivel; }
// Cada misión se reconoce por su lugar: las del día van de 0 a 3; las propias de los pergaminos, de 11 en adelante
function shibuClave(x) { return x.slot != null ? x.slot : shibuNiv(x); }
function shibuPct(x) {
  if (x.hecha) return 100;
  if (x.al_cierre) return 0;
  var a = Number(x.actual) || 0, m = Number(x.meta) || 1;
  return Math.max(0, Math.min(100, Math.round(a / m * 100)));
}
function shibuRecuerda(e) {
  (e.misiones || []).forEach(function (x) { SHIBU.vistos[e.fecha + "|" + shibuClave(x)] = { actual: Number(x.actual) || 0, pct: shibuPct(x) }; });
}
// Avisa lo que avanzó desde la última revisión. Las de plata, las de equipo y las de metas grandes avisan cada 25 %.
function shibuAvanzo(e) {
  (e.misiones || []).forEach(function (x) {
    var v = SHIBU.vistos[e.fecha + "|" + shibuClave(x)], a = Number(x.actual) || 0;
    if (!v || x.hecha || x.al_cierre || a <= v.actual) return;
    var pct = shibuPct(x), grande = MIS_PLATA.indexOf(x.tipo) >= 0 || x.equipo || (Number(x.meta) || 0) > 10;
    if (grande && Math.floor(pct / 25) <= Math.floor(v.pct / 25)) return;
    SHIBU.avisos.push({ x: x, desde: v.pct, at: Date.now() });
  });
  shibuAvisosSigue();
}
function shibuAvisosBox() {
  var b = $("shibuAvisos");
  if (!b) { b = document.createElement("div"); b.id = "shibuAvisos"; b.className = "shibu-avisos"; b.setAttribute("aria-live", "polite"); document.body.appendChild(b); }
  return b;
}
function shibuAvisosSigue() {
  clearTimeout(SHIBU.avisosT);
  if (!U || !SHIBU.avisos.length) return;
  // Con una ventana abierta se espera (si pasan 2 minutos, ya no vale la pena)
  if (shibuDialogoAbierto()) { SHIBU.avisosT = setTimeout(shibuAvisosSigue, 1500); return; }
  var box = shibuAvisosBox();
  while (SHIBU.avisos.length) {
    var a = SHIBU.avisos.shift();
    if (a.com || Date.now() - a.at < 120000) shibuAvisoPinta(box, a);
  }
}
function shibuAvisoPinta(box, a) {
  if (a.com) { shibuAvisoCom(box, a.com); return; }
  var x = a.x, el = document.createElement("button");
  el.type = "button"; el.className = "shibu-aviso n" + shibuNiv(x);
  el.innerHTML = shibuCara("mini") + '<span class="sa-txt"><span class="sa-nivel">' + (x.extra ? "＋" : "★".repeat(x.nivel)) + " Avanzaste</span><b>" + esc(x.texto) +
    '</b><span class="sa-barra"><i style="width:' + (shibuQuieto() ? shibuPct(x) : a.desde) + '%" data-pct="' + shibuPct(x) + '"></i></span><small>' + esc(shibuAvance(x)) + "</small></span>";
  box.appendChild(el);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  shibuLlena(el);
  el.addEventListener("click", function () { el.remove(); shibuPerfil("hoy"); });
  setTimeout(function () { el.classList.add("sale"); setTimeout(function () { el.remove(); }, 400); }, 5200);
}

// Comodines: lo que le llegó (un regalo, un duelo, la bandera del equipo). Se muestra una vez y se marca visto.
// «espera»: va a salir una ventana de Shibu; los avisos quedan en la fila y salen cuando se cierre.
function shibuComAvisos(e, espera) {
  var l = ((e && e.comodines) || {}).avisos || [];
  l.forEach(function (a) { if (!SHIBU.comVistos[a.id]) { SHIBU.comVistos[a.id] = true; SHIBU.avisos.push({ com: a, at: Date.now() }); } });
  if (l.length && !espera) shibuAvisosSigue();
}
function shibuAvisoCom(box, c) {
  var el = document.createElement("button");
  el.type = "button"; el.className = "shibu-aviso com";
  el.innerHTML = shibuCara("mini") + '<span class="sa-txt"><span class="sa-nivel">' + esc(c.icono || "✨") + " Comodines</span><b>" + esc(c.texto) + "</b></span>";
  box.appendChild(el);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  el.addEventListener("click", function () { el.remove(); shibuPerfil("hoy"); });
  setTimeout(function () { el.classList.add("sale"); setTimeout(function () { el.remove(); }, 400); }, 6500);
  rpc("com_visto", { p_ids: [c.id] }).catch(function () {});
}

// ---- Tarjetas de misión
function shibuAvance(x) {
  if (x.hecha) return "✓ Cumplida";
  if (x.al_cierre) return "Se sabe al cerrar la caja";
  var a = Number(x.actual) || 0, m = Number(x.meta) || 0;
  if (MIS_PLATA.indexOf(x.tipo) >= 0) {
    if (x.tipo === "vs_ayer" || x.tipo === "vs_semana" || x.tipo === "top_ventas") return "Llevas " + ref(a) + " · hay que pasar " + ref(Math.max(m - 0.01, 0));
    return ref(Math.min(a, m)) + " de " + ref(m);
  }
  return Math.min(a, m) + " de " + m;
}
// El sello de Shibu (su nombre en katakana, como el hanko de un jefe japonés) sobre la misión cumplida.
// «cae»: en la celebración, el sello cae con golpe cuando la barra termina de llenarse.
function shibuSello(cae, d) {
  return '<span class="mis-sello' + (cae ? " cae" : "") + '"' + (cae ? ' style="--d:' + d.toFixed(2) + 's"' : "") +
    ' aria-hidden="true"><b>シブ</b><i>CUMPLIDA</i><em>★</em></span>';
}
// op.desde(x): de qué % arranca la barra para llenarse animada; op.sellar: los sellos caen ahora; op.sello0: cuándo cae el primero
function shibuTarjetas(lista, op) {
  op = op || {};
  if (!lista.length) return '<p class="muted">Hoy Shibu no dejó misiones.</p>';
  return '<div class="mis-list">' + lista.map(function (x, i) {
    var pct = shibuPct(x), desde = op.desde && !shibuQuieto() ? op.desde(x) : pct, cae = !!(op.sellar && x.hecha), d = (op.sello0 || 0) + i * 0.45;
    var oculto = x.sorpresa && !x.hecha;
    return '<div class="mis-card n' + shibuNiv(x) + (x.hecha ? " hecha" : "") + (cae ? " fiesta" : "") + (x.origen && x.origen !== "dia" ? " propia" : "") +
      '" style="animation-delay:' + (cae ? d + 0.28 : i * 0.18).toFixed(2) + 's">' +
      '<div class="mis-nivel"><span>' + (x.extra ? "＋" : "★".repeat(x.nivel)) + "</span> " + esc(NIVEL_TXT[shibuNiv(x)] || "") + " · " +
      (oculto ? "? puntos" : x.puntos + " punto" + (x.puntos === 1 ? "" : "s")) +
      (x.equipo ? ' <em class="mis-eq">Equipo</em>' : "") + (ORIGEN_TXT[x.origen] ? ' <em class="mis-org">' + ORIGEN_TXT[x.origen] + "</em>" : "") +
      shibuComBadge(x) + "</div>" +
      '<div class="mis-texto">' + esc(x.texto) + "</div>" +
      '<div class="mis-barra"><i style="width:' + desde + '%" data-pct="' + pct + '"></i></div><div class="mis-avance">' + esc(shibuAvance(x)) + "</div>" +
      (x.hecha ? shibuSello(cae, d) : "") + "</div>";
  }).join("") + "</div>";
}
// Lo que le suman sus comodines: ×2, ×4, +1 y la Campanita (×3 a la próxima); en la cumplida, lo que ya sumaron
function shibuComBadge(x) {
  if (x.hecha) return x.comodin > 0 ? '<em class="mis-com">+' + x.comodin + " de comodines</em>" : "";
  var f = x.efecto, t = [];
  if (!f) return "";
  if (f.mult > 1) t.push("×" + f.mult);
  if (f.mas > 0) t.push("+" + f.mas);
  if (f.campanita) t.push("🔔 ×3 a la próxima");
  return t.length ? '<em class="mis-com" title="Lo que suman tus comodines">' + esc(t.join(" ")) + "</em>" : "";
}
// Mapa de Shibu (comodín): el día que vale, la maid elige su misión media entre 3 (o se queda con la suya)
function shibuMapaHtml(e) {
  var m = e && e.comodines && e.comodines.mapa;
  if (!m || m.hecha || !(m.opciones || []).length) return "";
  return '<div class="mapa-box" data-compra="' + Number(m.compra) + '"><b>🗺️ Mapa de Shibu: elige tu misión media de hoy</b>' +
    "<small>La de hoy: " + esc(m.actual || "") + "</small>" +
    '<div class="mapa-ops">' + m.opciones.map(function (o) {
      return '<button type="button" class="mapa-op" data-mapa="' + Number(o.id) + '">' + esc(o.texto) + "</button>";
    }).join("") + '<button type="button" class="mapa-op queda" data-mapa="0">Me quedo con la mía</button></div></div>';
}
document.addEventListener("click", function (ev) {
  var b = ev.target.closest && ev.target.closest("[data-mapa]"); if (!b) return;
  var box = b.closest(".mapa-box"); if (!box || box.classList.contains("ocupado")) return;
  box.classList.add("ocupado");
  var cat = Number(b.dataset.mapa) || null, ses = SHIBU.sesion;
  rpc("com_elegir_mapa", { p_compra: Number(box.dataset.compra), p_catalogo: cat }).then(function (r) {
    if (!shibuVigente(ses)) return;
    toast(cat ? "Tu misión media de hoy: " + ((r && r.texto) || "la nueva") : "Te quedas con tu misión media de hoy");
    return rpc("mis_estado").then(function (e) { if (shibuVigente(ses)) { SHIBU.est = e; shibuChip(); } }, function () {});
  }).then(function () {
    if (!shibuVigente(ses)) return;
    var e = SHIBU.est, mis = $("shibuMis");
    if (mis && $("shibuDlg").open) { mis.innerHTML = shibuTarjetas((e && e.misiones) || []) + shibuMapaHtml(e); shibuLlena(mis); }
    if ($("perfilDlg").open && HUB.tab === "hoy") shibuHubPanel(false);
  }).catch(function (err) { box.classList.remove("ocupado"); toast(errMsg(err) || "No se pudo elegir"); });
});
// Sus comodines de hoy: los activos, la bandera del equipo, los duelos y la hora feliz
function shibuComCuando(x) {
  if (x.efecto === "reloj") return "Cuida tu racha hasta el " + shibuDiaCorto(x.hasta);
  if (x.empieza) return "Empieza el " + shibuDiaCorto(x.desde);
  if (x.efecto === "x3_proxima") return "En tu próxima misión";
  if (x.efecto === "ficha_dorada") return "En tu próxima jugada";
  if (x.efecto === "carta") return "En tu próxima mano de blackjack";
  if (x.efecto === "cupon") return "En tu próximo premio · " + (x.dias <= 1 ? "vence hoy" : "vale " + x.dias + " días");
  if (x.efecto === "duelo") return "Hoy con " + (x.con || "tu compañera") + ": si vendes más, +4";
  if (x.efecto === "mapa") return "Hoy eliges tu misión media";
  return x.dias <= 1 ? "Hoy" : "Quedan " + x.dias + " días";
}
function shibuComodinesHoy(e) {
  var c = (e && e.comodines) || {}, filas = [];
  function fila(ic, nom, txt) { return '<li><span class="cm-ico" aria-hidden="true">' + esc(ic) + "</span><b>" + esc(nom) + "</b><small>" + esc(txt) + "</small></li>"; }
  (c.activos || []).forEach(function (x) { if (x.efecto !== "duelo") filas.push(fila(x.icono || "✨", x.nombre, shibuComCuando(x))); });
  if (c.bandera) filas.push(fila("🚩", "Bandera del equipo", (c.bandera.mia ? "La compraste tú" : "La compró " + (c.bandera.de || "una compañera")) +
    (c.bandera.cumplida ? " · ¡ya ganaste +1!" : " · si el local llega a la meta, +1 para todas")));
  (c.duelos || []).forEach(function (d) { filas.push(fila("⚔️", d.reta ? "Duelo con " + (d.con || "") : "Duelo de " + (d.con || ""),
    d.reta ? "Si hoy vendes más que ella, ganas 4 puntos" : "Te retó hoy: ¡que gane la mejor!")); });
  if (c.hora_feliz) filas.push(fila("🕒", "Hora feliz", "+" + c.hora_feliz + " hoy"));
  if (!filas.length) return "";
  return '<h3 class="hub-sub">Tus comodines</h3><ul class="hub-com">' + filas.join("") + "</ul>";
}
// Después de dibujar, cada barra se llena hasta su avance
function shibuLlena(box) {
  var l = box ? box.querySelectorAll("[data-pct]") : [];
  if (!l.length) return;
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    Array.prototype.forEach.call(l, function (i) { i.style.width = i.dataset.pct + "%"; });
  }); });
}

// ---- Bienvenida (primera vez del día)
function shibuBienvenida() {
  var e = SHIBU.est; if (!e || SHIBU.saludado) return;
  SHIBU.saludado = true;
  var fuerte = e.tipo_dia === "fuertes" && Math.random() < 0.5;
  var fp = shibuFraseConPose(fuerte ? "manana_fuerte" : "manana"); if (!fp.t) fp = shibuFraseConPose("manana");
  var frase = fp.t;
  $("shibuBody").innerHTML = '<div class="shibu-top">' + shibuPose("bienvenida", "entra", fp.pose) + '<div class="shibu-dice"><div class="shibu-nom"><b>Shibu</b> <small>el jefe · vigilando</small></div>' +
    '<p class="shibu-globo" id="shibuTxt"></p></div></div>' +
    "<h3>Tus misiones de hoy, " + esc(String(e.nombre || U.name).split(" ")[0]) + "</h3>" +
    (e.estrellas ? '<p class="shibu-estrellas"><span>⭐ <b>' + (e.estrellas.total || 0) + "</b> " + ((e.estrellas.total || 0) === 1 ? "estrella" : "estrellas") +
      "</span><span>este mes " + ((e.estrellas.mes || 0) > 0 ? "+" : "") + (e.estrellas.mes || 0) + "</span>" +
      (e.estrellas.nivel ? "<span>Nivel " + e.estrellas.nivel + " · " + esc(e.estrellas.nombre || "") + "</span>" : "") + "</p>" : "") +
    '<div id="shibuMis">' + shibuTarjetas(e.misiones || [], { desde: function () { return 0; } }) + shibuMapaHtml(e) + "</div>" +
    '<p class="muted shibu-pie">Cada misión da sus puntos para la tienda y 1 ficha para jugar.</p>';
  $("shibuOk").textContent = "¡A trabajar!";
  $("shibuDlg").dataset.modo = "saludo";
  $("shibuDlg").showModal();
  $("shibuBody").scrollTop = 0;
  shibuLlena($("shibuBody"));
  shibuEscribe($("shibuTxt"), frase);
}
// ---- Celebración (una o varias misiones recién cumplidas): la barra se llena, cae el sello y aparece el premio
function shibuCelebra() {
  var e = SHIBU.est; if (!e || !(e.nuevos || []).length) return;
  e.nuevos.forEach(function (x) { SHIBU.celebrados[x.id] = true; });
  var nuevos = e.nuevos, pts = nuevos.reduce(function (s, x) { return s + (x.puntos || 0) + (x.comodin || 0); }, 0);
  var com = nuevos.reduce(function (s, x) { return s + (x.comodin || 0); }, 0);
  // Los avisos de avance que quedaban ya no hacen falta: ahora celebra
  SHIBU.avisos = SHIBU.avisos.filter(function (a) { return a.com; }); var avisos = $("shibuAvisos"); if (avisos) avisos.innerHTML = "";
  // «Las tres»: el día completo son las 3 del día (fácil, media y difícil); la extra suma aparte
  var regulares = (e.misiones || []).filter(function (x) { return !x.extra && (x.slot == null || x.slot <= 3); });
  var todas = nuevos.some(function (x) { return x.nivel > 0 && (x.slot == null || x.slot <= 3); }) && regulares.length > 0 && regulares.every(function (x) { return x.hecha; });
  var lista = nuevos.map(function (n) {
    var k = n.slot != null ? n.slot : n.nivel;
    var x = (e.misiones || []).find(function (m) { return shibuClave(m) === k && m.texto === n.texto; });
    return Object.assign(x ? Object.assign({}, x) : { nivel: n.nivel, slot: k, extra: k === 0, texto: n.texto, puntos: n.puntos, tipo: "", actual: 1, meta: 1, origen: n.origen },
                         { hecha: true, _id: n.id, comodin: n.comodin || 0, sorpresa: false });
  });
  var quieto = shibuQuieto(), sello0 = quieto ? 0 : 0.95, tPremio = quieto ? 0 : sello0 + (lista.length - 1) * 0.45 + 0.55;
  var confeti = "";
  if (!quieto) for (var i = 0; i < 18; i++) confeti += '<i style="left:' + (5 + i * 5.2).toFixed(1) + "%;animation-delay:" + (i % 6 * 0.12).toFixed(2) + 's"></i>';
  var fc = shibuFraseConPose(todas ? "dia_completo" : "mision");
  $("shibuBody").innerHTML = '<div class="shibu-confeti" aria-hidden="true">' + confeti + "</div>" +
    '<div class="shibu-top">' + shibuPose(todas ? "dia_completo" : "mision", "salta", fc.pose) + '<div class="shibu-dice"><div class="shibu-nom"><b>Shibu</b> <small>el jefe</small></div><p class="shibu-globo" id="shibuTxt"></p></div></div>' +
    '<div class="shibu-fiesta"><div class="fiesta-titulo">' + (todas ? "¡Las 3 misiones de hoy!" : nuevos.length > 1 ? "¡Misiones cumplidas!" : "¡Misión cumplida!") + "</div>" +
    shibuTarjetas(lista, { sellar: true, sello0: sello0, desde: function (x) { var d = SHIBU.desde[x._id]; return d == null ? 60 : d; } }) +
    '<div class="fiesta-premio" style="animation-delay:' + tPremio.toFixed(2) + 's"><i class="fiesta-moneda" aria-hidden="true"></i><b>+' + pts + "</b> punto" + (pts === 1 ? "" : "s") +
    " · <b>+" + nuevos.length + "</b> ficha" + (nuevos.length === 1 ? "" : "s") +
    (com ? ' <small class="fiesta-com">(+' + com + " de tus comodines)</small>" : "") + "</div></div>";
  $("shibuOk").textContent = "Seguir";
  var d = $("shibuDlg");
  d.dataset.modo = "fiesta";
  d.dataset.ids = nuevos.map(function (x) { return x.id; }).join(",");
  d.dataset.pts = pts; d.dataset.fichas = nuevos.length;
  d.showModal();
  $("shibuBody").scrollTop = 0;
  shibuLlena($("shibuBody"));
  shibuEscribe($("shibuTxt"), fc.t);
}
// Dónde estaba el premio de la celebración: de ahí salen volando las monedas
function shibuGuardaPremio() { var p = $("shibuBody").querySelector(".fiesta-premio"); if (p) SHIBU.rectFiesta = p.getBoundingClientRect(); }
$("shibuOk").addEventListener("click", function () { shibuGuardaPremio(); $("shibuDlg").close(); });
$("shibuDlg").addEventListener("cancel", shibuGuardaPremio);
$("shibuDlg").addEventListener("close", function () {
  var d = $("shibuDlg"), modo = d.dataset.modo; d.dataset.modo = "";
  if (!U) return;
  var r = SHIBU.rectFiesta || { left: innerWidth / 2 - 60, top: innerHeight / 2 - 20, width: 120, height: 40 };
  SHIBU.rectFiesta = null;
  if (modo === "saludo") {
    rpc("mis_marcar", { p_saludo: true, p_logros: null }).catch(function () {});
    if (SHIBU.est) SHIBU.est.saludo_hoy = true;
  } else if (modo === "fiesta") {
    var ids = (d.dataset.ids || "").split(",").filter(Boolean).map(Number);
    rpc("mis_marcar", { p_saludo: false, p_logros: ids }).catch(function () {});
    if (SHIBU.est) SHIBU.est.nuevos = [];
    shibuVuela(r, Number(d.dataset.pts) || 0, Number(d.dataset.fichas) || 0);
  } else if (modo === "top") {
    var id = Number(d.dataset.top);
    SHIBU.topVisto[id] = true;
    rpc("mis_top_visto", { p_id: id }).catch(function () {});
    shibuVuela(r, Number(d.dataset.pts) || 0, 0);
  }
  shibuCuandoLibre(shibuSiguiente);
  shibuAvisosSigue();
});

// ---- Mi perfil (Edgar, 24/11: «el botón de perfil allí en la barra principal, y de allí una interfaz con el historial
// de sus ventas, el top maid, y la expendedora»). Una pantalla completa: el carnet de la maid a un lado y sus secciones
// Hoy (misiones y premios), Mis ventas, Top maid y Expendedora, más el botón Jugar.
var HUB = { tab: "hoy", ventas: null, ventasAt: 0, ventasErr: "", pidiendo: null, firma: "", firmaLado: "", teclado: false };
var HUB_VENTAS_MS = 60000;   // «Mis ventas» se vuelve a pedir si pasó más de un minuto
var HUB_IC = {
  perfil: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="9" cy="11" r="2.4"/><path d="M5.6 16.6c.6-1.7 1.9-2.6 3.4-2.6s2.8.9 3.4 2.6M14.5 9.5h4M14.5 13h3"/>',
  hoy: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9.5 2.8h5v3h-5zM8.6 12.2l2 2 4-4.2M8.6 17.5h6.8"/>',
  ventas: '<path d="M4 20h16"/><rect x="5.5" y="12" width="3" height="5" rx="1"/><rect x="10.5" y="8" width="3" height="9" rx="1"/><rect x="15.5" y="4.5" width="3" height="12.5" rx="1"/>',
  top: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5.2a2.8 2.8 0 0 0 3 3.6M16 6h2.8a2.8 2.8 0 0 1-3 3.6M12 13v4M8.5 21h7M10 17h4v4h-4z"/>',
  tienda: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M8 6.5h5M8 9.5h5M8 12.5h5M16 6.5v6M8.5 17.5h7"/>',
  jugar: '<rect x="2.5" y="7.5" width="19" height="10" rx="5"/><path d="M7.5 10.5v4M5.5 12.5h4M15.2 11.6h.01M17.8 13.6h.01"/>'
};
var HUB_TABS = [{ id: "hoy", txt: "Hoy" }, { id: "ventas", txt: "Mis ventas" }, { id: "top", txt: "Top maid" }, { id: "tienda", txt: "Expendedora" }];
function shibuIc(d) {
  return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
}
// La foto del premio es la del plato del menú (si el premio tiene plato y el plato tiene foto)
function shibuFoto(t) {
  var d = t && t.dish_id && typeof MENU !== "undefined" ? (MENU.dishes || []).find(function (x) { return x.id === t.dish_id; }) : null, u = d && d.photo_url;
  return u && /^(assets\/|data:image\/|https:\/\/)/.test(u) ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '<span class="premio-sin-foto" aria-hidden="true">★</span>';
}
function shibuMaquinaOcupada() { return typeof VM !== "undefined" && VM.ocupada; }
function shibuS(n, uno, varios) { return n + " " + (n === 1 ? uno : varios); }

function shibuPerfil(tab) {
  if (!U || !SHIBU.est || !SHIBU.est.juega || shibuMaquinaOcupada()) return;
  var d = $("perfilDlg"), ses = SHIBU.sesion;
  HUB.tab = tab || "hoy"; HUB.firma = "";
  shibuPerfilDibuja();
  if (!d.open) d.showModal();
  rpc("mis_estado").then(function (e) { if (!shibuVigente(ses)) return; SHIBU.est = e; shibuChip(); if (d.open) shibuHubAlDia(); }).catch(function () {});
  shibuVentasPide(true);
}
function shibuPerfilDibuja() { shibuHubLado(); shibuHubPanel(false); }
// Lo nuevo de la base (cada 30 s o al abrir): el carnet siempre; la sección, solo si cambió algo (la máquina no se reinicia)
function shibuHubAlDia() {
  if (!$("perfilDlg").open) return;
  shibuHubLado();
  if (HUB.tab === "tienda") { if (typeof vmAlDia === "function") vmAlDia(); }
  else shibuHubPanel(true);
}
function shibuHubVe(tab) {
  if (tab === HUB.tab || shibuMaquinaOcupada()) return;
  if (typeof vmSuelta === "function") vmSuelta(false);
  HUB.tab = tab; HUB.firma = "";
  shibuHubLado(); shibuHubPanel(false);
  if (tab === "ventas") shibuVentasPide(false);
  // Con teclado, el foco sigue en la sección elegida (al tocar con el dedo no queda el anillo)
  var b = document.querySelector('#perfilLado [data-hub="' + tab + '"]'); if (b && HUB.teclado) b.focus();
}
document.addEventListener("keydown", function () { HUB.teclado = true; }, true);
document.addEventListener("pointerdown", function () { HUB.teclado = false; }, true);
// «Mis ventas» viene de la base (mis_ventas): se pide al abrir el perfil y al entrar a la sección si pasó un minuto
function shibuVentasPide(siempre) {
  if (!U || HUB.pidiendo || (!siempre && HUB.ventas && Date.now() - HUB.ventasAt < HUB_VENTAS_MS)) return;
  var quien = U.id;
  HUB.ventasErr = "";
  HUB.pidiendo = rpc("mis_ventas").then(function (v) {
    if (U && U.id === quien) { HUB.ventas = v; HUB.ventasAt = Date.now(); }
  }, function (err) { if (U && U.id === quien) HUB.ventasErr = errMsg(err) || "Sin conexión"; }).then(function () {
    HUB.pidiendo = null;
    if (U && U.id === quien && $("perfilDlg").open) { shibuHubLado(); if (HUB.tab === "ventas") shibuHubPanel(true); }
  });
}

// ---- El carnet y las secciones (a la izquierda en la tablet; arriba en el teléfono)
function shibuHubLado() {
  var e = SHIBU.est; if (!e) return;
  var nombre = String(e.nombre || (U && U.name) || ""), mio = (e.ranking || []).filter(function (x) { return x.yo; })[0];
  var m = e.misiones || [], hechas = m.filter(function (x) { return x.hecha; }).length, pts = e.puntos || 0, fch = e.fichas || 0;
  var hayJuegos = typeof abrirJuegos === "function" && (e.juegos || {}).activo !== false, v = HUB.ventas;
  var info = { hoy: "★ " + hechas + "/" + m.length, ventas: v && v.hoy ? ref(v.hoy.monto) + " hoy" : "", top: mio ? mio.puesto + ".º del mes" : "",
               tienda: shibuS(pts, "punto", "puntos") };
  // Cada 30 s llega lo nuevo de la base: el carnet solo se redibuja si algo cambió (no parpadea ni se come un toque)
  var es = e.estrellas || { total: 0, mes: 0, nivel: 0 };
  var firma = JSON.stringify([nombre, e.grupo, mio && mio.puesto, pts, fch, info, HUB.tab, hayJuegos, es.total, es.mes, es.nivel, e.mejoras,
                              (e.comodines || {}).insignias]);
  if (firma === HUB.firmaLado && $("perfilLado").firstChild) return;
  HUB.firmaLado = firma;
  $("perfilLado").innerHTML =
    '<div class="carnet marco-' + shibuMarco(es.nivel) + '">' +
      '<div class="carnet-cinta"><img src="assets/logo-gato.png" alt=""><span>ICHIRAKU · ' + (e.grupo === "cajeras" ? "CAJA" : "MAID") + "</span></div>" +
      '<div class="carnet-fila"><span class="carnet-ava' + (mio && mio.puesto <= 3 ? " p" + mio.puesto : "") + '" aria-hidden="true">' + esc(nombre.charAt(0).toUpperCase() || "?") + "</span>" +
        '<div class="carnet-quien"><b>' + esc(nombre) + "</b><span>" + (e.grupo === "cajeras" ? "Cajera" : "Maid") +
          (mio ? " · " + mio.puesto + ".º del Top maid" : "") + "</span></div></div>" +
      '<div class="perfil-saldos"><span class="pts"><i class="carnet-ico" aria-hidden="true">★</i><b id="hubPts">' + pts + "</b> punto" + (pts === 1 ? "" : "s") + "</span>" +
        '<span class="fch"><i class="jgo-moneda" aria-hidden="true"></i><b>' + fch + "</b> ficha" + (fch === 1 ? "" : "s") + "</span></div>" +
      shibuEstrellasCarnet(es) + shibuInsigniasHtml(e) +
    "</div>" +
    '<nav class="hub-nav" aria-label="Secciones de mi perfil">' + HUB_TABS.map(function (t) {
      var on = HUB.tab === t.id;
      return '<button type="button" class="hub-tab' + (on ? " on" : "") + '" data-hub="' + t.id + '"' + (on ? ' aria-current="page"' : "") + ">" +
        shibuIc(HUB_IC[t.id]) + '<span class="ht-txt"><b>' + t.txt + "</b><small>" + esc(info[t.id]) + "</small></span></button>";
    }).join("") +
      (hayJuegos ? '<button type="button" class="hub-tab jugar" id="perfilJugar">' + shibuIc(HUB_IC.jugar) + '<span class="ht-txt"><b>Jugar</b><small>' +
        shibuS(fch, "ficha", "fichas") + "</small></span></button>" : "") +
    "</nav>" +
    (HUB.tab !== "tienda" && SHIBU.frases && SHIBU.frases.poses && SHIBU.frases.poses.perfil ? '<div class="hub-shibu" aria-hidden="true">' + shibuPose("perfil") + "</div>" : "");
  // En el teléfono las secciones van en una tira que se desliza: la elegida queda a la vista
  var nav = document.querySelector("#perfilLado .hub-nav"), on = nav && nav.querySelector(".hub-tab.on");
  if (on && nav.scrollWidth > nav.clientWidth + 1) nav.scrollLeft = Math.max(0, on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2);
}
// Estrellas de los clientes (Edgar, 25/11): cada opinión de 4 o 5 suma 1 y las de 1 o 2 restan 1. Niveles a las 5, 15, 30,
// 60 y 100; el carnet cambia de marco con el nivel (bronce, plata, oro y el de Leyenda, que brilla)
function shibuMarco(n) {
  var mj = (SHIBU.est && SHIBU.est.mejoras) || { bronce: 1, plata: 3, oro: 4, animado: 5 };
  function ok(k) { return mj[k] != null && n >= mj[k]; }
  return ok("animado") ? "leyenda" : ok("oro") ? "oro" : ok("plata") ? "plata" : ok("bronce") ? "bronce" : "base";
}
// Las insignias que compró (comodín de nivel 4) y el regalo de Leyenda (mejora de nivel 5: un llavero o una pulsera)
function shibuInsigniasHtml(e) {
  var l = ((e && e.comodines) || {}).insignias || [], mj = (e && e.mejoras) || {}, n = ((e && e.estrellas) || {}).nivel || 0, h = "";
  if (l.length) h += '<div class="carnet-insignias" aria-label="Sus insignias">' + l.map(function (k) {
    return '<span title="Insignia ' + esc(k) + '">' + (INSIGNIA_IC[k] || "🏅") + "</span>";
  }).join("") + "</div>";
  if (mj.llavero != null && n >= mj.llavero) h += '<p class="carnet-regalo">🎁 Regalo de Leyenda: un llavero o una pulsera de Ichiraku. Pídeselo al encargado.</p>';
  return h;
}
function shibuEstrellasCarnet(es) {
  es = es || {}; var total = es.total || 0, mes = es.mes || 0, n = es.nivel || 0, niv = es.niveles || [5, 15, 30, 60, 100];
  var antes = n > 0 ? niv[n - 1] : 0, sig = es.siguiente, pct = sig ? Math.max(0, Math.min(100, Math.round((total - antes) / (sig - antes) * 100))) : 100;
  return '<div class="carnet-estrellas" aria-label="' + esc(shibuS(total, "estrella", "estrellas") + " de los clientes" + (n ? ", nivel " + n + " " + es.nombre : "")) + '">' +
    '<div class="ce-fila"><span class="ce-total"><i aria-hidden="true">⭐</i><b id="hubEst">' + total + "</b> " + (total === 1 ? "estrella" : "estrellas") + "</span>" +
      '<span class="ce-mes">este mes ' + (mes > 0 ? "+" : "") + mes + "</span></div>" +
    '<div class="ce-nivel">' + (n ? "<b>Nivel " + n + "</b> · " + esc(es.nombre || "") : "<b>Sin nivel todavía</b>") + "</div>" +
    (sig ? '<div class="ce-barra" aria-hidden="true"><i style="width:' + pct + '%"></i></div><small class="ce-falta">Faltan ' + (es.falta || sig - total) +
      " para " + esc(es.siguiente_nombre || "el siguiente nivel") + "</small>" : '<small class="ce-falta">¡Nivel máximo!</small>') +
  "</div>";
}
// La sección elegida. «soloSiCambio»: al refrescar, no se redibuja si los datos son los mismos (y no salta el scroll)
function shibuHubPanel(soloSiCambio) {
  var e = SHIBU.est, p = $("perfilBody"); if (!e || !p) return;
  var tab = HUB.tab;
  var firma = tab + "|" + (tab === "hoy" ? JSON.stringify([e.misiones, e.canjes, e.puntos, e.fichas, (e.juegos || {}).activo, e.comodines])
    : tab === "top" ? JSON.stringify([e.ranking, e.campeona, e.premios_top])
    : tab === "ventas" ? HUB.ventasAt + "|" + HUB.ventasErr + "|" + !!HUB.ventas : "");
  if (soloSiCambio && firma === HUB.firma) return;
  HUB.firma = firma;
  var y = soloSiCambio ? p.scrollTop : 0;
  p.className = "hub-panel " + tab;
  if (tab === "tienda") {
    p.innerHTML = '<h2 class="hub-oculto">Expendedora</h2><div class="hub-vm" id="hubVm"></div>';
    if (typeof vmAbre === "function") vmAbre($("hubVm"));
    p.scrollTop = 0;
    return;
  }
  p.innerHTML = tab === "hoy" ? shibuHubHoy(e) : tab === "ventas" ? shibuHubVentas() : shibuHubTop(e);
  p.scrollTop = y;
  if (tab === "hoy") shibuLlena(p);
}
function shibuHubCab(titulo, sub) {
  return '<div class="hub-cab"><h2>' + titulo + "</h2>" + (sub ? "<p>" + sub + "</p>" : "") + "</div>";
}

// ---- Hoy: sus misiones, atajos a la expendedora y a los juegos, y sus últimos premios
function shibuHubHoy(e) {
  var m = e.misiones || [], hechas = m.filter(function (x) { return x.hecha; }).length, pts = e.puntos || 0, fch = e.fichas || 0;
  var hayJuegos = typeof abrirJuegos === "function" && (e.juegos || {}).activo !== false;
  var est = { entregado: "A cocina", pendiente: "Esperando", rechazado: "No salió" };
  return shibuHubCab("Hoy", m.length ? "Llevas " + hechas + " de " + m.length + " misiones. Cada una da sus puntos y 1 ficha." : "") +
    shibuTarjetas(m) + shibuMapaHtml(e) + shibuComodinesHoy(e) +
    '<div class="hub-atajos">' +
      '<button type="button" class="hub-atajo tienda" data-hub="tienda" data-vmodo="premios">' + shibuIc(HUB_IC.tienda) +
        "<span><b>Expendedora</b><small>Tienes " + shibuS(pts, "punto", "puntos") + " para premios</small></span></button>" +
      ((e.comodines || {}).catalogo ? '<button type="button" class="hub-atajo comodines" data-hub="tienda" data-vmodo="comodines">' + shibuIc(HUB_IC.tienda) +
        "<span><b>Comodines</b><small>" + shibuS(((e.comodines || {}).activos || []).length, "activo", "activos") + "</small></span></button>" : "") +
      (hayJuegos ? '<button type="button" class="hub-atajo jugar" id="perfilJugar2">' + shibuIc(HUB_IC.jugar) +
        "<span><b>Jugar</b><small>Tienes " + shibuS(fch, "ficha", "fichas") + "</small></span></button>" : "") +
    "</div>" +
    ((e.canjes || []).length ? '<h3 class="hub-sub">Mis premios</h3><div class="hub-premios">' + e.canjes.map(function (c) {
      return '<div class="canje-row ' + esc(c.estado) + '"><span>' + esc(c.nombre) + " · " + (c.regalo ? "gratis" : c.puntos + " pts") + "</span><b>" + esc(est[c.estado] || c.estado) + "</b></div>";
    }).join("") + "</div>" : "");
}
// ---- Top maid: el podio olímpico del mes
function shibuHubTop(e) {
  return shibuHubCab("Top maid", "Las maids con más puntos de misiones en " + esc(shibuMes(e.fecha)) + ".") +
    (shibuOlimpo(e) || '<p class="muted">El Top maid sale cuando la base lo mande.</p>');
}

// ---- Mis ventas: hoy, la semana y el mes; sus últimos 14 días en barras; sus comandas de la semana y lo que más vende
var SHIBU_DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
function shibuDia(f) { return new Date(String(f).slice(0, 10) + "T12:00:00"); }
function shibuDiaCorto(f) { var d = shibuDia(f); return SHIBU_DIAS[d.getDay()].slice(0, 3).toLowerCase() + " " + d.getDate(); }
function shibuDiaTitulo(f, hoy) {
  var d = shibuDia(f), n = Math.round((shibuDia(hoy) - d) / 864e5);
  return n === 0 ? "Hoy" : n === 1 ? "Ayer" : SHIBU_DIAS[d.getDay()] + " " + d.getDate();
}
function shibuRefCorto(n) { n = Number(n) || 0; return "Ref " + (n >= 100 ? Math.round(n) : nf2.format(n).replace(/,00$/, "")); }
function shibuHubVentas() {
  var v = HUB.ventas, cab = shibuHubCab("Mis ventas", "Lo que tú anotaste en comandas cobradas.");
  if (!v) {
    if (HUB.ventasErr) return cab + '<div class="hub-vacio"><b>No se pudieron cargar tus ventas.</b><span>' + esc(HUB.ventasErr) +
      '</span><button type="button" id="hubReintentar">Reintentar</button></div>';
    return cab + '<div class="hub-cargando" role="status" aria-label="Cargando tus ventas"><i></i><i></i><i></i></div>';
  }
  var hoy = v.hoy || {}, sem = v.semana || {}, ant = v.semana_pasada || {}, mes = v.mes_total || {}, mejor = v.mejor_dia;
  var nomMes = shibuMes(v.fecha), nMes = Number(mes.comandas) || 0, dias = v.dias || [];
  var kpi = function (cls, tit, monto, sub, nota) {
    return '<div class="vt-kpi ' + cls + '"><span class="vt-tit">' + tit + "</span><b>" + ref(monto) + "</b><span>" + sub + "</span>" + (nota ? "<small>" + nota + "</small>" : "") + "</div>";
  };
  var h = cab + '<div class="vt-kpis">' +
    kpi("hoy", "Hoy", hoy.monto, shibuS(Number(hoy.comandas) || 0, "comanda", "comandas") + " · " + shibuS(Number(hoy.platos) || 0, "plato", "platos")) +
    kpi("sem", "Esta semana", sem.monto, shibuS(Number(sem.comandas) || 0, "comanda", "comandas"),
        Number(ant.monto) > 0 ? "La semana pasada a esta altura: " + ref(ant.monto) : "") +
    kpi("mes", nomMes.charAt(0).toUpperCase() + nomMes.slice(1), mes.monto,
        shibuS(nMes, "comanda", "comandas") + (Number(mes.dias) ? " en " + shibuS(Number(mes.dias), "día", "días") : ""),
        mejor && Number(mejor.monto) > 0 ? "Tu mejor día: " + shibuDiaCorto(mejor.fecha) + " · " + ref(mejor.monto) : "") +
    "</div>";
  // Las barras de los 14 días: una sola tinta; hoy resaltado; se rotulan hoy y el día más alto
  var max = 0, iMax = -1;
  dias.forEach(function (d, i) { if (Number(d.monto) > max) { max = Number(d.monto); iMax = i; } });
  var resumen = dias.filter(function (d) { return Number(d.monto) > 0; }).map(function (d) { return shibuDiaCorto(d.fecha) + " " + ref(d.monto); }).join(", ");
  h += '<div class="vt-cuerpo"><div class="vt-col">' +
    '<section class="vt-card"><h3>Tus últimos 14 días</h3>' +
    '<div class="vt-graf" role="group" aria-label="' + esc("Ventas de los últimos 14 días" + (resumen ? ": " + resumen : ": sin ventas")) + '">' +
    '<div class="vt-barras">' + dias.map(function (d, i) {
      var mto = Number(d.monto) || 0, esHoy = i === dias.length - 1, alto = mto > 0 && max > 0 ? Math.max(3, Math.round(mto / max * 100)) : 0, dd = shibuDia(d.fecha);
      var etiqueta = (esHoy || i === iMax) && mto > 0 ? '<span class="vt-val">' + shibuRefCorto(mto) + "</span>" : "";
      return '<button type="button" class="vt-dia' + (esHoy ? " hoy" : "") + (mto ? "" : " cero") + '" data-tip="' +
        esc(shibuDiaTitulo(d.fecha, v.fecha) + " · " + ref(mto) + " · " + shibuS(Number(d.comandas) || 0, "comanda", "comandas")) + '" aria-label="' +
        esc(shibuDiaCorto(d.fecha) + ": " + ref(mto) + ", " + shibuS(Number(d.comandas) || 0, "comanda", "comandas")) + '">' +
        '<span class="vt-col-barra" style="--h:' + alto + '%">' + etiqueta + '<i style="height:' + alto + '%"></i></span>' +
        '<span class="vt-eje"><b>' + (esHoy ? "Hoy" : SHIBU_DIAS[dd.getDay()].charAt(0)) + "</b>" + dd.getDate() + "</span></button>";
    }).join("") + '</div><div class="vt-tip" id="vtTip" hidden></div></div></section>';
  // Lo que más vende en el mes
  var top = v.platos_top || [], maxQ = top.reduce(function (s, x) { return Math.max(s, Number(x.qty) || 0); }, 0);
  h += '<section class="vt-card"><h3>Lo que más vendes en ' + esc(nomMes) + "</h3>" + (top.length ? '<ol class="vt-top">' + top.map(function (x, i) {
    var q = Number(x.qty) || 0;
    return '<li><span class="vt-pos">' + (i + 1) + '</span><span class="vt-plato"><b>' + esc(x.nombre) + '</b><i style="width:' + (maxQ ? Math.round(q / maxQ * 100) : 0) +
      '%"></i></span><span class="vt-cant"><b>' + q + "</b> <small>" + ref(x.monto) + "</small></span></li>";
  }).join("") + "</ol>" : '<p class="vt-nada">Cuando cobren comandas que tú anotaste, aquí salen tus platos más vendidos.</p>') + "</section></div>";
  // Sus comandas de la última semana, por día
  var coms = v.comandas || [], porDia = [], hdr = {};
  coms.forEach(function (c) { var f = String(c.fecha).slice(0, 10); if (!hdr[f]) { hdr[f] = { f: f, l: [], t: 0 }; porDia.push(hdr[f]); } hdr[f].l.push(c); hdr[f].t += Number(c.monto) || 0; });
  h += '<section class="vt-card vt-lista"><h3>Mis comandas <small>de los últimos 7 días</small></h3>' + (porDia.length ? porDia.map(function (g) {
    return '<h4 class="vt-dia-tit"><span>' + esc(shibuDiaTitulo(g.f, v.fecha)) + "</span><b>" + ref(g.t) + "</b></h4><ul class=\"vt-coms\">" + g.l.map(function (c) {
      return '<li><span class="vt-hora">' + new Date(c.cerrada).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) + "</span>" +
        '<span class="vt-que"><b>' + esc(c.mesa) + (c.numero ? " <em>#" + c.numero + "</em>" : "") + "</b><small>" + esc(c.detalle || "") + "</small></span>" +
        '<b class="vt-monto">' + ref(c.monto) + "</b></li>";
    }).join("") + "</ul>";
  }).join("") : '<p class="vt-nada">Todavía no tienes comandas cobradas esta semana.</p>') + "</section></div>" +
    '<p class="hub-nota">Cuentan las comandas cobradas que tú anotaste. No cuentan los premios de Ref 0, Yummy ni el consumo del personal.</p>';
  return h;
}
// El globito de cada barra: al pasar el dedo, al tocarla o con el teclado
function shibuVtTip(b) {
  var t = $("vtTip"); if (!t) return;
  if (!b) { t.hidden = true; return; }
  var g = b.closest(".vt-graf").getBoundingClientRect(), r = b.getBoundingClientRect();
  t.textContent = b.dataset.tip; t.hidden = false;
  var x = r.left + r.width / 2 - g.left, w = t.offsetWidth;
  t.style.left = Math.max(w / 2 + 4, Math.min(g.width - w / 2 - 4, x)) + "px";
}

$("perfilDlg").addEventListener("click", function (ev) {
  var t = ev.target.closest("[data-hub]");
  if (t) { if (t.dataset.vmodo && typeof VM !== "undefined") VM.modo = t.dataset.vmodo; shibuHubVe(t.dataset.hub); return; }
  if (ev.target.closest("#perfilClose")) { if (!shibuMaquinaOcupada()) $("perfilDlg").close(); return; }
  if (ev.target.closest("#perfilJugar, #perfilJugar2")) { if (shibuMaquinaOcupada()) return; $("perfilDlg").close(); abrirJuegos(); return; }
  if (ev.target.closest("#hubReintentar")) { shibuVentasPide(true); return; }
  var b = ev.target.closest(".vt-dia"); if (b) shibuVtTip(b);
});
$("perfilDlg").addEventListener("pointerover", function (ev) { var b = ev.target.closest(".vt-dia"); if (b) shibuVtTip(b); });
$("perfilDlg").addEventListener("pointerout", function (ev) { if (ev.target.closest(".vt-dia") && !(ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest(".vt-dia"))) shibuVtTip(null); });
$("perfilDlg").addEventListener("focusin", function (ev) { var b = ev.target.closest(".vt-dia"); shibuVtTip(b || null); });
// Mientras cae un premio de la máquina no se cierra (Escape espera a que termine)
$("perfilDlg").addEventListener("cancel", function (ev) { if (shibuMaquinaOcupada()) ev.preventDefault(); });
$("perfilDlg").addEventListener("close", function () { if (typeof vmSuelta === "function") vmSuelta(false); shibuVtTip(null); });
// ---- Top maid del mes: un podio olímpico griego (Edgar: «una estatua griega olímpica donde se vea glorioso el primer lugar»)
// Templo de mármol con su frontón, podio con greca y una estatua de taiyaki por puesto: oro (con laurel, rayos y brillo),
// plata y bronce. El ranking lo calcula la base (mis_ranking): solo puntos de misiones del mes.
var SHIBU_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
var SHIBU_METAL = { 1: "oro", 2: "plata", 3: "bronce" };
var SHIBU_ROMANO = { 1: "I", 2: "II", 3: "III" };
var SHIBU_OSCURO = { oro: "#B8860B", plata: "#7E889C", bronce: "#8E4F23" };
var SHIBU_TAI = {
  cola: "M50 15 L62 7 C59.5 14 59.5 26 62 33 L50 25 Z",
  cuerpo: "M5 20 C5 10 15 4.5 29 4.5 C39 4.5 46 9 51 15 L51 25 C46 31 39 35.5 29 35.5 C15 35.5 5 30 5 20 Z",
  esc: "M26 13 a4 4 0 0 0 8 0 M34 13 a4 4 0 0 0 8 0 M22 20.5 a4 4 0 0 0 8 0 M30 20.5 a4 4 0 0 0 8 0 M38 20.5 a4 4 0 0 0 8 0 M26 28 a4 4 0 0 0 8 0 M34 28 a4 4 0 0 0 8 0",
  agalla: "M19 11 C22.5 15.5 22.5 24.5 19 29",
  brillo: "M11 11.5 C16 7.8 23 6.8 30 7.2"
};
var SHIBU_SVG = 0;   // cada dibujo usa sus propios id de degradados
var SHIBU_TINTA = '#1B2D6B';
function shibuMes(fecha) { return SHIBU_MESES[Number(String(fecha || "").slice(5, 7)) - 1] || "este mes"; }
function shibuCorto(t, n) { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; }
function shibuDefs(k) {
  function lineal(id, a, b, c) {
    return '<linearGradient id="' + id + k + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset=".5" stop-color="' + b +
      '"/><stop offset="1" stop-color="' + c + '"/></linearGradient>';
  }
  return "<defs>" + lineal("oro", "#FFF4B8", "#FFC928", "#C08A00") + lineal("plata", "#FFFFFF", "#D3D9E4", "#8E97A8") +
    lineal("bronce", "#F8D6B6", "#D18A52", "#8E4F23") + lineal("marmol", "#FFFFFF", "#F0ECE5", "#D6CFC3") +
    '<linearGradient id="cielo' + k + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B9E4FA"/><stop offset=".78" stop-color="#FDF5E6"/></linearGradient>' +
    '<radialGradient id="sol' + k + '"><stop offset="0" stop-color="#FFE58A" stop-opacity=".95"/><stop offset=".55" stop-color="#FFE58A" stop-opacity=".35"/>' +
      '<stop offset="1" stop-color="#FFE58A" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="glint' + k + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/>' +
      '<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<pattern id="greca' + k + '" width="22" height="11" patternUnits="userSpaceOnUse"><rect width="22" height="11" fill="#FFC928"/>' +
      '<path d="M0 9.5 H18.5 V1.5 H4.5 V6.5 H14 V4 H8.5" fill="none" stroke="' + SHIBU_TINTA + '" stroke-width="1.6"/></pattern>' +
    '<clipPath id="tai' + k + '"><path d="' + SHIBU_TAI.cuerpo + '"/><path d="' + SHIBU_TAI.cola + '"/></clipPath>' +
    "</defs>";
}
// Rayos de sol que giran despacio detrás de la ganadora
function shibuRayos(cx, cy, r, k) {
  var h = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="url(#sol' + k + ')"/><g class="ol-rayos" style="transform-origin:' + cx + "px " + cy + 'px">';
  for (var i = 0; i < 18; i++) {
    var a = i * 20 * Math.PI / 180, d = 4.5 * Math.PI / 180, R = r * 1.9;
    h += '<polygon points="' + cx + "," + cy + " " + (cx + R * Math.cos(a - d)).toFixed(1) + "," + (cy + R * Math.sin(a - d)).toFixed(1) + " " +
      (cx + R * Math.cos(a + d)).toFixed(1) + "," + (cy + R * Math.sin(a + d)).toFixed(1) + '" fill="#FFD84D" opacity="' + (i % 2 ? ".10" : ".2") + '"/>';
  }
  return h + "</g>";
}
// Corona de laurel: dos ramas tupidas que abrazan la estatua, abiertas abajo (ahí va el pedestal) y casi cerradas arriba
function shibuLaurel(cx, cy, r, color) {
  var hoja = "M0 0 C4 -5.5 12 -5.5 17 0 C12 5.5 4 5.5 0 0Z", h = '<g class="ol-laurel">', n = 11;
  [[128, 256, 90], [52, -76, -90]].forEach(function (rama) {
    // El tallo
    var a0 = rama[0] * Math.PI / 180, a1 = rama[1] * Math.PI / 180, grande = Math.abs(rama[1] - rama[0]) > 180 ? 1 : 0, barre = rama[2] > 0 ? 1 : 0;
    h += '<path d="M' + (cx + r * Math.cos(a0)).toFixed(1) + " " + (cy + r * Math.sin(a0)).toFixed(1) + " A" + r + " " + r + " 0 " + grande + " " + barre + " " +
      (cx + r * Math.cos(a1)).toFixed(1) + " " + (cy + r * Math.sin(a1)).toFixed(1) + '" fill="none" stroke="' + SHIBU_TINTA + '" stroke-width="1.6"/>';
    for (var k = 0; k <= n; k++) {
      var ang = rama[0] + (rama[1] - rama[0]) * k / n, th = ang * Math.PI / 180, x = cx + r * Math.cos(th), y = cy + r * Math.sin(th);
      [-38, 38].forEach(function (d) {
        h += '<path d="' + hoja + '" transform="translate(' + x.toFixed(1) + " " + y.toFixed(1) + ") rotate(" + (ang + rama[2] + d).toFixed(1) + ") scale(" +
          (1.08 - k * 0.035).toFixed(2) + ')" fill="' + color + '" stroke="' + SHIBU_TINTA + '" stroke-width="1.1"/>';
      });
    }
  });
  return h + "</g>";
}
// Destellos de 4 puntas alrededor del oro
function shibuDestellos(lista) {
  return lista.map(function (p, i) {
    return '<path class="ol-destello" style="animation-delay:' + (i * 0.37).toFixed(2) + 's;transform-origin:' + p[0] + "px " + p[1] + 'px" d="M' + p[0] + " " + (p[1] - p[2]) +
      " L" + (p[0] + p[2] * 0.25) + " " + (p[1] - p[2] * 0.25) + " L" + (p[0] + p[2]) + " " + p[1] + " L" + (p[0] + p[2] * 0.25) + " " + (p[1] + p[2] * 0.25) +
      " L" + p[0] + " " + (p[1] + p[2]) + " L" + (p[0] - p[2] * 0.25) + " " + (p[1] + p[2] * 0.25) + " L" + (p[0] - p[2]) + " " + p[1] +
      " L" + (p[0] - p[2] * 0.25) + " " + (p[1] - p[2] * 0.25) + 'Z" fill="#FFF6C7" stroke="#FFC928" stroke-width="1"/>';
  }).join("");
}
// La estatua: un taiyaki de metal (oro, plata o bronce); el de oro lleva un brillo que lo recorre
function shibuTaiG(x, y, s, metal, k, brillo) {
  var f = "url(#" + metal + k + ")", o = SHIBU_OSCURO[metal];
  return '<g transform="translate(' + x.toFixed(1) + " " + y.toFixed(1) + ") scale(" + s + ')">' +
    '<path d="' + SHIBU_TAI.cola + '" fill="' + f + '" stroke="' + SHIBU_TINTA + '" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="' + SHIBU_TAI.cuerpo + '" fill="' + f + '" stroke="' + SHIBU_TINTA + '" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="' + SHIBU_TAI.esc + '" fill="none" stroke="' + o + '" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="' + SHIBU_TAI.agalla + '" fill="none" stroke="' + o + '" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="' + SHIBU_TAI.brillo + '" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2.2" stroke-linecap="round"/>' +
    '<circle cx="12.5" cy="17" r="2.6" fill="' + SHIBU_TINTA + '"/>' +
    (brillo ? '<g clip-path="url(#tai' + k + ')"><rect class="ol-glint" x="-30" y="-2" width="24" height="44" fill="url(#glint' + k + ')"/></g>' : "") + "</g>";
}
// Pedestal de mármol (un tambor de columna con estrías)
function shibuPedestal(cx, top, w, h, k) {
  var g = '<rect x="' + (cx - w / 2 - 4) + '" y="' + top + '" width="' + (w + 8) + '" height="6" rx="2" fill="url(#marmol' + k + ')" stroke="' + SHIBU_TINTA + '" stroke-width="2"/>' +
    '<rect x="' + (cx - w / 2) + '" y="' + (top + 6) + '" width="' + w + '" height="' + (h - 6) + '" fill="url(#marmol' + k + ')" stroke="' + SHIBU_TINTA + '" stroke-width="2"/>';
  [-w / 4, 0, w / 4].forEach(function (d) { g += '<line x1="' + (cx + d) + '" y1="' + (top + 10) + '" x2="' + (cx + d) + '" y2="' + (top + h - 3) + '" stroke="#CFC8BB" stroke-width="1.5"/>'; });
  return g;
}
function shibuColumna(cx, top, bot, k) {
  var m = "url(#marmol" + k + ")", t = SHIBU_TINTA;
  var g = '<rect x="' + (cx - 21) + '" y="' + top + '" width="42" height="8" fill="' + m + '" stroke="' + t + '" stroke-width="2"/>' +
    '<path d="M' + (cx - 17) + " " + (top + 8) + " L" + (cx + 17) + " " + (top + 8) + " L" + (cx + 13) + " " + (top + 15) + " L" + (cx - 13) + " " + (top + 15) + 'Z" fill="' + m + '" stroke="' + t + '" stroke-width="2"/>' +
    '<rect x="' + (cx - 14) + '" y="' + (top + 15) + '" width="28" height="' + (bot - top - 25) + '" fill="' + m + '" stroke="' + t + '" stroke-width="2"/>' +
    '<rect x="' + (cx - 19) + '" y="' + (bot - 10) + '" width="38" height="10" fill="' + m + '" stroke="' + t + '" stroke-width="2"/>';
  [-7, 0, 7].forEach(function (d) { g += '<line x1="' + (cx + d) + '" y1="' + (top + 19) + '" x2="' + (cx + d) + '" y2="' + (bot - 14) + '" stroke="#D3CCBF" stroke-width="1.6"/>'; });
  return g;
}
// El podio completo (para Mi perfil)
var SHIBU_PODIO = {
  1: { x: 296, w: 128, top: 256, ped: [212, 50, 44], tai: 1.5, num: [318, 34], nom: [346, 15], pts: [367, 12] },
  2: { x: 180, w: 116, top: 298, ped: [266, 40, 32], tai: 1.05, num: [350, 28], nom: [374, 13], pts: [392, 11] },
  3: { x: 424, w: 116, top: 320, ped: [290, 40, 30], tai: 0.95, num: [360, 22], nom: [380, 12], pts: [396, 11] }
};
function shibuOlimpo(e) {
  var r = e.ranking;
  if (!r) return "";   // una base que todavía no manda el ranking
  var k = "o" + (++SHIBU_SVG), mes = shibuMes(e.fecha), t = SHIBU_TINTA, suelo = 404;
  var lugar = {};
  r.slice(0, 3).forEach(function (x, i) { if (!lugar[i + 1]) lugar[i + 1] = x; });   // por orden de la lista (con empates, quedan juntas)
  var premios = e.premios_top || [10, 6, 3];
  var s = '<svg class="olimpo" viewBox="0 0 720 440" role="img" aria-label="' + esc("Top maid de " + mes + ". " + [1, 2, 3].filter(function (p) { return lugar[p]; }).map(function (p) {
    return p + ".ª " + lugar[p].nombre + " con " + lugar[p].puntos + " puntos";
  }).join("; ")) + '">' + shibuDefs(k) +
    '<rect width="720" height="440" fill="url(#cielo' + k + ')"/>' + shibuRayos(360, 186, 230, k) +
    // Nubes del Olimpo
    '<g fill="#fff" opacity=".9"><ellipse cx="236" cy="392" rx="70" ry="18"/><ellipse cx="200" cy="384" rx="34" ry="18"/><ellipse cx="490" cy="392" rx="70" ry="18"/>' +
      '<ellipse cx="526" cy="382" rx="36" ry="20"/></g>' +
    // El templo: frontón con estrella, friso con el título y cuatro columnas
    '<polygon points="28,96 360,22 692,96" fill="url(#marmol' + k + ')" stroke="' + t + '" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<polygon points="74,90 360,32 646,90" fill="#EEE8DD" stroke="#CFC8BB" stroke-width="1.5"/>' +
    shibuDestellos([[360, 66, 11]]).replace("ol-destello", "ol-estrella").replace("#FFF6C7", "#FFC928").replace('stroke="#FFC928"', 'stroke="' + t + '"') +
    '<rect x="38" y="96" width="644" height="26" fill="url(#marmol' + k + ')" stroke="' + t + '" stroke-width="2.5"/>' +
    '<text class="ol-friso" x="360" y="115" text-anchor="middle">TOP MAID · ' + esc(mes.toUpperCase()) + "</text>" +
    shibuColumna(76, 122, suelo, k) + shibuColumna(140, 122, suelo, k) + shibuColumna(580, 122, suelo, k) + shibuColumna(644, 122, suelo, k) +
    // El piso de mármol
    '<rect x="0" y="' + suelo + '" width="720" height="36" fill="url(#marmol' + k + ')"/><line x1="0" y1="' + suelo + '" x2="720" y2="' + suelo + '" stroke="' + t + '" stroke-width="2.5"/>' +
    '<g stroke="#D3CCBF" stroke-width="1.2"><line x1="120" y1="' + suelo + '" x2="90" y2="440"/><line x1="260" y1="' + suelo + '" x2="248" y2="440"/>' +
      '<line x1="460" y1="' + suelo + '" x2="472" y2="440"/><line x1="600" y1="' + suelo + '" x2="630" y2="440"/></g>';
  // El podio: un bloque por puesto, con greca, número romano, nombre y puntos
  [2, 3, 1].forEach(function (p) {
    var b = SHIBU_PODIO[p], x = b.x, w = b.w, top = b.top, cx = x + w / 2, q = lugar[p];
    s += '<rect x="' + x + '" y="' + (top + 8) + '" width="' + w + '" height="' + (suelo - top - 8) + '" fill="url(#marmol' + k + ')" stroke="' + t + '" stroke-width="2.5"/>' +
      '<rect x="' + (x + 2) + '" y="' + (top + 9) + '" width="' + (w - 4) + '" height="11" fill="url(#greca' + k + ')"/>' +
      '<line x1="' + x + '" y1="' + (top + 20) + '" x2="' + (x + w) + '" y2="' + (top + 20) + '" stroke="' + t + '" stroke-width="1.5"/>' +
      '<rect x="' + (x - 6) + '" y="' + top + '" width="' + (w + 12) + '" height="9" rx="2" fill="url(#marmol' + k + ')" stroke="' + t + '" stroke-width="2.5"/>' +
      '<text class="ol-num" x="' + cx + '" y="' + b.num[0] + '" text-anchor="middle" style="font-size:' + b.num[1] + 'px">' + SHIBU_ROMANO[p] + "</text>" +
      '<text class="ol-nombre" x="' + cx + '" y="' + b.nom[0] + '" text-anchor="middle" style="font-size:' + b.nom[1] + 'px">' + esc(q ? (q.corona ? "👑 " : "") + shibuCorto(q.nombre, 11).toUpperCase() : "—") + "</text>" +
      (q ? '<text class="ol-pts" x="' + cx + '" y="' + b.pts[0] + '" text-anchor="middle" style="font-size:' + b.pts[1] + 'px">' + q.puntos + " PTS" +
        (q.estrellas != null ? " · ⭐" + q.estrellas : "") + "</text>" : "") +
      (p === 1 && premios[0] ? '<text class="ol-premio" x="' + cx + '" y="388" text-anchor="middle">+' + premios[0] + " AL CERRAR EL MES</text>" : "");
    // La estatua sobre su pedestal
    var pe = b.ped, metal = SHIBU_METAL[p], tw = 64 * b.tai, th = 40 * b.tai, ty = pe[0] - th + 5;
    if (p === 1) s += shibuLaurel(cx, ty + th / 2 - 2, 60, "url(#oro" + k + ")");
    s += shibuPedestal(cx, pe[0], pe[1], pe[2], k);
    if (q) {
      s += '<g class="ol-estatua e' + p + '">' + shibuTaiG(cx - tw / 2, ty, b.tai, metal, k, p === 1) + "</g>";
      if (q.yo) s += '<g class="ol-tu"><rect x="' + (cx - 19) + '" y="' + (ty - 26) + '" width="38" height="18" rx="9" fill="#EA5BA6" stroke="' + t + '" stroke-width="2"/>' +
        '<text x="' + cx + '" y="' + (ty - 13) + '" text-anchor="middle">TÚ</text></g>';
    } else s += '<text class="ol-vacio" x="' + cx + '" y="' + (pe[0] - 8) + '" text-anchor="middle">?</text>';
  });
  if (lugar[1]) s += shibuDestellos([[290, 168, 9], [432, 160, 11], [300, 226, 7], [424, 232, 8], [360, 124, 7]]);
  s += "</svg>";
  // Del 4.º puesto en adelante, en tablillas de mármol
  var resto = r.slice(3), h = '<section class="olimpo-caja" aria-label="Top maid de ' + esc(mes) + '"><h3 class="olimpo-tit">Top maid de ' + esc(mes) + "</h3>" + s;
  if (!r.length) h += '<p class="olimpo-nota">Todavía nadie suma puntos de misiones este mes: la primera se lleva el taiyaki de oro.</p>';
  if (resto.length) h += '<ol class="olimpo-resto">' + resto.map(function (x) {
    return '<li class="' + (x.yo ? "yo" : "") + '"><em>' + x.puesto + ".º</em><b>" + (x.corona ? "👑 " : "") + esc(x.nombre) + (x.yo ? " <small>(tú)</small>" : "") + "</b><span>" + x.puntos + " pts" +
      (x.estrellas != null ? " · ⭐" + x.estrellas : "") + "</span></li>";
  }).join("") + "</ol>";
  var yo = r.filter(function (x) { return x.yo; })[0];
  if (!yo && e.grupo === "meseras") h += '<p class="olimpo-nota">Tú todavía no sumas puntos de misiones este mes.</p>';
  if (e.campeona && e.campeona.nombre) h += '<p class="olimpo-campeona">Top maid de ' + esc(shibuMes(e.campeona.mes)) + ": <b>" + esc(e.campeona.nombre) + "</b></p>";
  h += '<p class="olimpo-nota">Al cerrar el mes, la 1.ª gana +' + premios[0] + ", la 2.ª +" + premios[1] + " y la 3.ª +" + premios[2] +
    " puntos para la tienda. Cuentan los puntos de misiones del mes (no los de los juegos).</p>";
  return h + "</section>";
}
// La estatua sola (para la celebración del premio del mes)
function shibuEstatua(puesto) {
  var k = "e" + (++SHIBU_SVG), metal = SHIBU_METAL[puesto] || "bronce", t = SHIBU_TINTA;
  return '<svg class="olimpo-estatua" viewBox="0 0 320 230" aria-hidden="true">' + shibuDefs(k) + shibuRayos(160, 98, 120, k) +
    shibuLaurel(160, 100, 62, "url(#" + metal + k + ")") + shibuPedestal(160, 130, 86, 92, k) +
    '<text class="ol-num" x="160" y="196" text-anchor="middle" style="font-size:34px">' + (SHIBU_ROMANO[puesto] || puesto) + "</text>" +
    '<g class="ol-estatua e1">' + shibuTaiG(112, 76, 1.5, metal, k, true) + "</g>" +
    shibuDestellos([[88, 70, 9], [236, 64, 11], [100, 128, 7], [226, 126, 8]]) +
    '<line x1="40" y1="222" x2="280" y2="222" stroke="' + t + '" stroke-width="2.5"/></svg>';
}
// El premio del Top maid del mes pasado: se celebra una sola vez y los puntos vuelan a la chapita
function shibuTopPremio() {
  var e = SHIBU.est, p = shibuTopPendiente(e); if (!p) return;
  SHIBU.avisos = SHIBU.avisos.filter(function (a) { return a.com; }); var avisos = $("shibuAvisos"); if (avisos) avisos.innerHTML = "";
  var mes = shibuMes(p.mes), frase = shibuFrase("top_maid"), confeti = "";
  if (!shibuQuieto()) for (var i = 0; i < 18; i++) confeti += '<i style="left:' + (5 + i * 5.2).toFixed(1) + "%;animation-delay:" + (i % 6 * 0.12).toFixed(2) + 's"></i>';
  $("shibuBody").innerHTML = '<div class="shibu-confeti" aria-hidden="true">' + confeti + "</div>" + shibuEstatua(p.puesto) +
    (frase ? '<div class="shibu-top">' + shibuPose("top_maid", "salta") + '<div class="shibu-dice"><div class="shibu-nom"><b>Shibu</b> <small>el jefe</small></div><p class="shibu-globo" id="shibuTxt"></p></div></div>' : "") +
    '<div class="shibu-fiesta"><div class="fiesta-titulo">' + (p.puesto === 1 ? "¡Fuiste la Top maid de " + esc(mes) + "!" : "¡" + p.puesto + ".º lugar del Top maid de " + esc(mes) + "!") + "</div>" +
    '<div class="fiesta-mis">Tu premio por el mes</div>' +
    '<div class="fiesta-premio"><i class="fiesta-moneda" aria-hidden="true"></i><b>+' + p.puntos + "</b> puntos para la tienda</div></div>";
  $("shibuOk").textContent = "¡Gracias!";
  var d = $("shibuDlg");
  d.dataset.modo = "top"; d.dataset.top = p.id; d.dataset.pts = p.puntos;
  d.showModal();
  if (frase) shibuEscribe($("shibuTxt"), frase);
}

// ---- Pestaña «Maids» (junto a Tokio y Edo): cada maid ve su día con Shibu y atajos a Mi perfil, sus ventas, la expendedora y «Jugar»
// Si la pestaña «Maids» está a la vista, se redibuja con lo último
function shibuTabRedibuja() {
  if (U && cur.area === "Maids" && !$("tablesView").classList.contains("hidden")) shibuTabMaids($("areaBody"));
}
function shibuTabVisible() { return !!(U && SHIBU.est && SHIBU.est.juega); }
function shibuTabCount() { return 0; }
// Cuando llega su estado, la pestaña aparece (si todavía no estaba)
function shibuBadge() {
  if (!U || $("tablesView").classList.contains("hidden")) return;
  if (!document.querySelector('#areas [data-area="Maids"]') && shibuTabVisible() && typeof drawTables === "function") drawTables();
}
function shibuTabMaids(box) {
  var e = SHIBU.est, juega = !!(e && e.juega), html = "";
  if (juega) {
    var m = e.misiones || [], hechas = m.filter(function (x) { return x.hecha; }).length;
    html += '<div class="card maids-dia"><div class="perfil-top">' + shibuCara("media") + '<div class="perfil-quien"><b>Tu día con Shibu</b><div class="perfil-saldos">' +
      "<span>★ " + hechas + " de " + m.length + ' misiones</span><span class="pts"><b>' + (e.puntos || 0) + "</b> puntos</span><span><b>" + (e.fichas || 0) + "</b> fichas</span></div></div></div>" +
      '<div class="row" style="margin-top:10px"><button type="button" class="primary" id="maidsPerfil">Mi perfil</button>' +
      '<button type="button" id="maidsVentas">Mis ventas</button><button type="button" id="maidsTienda">Expendedora</button>' +
      (typeof abrirJuegos === "function" && (e.juegos || {}).activo !== false ? '<button type="button" id="maidsJugar">Jugar</button>' : "") + "</div></div>";
  }
  box.innerHTML = '<div class="maids-tab">' + (html || '<p class="muted">Aquí salen las misiones de Shibu.</p>') + "</div>";
}
document.addEventListener("click", function (ev) {
  if (ev.target.closest("#maidsPerfil")) shibuPerfil("hoy");
  else if (ev.target.closest("#maidsVentas")) shibuPerfil("ventas");
  else if (ev.target.closest("#maidsJugar") && typeof abrirJuegos === "function") abrirJuegos();
  else if (ev.target.closest("#maidsTienda")) shibuPerfil("tienda");
});
