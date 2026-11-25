// ---------------------------------------------------------------- Misiones de Shibu (pedido de Edgar, 24/11)
// Shibu, el jefe, recibe a la maid la primera vez del día con sus 3 misiones y celebra cada misión cumplida.
// «Mi perfil» muestra sus puntos y fichas, la tienda de premios y el botón «Jugar». En la tienda la maid compra con sus
// puntos y el premio sale a cocina de una vez (queda en el cierre de caja).
// Todo lo decide la base (mis_estado, tienda_canjear): la tablet solo muestra. Las frases salen de data/shibu.json.
// Mejoras que eligió Edgar: el sello de Shibu cae sobre la misión cumplida, los puntos vuelan a la chapita de arriba,
// un aviso chico cuando avanza una misión y la tienda con la foto del plato («mantén presionado para comprar»).
// En Mi perfil, el «Top maid» del mes: el ranking de puntos de las meseras, con taiyakis de oro, plata y bronce.
var SHIBU = { frases: null, est: null, timer: null, vistos: {}, desde: {}, chipPts: null, retener: false, avisos: [], avisosT: 0,
  pronto: 0, rectFiesta: null, premioAntes: null };
var NIVEL_TXT = { 0: "Extra del día", 1: "Fácil", 2: "Media", 3: "Difícil" };
var MIS_PLATA = ["ventas", "promedio", "primera", "vs_ayer", "vs_semana", "top_ventas", "equipo_meta"];
var SHIBU_REVISA_MS = 30000, SHIBU_MANTENER_MS = 1200;

function shibuQuieto() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
function shibuFrases() {
  if (SHIBU.frases) return Promise.resolve(SHIBU.frases);
  return fetch("data/shibu.json", { cache: "no-cache" }).then(function (r) { return r.json(); })
    .then(function (j) { SHIBU.frases = j || {}; return SHIBU.frases; }).catch(function () { SHIBU.frases = {}; return SHIBU.frases; });
}
function shibuFrase(tipo) {
  var l = (SHIBU.frases && SHIBU.frases[tipo]) || [];
  return l.length ? l[Math.floor(Math.random() * l.length)] : "";
}
// La cara de Shibu: su PNG cuando esté (data/shibu.json → "imagen"); mientras, un círculo naranja con su nombre
function shibuCara(cls) {
  var img = SHIBU.frases && SHIBU.frases.imagen;
  return '<span class="shibu-cara ' + (cls || "") + '">' + (img ? '<img src="' + esc(img) + '" alt="Shibu">' : "<b>Shibu</b>") + "</span>";
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
  SHIBU.avisos = []; SHIBU.rectFiesta = null; SHIBU.premioAntes = null;
  show("btnShibu", false);
  var box = $("shibuAvisos"); if (box) box.innerHTML = "";
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
  var quien = U.id;
  return rpc("mis_estado").then(function (e) {
    if (!U || U.id !== quien) return;
    SHIBU.est = e;
    if (e && e.juega) {
      var nuevos = e.nuevos || [];
      // Los puntos nuevos no se suman de golpe: llegan volando a la chapita cuando se cierra la celebración
      if (SHIBU.chipPts == null) SHIBU.chipPts = (e.puntos || 0) - nuevos.reduce(function (s, x) { return s + (x.puntos || 0); }, 0);
      if (nuevos.length) SHIBU.retener = true;
      nuevos.forEach(function (n) {
        if (SHIBU.desde[n.id] != null) return;
        var v = SHIBU.vistos[e.fecha + "|" + n.nivel];
        SHIBU.desde[n.id] = v && v.pct < 100 ? v.pct : 60;
      });
      if (!alEntrar) shibuAvanzo(e);
      shibuRecuerda(e);
    }
    shibuChip(); shibuBadge();
    if (!e || !e.juega) return;
    if (alEntrar && !e.saludo_hoy) shibuCuandoLibre(shibuBienvenida);
    else if ((e.nuevos || []).length) shibuCuandoLibre(shibuCelebra);
    if ($("perfilDlg").open) shibuPerfilDibuja();
    shibuTabRedibuja();
  }).catch(function () {});
}
// Espera a que se cierren los avisos u otra ventana antes de mostrar a Shibu
function shibuCuandoLibre(fn) {
  var n = 0;
  (function intenta() {
    if (!U) return;
    if (!shibuDialogoAbierto()) { fn(); return; }
    if (++n < 80) setTimeout(intenta, 1500);
  })();
}

// ---- Chapita de arriba: «★ 1/3 · 12 pts»; al tocarla abre Mi perfil
function shibuChip() {
  var e = SHIBU.est, ok = !!(e && e.juega);
  show("btnShibu", ok);
  if (!ok) return;
  var m = e.misiones || [], hechas = m.filter(function (x) { return x.hecha; }).length;
  var pts = SHIBU.retener && SHIBU.chipPts != null ? SHIBU.chipPts : (e.puntos || 0);
  if (!SHIBU.retener) SHIBU.chipPts = pts;
  $("btnShibu").innerHTML = shibuCara("mini") + "<b>★ " + hechas + "/" + m.length + '</b><small><span class="chip-pts">' + pts + "</span> pts</small>";
}
$("btnShibu").addEventListener("click", function () { shibuPerfil(); });
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
  var chip = $("btnShibu"), e = SHIBU.est;
  var hasta = e ? e.puntos || 0 : 0, desde = SHIBU.chipPts == null ? hasta : SHIBU.chipPts;
  function suma() { SHIBU.retener = false; SHIBU.chipPts = hasta; shibuChip(); shibuCuentaEn(chip.querySelector(".chip-pts"), desde, hasta); }
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
function shibuClave(x) { return x.extra ? 0 : x.nivel; }
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
    if (Date.now() - a.at < 120000) shibuAvisoPinta(box, a);
  }
}
function shibuAvisoPinta(box, a) {
  var x = a.x, el = document.createElement("button");
  el.type = "button"; el.className = "shibu-aviso n" + shibuClave(x);
  el.innerHTML = shibuCara("mini") + '<span class="sa-txt"><span class="sa-nivel">' + (x.extra ? "＋" : "★".repeat(x.nivel)) + " Avanzaste</span><b>" + esc(x.texto) +
    '</b><span class="sa-barra"><i style="width:' + (shibuQuieto() ? shibuPct(x) : a.desde) + '%" data-pct="' + shibuPct(x) + '"></i></span><small>' + esc(shibuAvance(x)) + "</small></span>";
  box.appendChild(el);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  shibuLlena(el);
  el.addEventListener("click", function () { el.remove(); shibuPerfil(); });
  setTimeout(function () { el.classList.add("sale"); setTimeout(function () { el.remove(); }, 400); }, 5200);
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
    return '<div class="mis-card n' + shibuClave(x) + (x.hecha ? " hecha" : "") + (cae ? " fiesta" : "") +
      '" style="animation-delay:' + (cae ? d + 0.28 : i * 0.18).toFixed(2) + 's">' +
      '<div class="mis-nivel"><span>' + (x.extra ? "＋" : "★".repeat(x.nivel)) + "</span> " + esc(NIVEL_TXT[shibuClave(x)] || "") + " · " + x.puntos + " punto" + (x.puntos === 1 ? "" : "s") +
      (x.equipo ? ' <em class="mis-eq">Equipo</em>' : "") + "</div>" +
      '<div class="mis-texto">' + esc(x.texto) + "</div>" +
      '<div class="mis-barra"><i style="width:' + desde + '%" data-pct="' + pct + '"></i></div><div class="mis-avance">' + esc(shibuAvance(x)) + "</div>" +
      (x.hecha ? shibuSello(cae, d) : "") + "</div>";
  }).join("") + "</div>";
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
  var e = SHIBU.est; if (!e) return;
  var fuerte = e.tipo_dia === "fuertes" && Math.random() < 0.5;
  var frase = shibuFrase(fuerte ? "manana_fuerte" : "manana") || shibuFrase("manana");
  $("shibuBody").innerHTML = '<div class="shibu-top">' + shibuCara("grande entra") + '<div class="shibu-dice"><div class="shibu-nom"><b>Shibu</b> <small>el jefe · vigilando</small></div>' +
    '<p class="shibu-globo" id="shibuTxt"></p></div></div>' +
    "<h3>Tus misiones de hoy, " + esc(String(e.nombre || U.name).split(" ")[0]) + "</h3>" +
    shibuTarjetas(e.misiones || [], { desde: function () { return 0; } }) +
    '<p class="muted shibu-pie">Cada misión da sus puntos para la tienda y 1 ficha para jugar.</p>';
  $("shibuOk").textContent = "¡A trabajar!";
  $("shibuDlg").dataset.modo = "saludo";
  $("shibuDlg").showModal();
  shibuLlena($("shibuBody"));
  shibuEscribe($("shibuTxt"), frase);
}
// ---- Celebración (una o varias misiones recién cumplidas): la barra se llena, cae el sello y aparece el premio
function shibuCelebra() {
  var e = SHIBU.est; if (!e || !(e.nuevos || []).length) return;
  var nuevos = e.nuevos, pts = nuevos.reduce(function (s, x) { return s + (x.puntos || 0); }, 0);
  // Los avisos de avance que quedaban ya no hacen falta: ahora celebra
  SHIBU.avisos = []; var avisos = $("shibuAvisos"); if (avisos) avisos.innerHTML = "";
  // «Las tres»: el día completo son las 3 del día (fácil, media y difícil); la extra suma aparte
  var regulares = (e.misiones || []).filter(function (x) { return !x.extra; });
  var todas = nuevos.some(function (x) { return x.nivel > 0; }) && regulares.length > 0 && regulares.every(function (x) { return x.hecha; });
  var lista = nuevos.map(function (n) {
    var x = (e.misiones || []).find(function (m) { return shibuClave(m) === n.nivel && m.texto === n.texto; });
    return Object.assign(x ? Object.assign({}, x) : { nivel: n.nivel, extra: n.nivel === 0, texto: n.texto, puntos: n.puntos, tipo: "", actual: 1, meta: 1 }, { hecha: true, _id: n.id });
  });
  var quieto = shibuQuieto(), sello0 = quieto ? 0 : 0.95, tPremio = quieto ? 0 : sello0 + (lista.length - 1) * 0.45 + 0.55;
  var confeti = "";
  if (!quieto) for (var i = 0; i < 18; i++) confeti += '<i style="left:' + (5 + i * 5.2).toFixed(1) + "%;animation-delay:" + (i % 6 * 0.12).toFixed(2) + 's"></i>';
  $("shibuBody").innerHTML = '<div class="shibu-confeti" aria-hidden="true">' + confeti + "</div>" +
    '<div class="shibu-top">' + shibuCara("grande salta") + '<div class="shibu-dice"><div class="shibu-nom"><b>Shibu</b> <small>el jefe</small></div><p class="shibu-globo" id="shibuTxt"></p></div></div>' +
    '<div class="shibu-fiesta"><div class="fiesta-titulo">' + (todas ? "¡Las 3 misiones de hoy!" : nuevos.length > 1 ? "¡Misiones cumplidas!" : "¡Misión cumplida!") + "</div>" +
    shibuTarjetas(lista, { sellar: true, sello0: sello0, desde: function (x) { var d = SHIBU.desde[x._id]; return d == null ? 60 : d; } }) +
    '<div class="fiesta-premio" style="animation-delay:' + tPremio.toFixed(2) + 's"><i class="fiesta-moneda" aria-hidden="true"></i><b>+' + pts + "</b> punto" + (pts === 1 ? "" : "s") +
    " · <b>+" + nuevos.length + "</b> ficha" + (nuevos.length === 1 ? "" : "s") + "</div></div>";
  $("shibuOk").textContent = "Seguir";
  var d = $("shibuDlg");
  d.dataset.modo = "fiesta";
  d.dataset.ids = nuevos.map(function (x) { return x.id; }).join(",");
  d.dataset.pts = pts; d.dataset.fichas = nuevos.length;
  d.showModal();
  shibuLlena($("shibuBody"));
  shibuEscribe($("shibuTxt"), shibuFrase(todas ? "dia_completo" : "mision"));
}
// Dónde estaba el premio de la celebración: de ahí salen volando las monedas
function shibuGuardaPremio() { var p = $("shibuBody").querySelector(".fiesta-premio"); if (p) SHIBU.rectFiesta = p.getBoundingClientRect(); }
$("shibuOk").addEventListener("click", function () { shibuGuardaPremio(); $("shibuDlg").close(); });
$("shibuDlg").addEventListener("cancel", shibuGuardaPremio);
$("shibuDlg").addEventListener("close", function () {
  var d = $("shibuDlg"), modo = d.dataset.modo; d.dataset.modo = "";
  if (!U) return;
  if (modo === "saludo") {
    rpc("mis_marcar", { p_saludo: true, p_logros: null }).catch(function () {});
    if (SHIBU.est) { SHIBU.est.saludo_hoy = true; if ((SHIBU.est.nuevos || []).length) shibuCuandoLibre(shibuCelebra); }
  } else if (modo === "fiesta") {
    var ids = (d.dataset.ids || "").split(",").filter(Boolean).map(Number);
    rpc("mis_marcar", { p_saludo: false, p_logros: ids }).catch(function () {});
    if (SHIBU.est) SHIBU.est.nuevos = [];
    var r = SHIBU.rectFiesta || { left: innerWidth / 2 - 60, top: innerHeight / 2 - 20, width: 120, height: 40 };
    SHIBU.rectFiesta = null;
    shibuVuela(r, Number(d.dataset.pts) || 0, Number(d.dataset.fichas) || 0);
  } else if (modo === "premio" && SHIBU.premioAntes != null) {
    // De vuelta en el perfil, los puntos bajan contando
    shibuCuentaEn(document.querySelector("#perfilBody .perfil-saldos .pts b"), SHIBU.premioAntes, (SHIBU.est && SHIBU.est.puntos) || 0);
    SHIBU.premioAntes = null;
  }
  shibuAvisosSigue();
});

// ---- Mi perfil: puntos, fichas, misiones, tienda y Jugar
function shibuPerfil() {
  if (!SHIBU.est || !SHIBU.est.juega) return;
  shibuPerfilDibuja(); $("perfilDlg").showModal();
  rpc("mis_estado").then(function (e) { SHIBU.est = e; shibuChip(); if ($("perfilDlg").open) shibuPerfilDibuja(); }).catch(function () {});
}
// La foto del premio es la del plato del menú (si el premio tiene plato y el plato tiene foto)
function shibuFoto(t) {
  var d = t && t.dish_id && typeof MENU !== "undefined" ? (MENU.dishes || []).find(function (x) { return x.id === t.dish_id; }) : null, u = d && d.photo_url;
  return u && /^(assets\/|data:image\/|https:\/\/)/.test(u) ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '<span class="premio-sin-foto" aria-hidden="true">★</span>';
}
function shibuPerfilDibuja() {
  var e = SHIBU.est; if (!e) return;
  var pts = e.puntos || 0, est = { entregado: "A cocina", pendiente: "Esperando", rechazado: "No salió" };
  var juegos = e.juegos || {}, hayJuegos = typeof abrirJuegos === "function" && juegos.activo !== false;
  $("perfilBody").innerHTML =
    '<div class="perfil-top">' + shibuCara("media") + '<div class="perfil-quien"><b>' + esc(e.nombre || U.name) + '</b><div class="perfil-saldos">' +
      '<span class="pts"><b>' + pts + "</b> punto" + (pts === 1 ? "" : "s") + '</span><span class="fch"><b>' + (e.fichas || 0) + "</b> ficha" + (e.fichas === 1 ? "" : "s") + "</span></div></div>" +
      (hayJuegos ? '<button type="button" class="primary" id="perfilJugar">Jugar</button>' : "") + "</div>" +
    "<h3>Misiones de hoy</h3>" + shibuTarjetas(e.misiones || []) + shibuTop(e) +
    "<h3>Tienda de premios</h3>" + ((e.tienda || []).length ? '<div class="tienda-list">' + e.tienda.map(function (t) {
      var alcanza = pts >= t.puntos;
      return '<div class="premio-card' + (alcanza ? " alcanza" : "") + '"><div class="premio-foto">' + shibuFoto(t) + "</div><b>" + esc(t.nombre) + '</b><span class="premio-pts">' + t.puntos + " puntos</span>" +
        (alcanza ? '<button type="button" class="primary premio-mantener" data-canje="' + t.id + '"><span class="pm-lleno" aria-hidden="true"></span><span class="pm-txt">Mantén para comprar</span></button>'
          : '<button type="button" data-canje="' + t.id + '" disabled>Te faltan ' + (t.puntos - pts) + "</button>") + "</div>";
    }).join("") + "</div>" : '<p class="muted">La tienda está vacía por ahora.</p>') +
    ((e.canjes || []).length ? "<h3>Mis premios</h3>" + e.canjes.map(function (c) {
      return '<div class="canje-row ' + c.estado + '"><span>' + esc(c.nombre) + " · " + c.puntos + ' pts</span><b>' + esc(est[c.estado] || c.estado) + "</b></div>";
    }).join("") : "");
  if (hayJuegos) $("perfilJugar").addEventListener("click", function () { $("perfilDlg").close(); abrirJuegos(); });
}
$("perfilClose").addEventListener("click", function () { $("perfilDlg").close(); });
// ---- Top maid del mes: las meseras por los puntos que ganaron con misiones en el mes (lo calcula la base: mis_ranking)
var SHIBU_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
var SHIBU_METAL = { 1: "oro", 2: "plata", 3: "bronce" };
// Un taiyaki (el pescadito dulce de la carta) como medalla: de oro, de plata o de bronce
function shibuTaiyaki(metal, cls) {
  return '<svg class="taiyaki ' + metal + (cls ? " " + cls : "") + '" viewBox="0 0 64 40" role="img" aria-label="Taiyaki de ' + metal + '">' +
    '<path class="t-cola" d="M50 15 L62 7 C59.5 14 59.5 26 62 33 L50 25 Z"/>' +
    '<path class="t-cuerpo" d="M5 20 C5 10 15 4.5 29 4.5 C39 4.5 46 9 51 15 L51 25 C46 31 39 35.5 29 35.5 C15 35.5 5 30 5 20 Z"/>' +
    '<path class="t-esc" d="M26 13 a4 4 0 0 0 8 0 M34 13 a4 4 0 0 0 8 0 M22 20.5 a4 4 0 0 0 8 0 M30 20.5 a4 4 0 0 0 8 0 M38 20.5 a4 4 0 0 0 8 0 M26 28 a4 4 0 0 0 8 0 M34 28 a4 4 0 0 0 8 0"/>' +
    '<path class="t-agalla" d="M19 11 C22.5 15.5 22.5 24.5 19 29"/>' +
    '<path class="t-brillo" d="M11 11.5 C16 7.8 23 6.8 30 7.2"/>' +
    '<circle class="t-ojo" cx="12.5" cy="17" r="2.6"/></svg>';
}
function shibuTop(e) {
  var r = e.ranking;
  if (!r) return "";   // una base que todavía no manda el ranking
  var mes = SHIBU_MESES[Number(String(e.fecha || "").slice(5, 7)) - 1] || "este mes";
  var h = '<h3 class="top-tit">Top maid de ' + esc(mes) + "</h3>";
  if (!r.length) return h + '<p class="muted top-nota">Todavía nadie suma puntos de misiones este mes: la primera se lleva el taiyaki de oro.</p>';
  function nombre(x) { return esc(x.nombre) + (x.yo ? " <small>(tú)</small>" : ""); }
  // El podio: la 2.ª a la izquierda, la 1.ª al centro y la 3.ª a la derecha
  var top = r.slice(0, 3), podio = [top[1], top[0], top[2]].filter(Boolean);
  h += '<div class="top-podio">' + podio.map(function (x) {
    return '<div class="top-lugar p' + x.puesto + (x.yo ? " yo" : "") + '">' + (x.puesto === 1 ? '<span class="top-cinta">Top 1 del mes</span>' : "") +
      shibuTaiyaki(SHIBU_METAL[x.puesto] || "bronce", x.puesto === 1 ? "grande" : "") +
      '<b>' + nombre(x) + '</b><span class="top-pts">' + x.puntos + " pts</span><em>" + x.puesto + ".º</em></div>";
  }).join("") + "</div>";
  var resto = r.slice(3);
  if (resto.length) h += '<ol class="top-resto">' + resto.map(function (x) {
    return '<li class="' + (x.yo ? "yo" : "") + '"><em>' + x.puesto + ".º</em><b>" + nombre(x) + '</b><span class="top-pts">' + x.puntos + " pts</span></li>";
  }).join("") + "</ol>";
  var yo = r.filter(function (x) { return x.yo; })[0];
  if (!yo && e.grupo === "meseras") h += '<p class="muted top-nota">Tú todavía no sumas puntos de misiones este mes.</p>';
  return h + '<p class="muted top-nota">Cuentan los puntos ganados con misiones en el mes (no los de los juegos).</p>';
}
// Comprar no tiene vuelta atrás (el premio sale a cocina de una vez): se mantiene presionado hasta que el botón se llena
function shibuMantener(b) {
  if (!b || b._t || b.disabled) return;
  b.classList.add("cargando");
  b._t = setTimeout(function () { b._t = 0; b.classList.remove("cargando"); shibuComprar(b); }, SHIBU_MANTENER_MS);
}
function shibuSuelta(b, avisar) {
  if (!b || !b._t) return;
  clearTimeout(b._t); b._t = 0; b.classList.remove("cargando");
  if (!avisar) return;
  var txt = b.querySelector(".pm-txt");
  txt.textContent = "Mantén hasta que se llene";
  clearTimeout(b._h); b._h = setTimeout(function () { txt.textContent = "Mantén para comprar"; }, 2200);
}
function shibuComprar(b) {
  var t = (SHIBU.est.tienda || []).find(function (x) { return String(x.id) === b.dataset.canje; }); if (!t) return;
  b.disabled = true;
  var antes = SHIBU.est.puntos || 0;
  rpc("tienda_canjear", { p_item: t.id }).then(function () {
    SHIBU.premioAntes = antes;
    shibuPremio(t);
    return rpc("mis_estado").then(function (e) { SHIBU.est = e; shibuChip(); shibuPerfilDibuja(); shibuTabRedibuja(); });
  }).catch(function (err) { b.disabled = false; fail(err); });
}
$("perfilBody").addEventListener("pointerdown", function (ev) {
  var b = ev.target.closest(".premio-mantener"); if (!b) return;
  ev.preventDefault();
  try { b.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura igual funciona */ }
  shibuMantener(b);
});
$("perfilBody").addEventListener("pointerup", function (ev) { shibuSuelta(ev.target.closest(".premio-mantener"), true); });
$("perfilBody").addEventListener("pointercancel", function (ev) { shibuSuelta(ev.target.closest(".premio-mantener"), false); });
$("perfilBody").addEventListener("keydown", function (ev) {
  var b = ev.target.closest(".premio-mantener");
  if (b && (ev.key === " " || ev.key === "Enter")) { ev.preventDefault(); if (!ev.repeat) shibuMantener(b); }
});
$("perfilBody").addEventListener("keyup", function (ev) {
  var b = ev.target.closest(".premio-mantener");
  if (b && (ev.key === " " || ev.key === "Enter")) shibuSuelta(b, true);
});
$("perfilBody").addEventListener("contextmenu", function (ev) { if (ev.target.closest(".premio-mantener")) ev.preventDefault(); });
// Premio comprado: Shibu lo entrega con una frase suya (la comanda ya salió a cocina)
function shibuPremio(t) {
  $("shibuBody").innerHTML = '<div class="shibu-top">' + shibuCara("grande salta") + '<div class="shibu-dice"><div class="shibu-nom"><b>Shibu</b> <small>el jefe</small></div>' +
    '<p class="shibu-globo" id="shibuTxt"></p></div></div>' +
    '<div class="shibu-fiesta"><div class="fiesta-titulo">¡Premio comprado!</div><div class="premio-entrega">' + shibuFoto(t) + '</div><div class="fiesta-mis">' + esc(t.nombre) + " va a cocina</div>" +
    '<div class="fiesta-premio"><b>−' + t.puntos + "</b> puntos</div></div>";
  $("shibuOk").textContent = "Listo";
  $("shibuDlg").dataset.modo = "premio";
  $("shibuDlg").showModal();
  shibuEscribe($("shibuTxt"), shibuFrase("canje_aprobado") || "Tu premio va a cocina.");
}

// ---- Pestaña «Maids» (junto a Tokio y Edo): cada maid ve su día con Shibu, su perfil con la tienda y «Jugar»
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
      '<div class="row" style="margin-top:10px"><button type="button" class="primary" id="maidsPerfil">Mi perfil y tienda</button>' +
      (typeof abrirJuegos === "function" && (e.juegos || {}).activo !== false ? '<button type="button" id="maidsJugar">Jugar</button>' : "") + "</div></div>";
  }
  box.innerHTML = '<div class="maids-tab">' + (html || '<p class="muted">Aquí salen las misiones de Shibu.</p>') + "</div>";
}
document.addEventListener("click", function (ev) {
  if (ev.target.closest("#maidsPerfil")) shibuPerfil();
  else if (ev.target.closest("#maidsJugar") && typeof abrirJuegos === "function") abrirJuegos();
});
