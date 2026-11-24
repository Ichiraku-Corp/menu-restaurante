// ---------------------------------------------------------------- Misiones de Shibu (pedido de Edgar, 24/11)
// Shibu, el jefe, recibe a la maid la primera vez del día con sus 3 misiones y celebra cada misión cumplida.
// «Mi perfil» muestra sus puntos y fichas, la tienda de premios y el botón «Jugar». La caja aprueba los premios.
// Todo lo decide la base (mis_estado, tienda_*): la tablet solo muestra. Las frases salen de data/shibu.json.
var SHIBU = { frases: null, est: null, timer: null, pend: 0 };
var NIVEL_TXT = { 1: "Fácil", 2: "Media", 3: "Difícil" };
var MIS_PLATA = ["ventas", "promedio", "primera", "vs_ayer", "vs_semana", "top_ventas", "equipo_meta"];

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
  SHIBU.timer = setInterval(function () { shibuPoll(false); }, 45000);
}
function shibuSalir() {
  clearInterval(SHIBU.timer); SHIBU.timer = null; SHIBU.est = null; SHIBU.pend = 0;
  show("btnShibu", false);
  ["shibuDlg", "perfilDlg"].forEach(function (id) { var d = $(id); if (d && d.open) d.close(); });
}
// Revisa misiones (y premios por aprobar si cobra). Al entrar, la bienvenida sale una vez al día.
function shibuPoll(alEntrar) {
  if (!U || (typeof SR !== "undefined" && SR.on)) return Promise.resolve();
  var quien = U.id;
  return rpc("mis_estado").then(function (e) {
    if (!U || U.id !== quien) return;
    SHIBU.est = e;
    shibuChip();
    if (!e || !e.juega) return;
    if (alEntrar && !e.saludo_hoy) shibuCuandoLibre(shibuBienvenida);
    else if ((e.nuevos || []).length) shibuCuandoLibre(shibuCelebra);
    if ($("perfilDlg").open) shibuPerfilDibuja();
  }).catch(function () {}).then(function () { if (U && U.charge) shibuPendientes(); });
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
  $("btnShibu").innerHTML = shibuCara("mini") + "<b>★ " + hechas + "/" + m.length + "</b><small>" + (e.puntos || 0) + " pts</small>";
}
$("btnShibu").addEventListener("click", function () { shibuPerfil(); });

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
function shibuTarjetas(lista) {
  if (!lista.length) return '<p class="muted">Hoy Shibu no dejó misiones.</p>';
  return '<div class="mis-list">' + lista.map(function (x, i) {
    var a = Number(x.actual) || 0, m = Number(x.meta) || 1, pct = x.hecha ? 100 : Math.max(0, Math.min(100, Math.round(a / m * 100)));
    if (x.al_cierre && !x.hecha) pct = 0;
    return '<div class="mis-card n' + x.nivel + (x.hecha ? " hecha" : "") + '" style="animation-delay:' + (i * 0.18).toFixed(2) + 's">' +
      '<div class="mis-nivel"><span>' + "★".repeat(x.nivel) + "</span> " + esc(NIVEL_TXT[x.nivel] || "") + " · " + x.puntos + " punto" + (x.puntos === 1 ? "" : "s") +
      (x.equipo ? ' <em class="mis-eq">Equipo</em>' : "") + "</div>" +
      '<div class="mis-texto">' + esc(x.texto) + "</div>" +
      '<div class="mis-barra"><i style="width:' + pct + '%"></i></div><div class="mis-avance">' + esc(shibuAvance(x)) + "</div></div>";
  }).join("") + "</div>";
}

// ---- Bienvenida (primera vez del día)
function shibuBienvenida() {
  var e = SHIBU.est; if (!e) return;
  var fuerte = e.tipo_dia === "fuertes" && Math.random() < 0.5;
  var frase = shibuFrase(fuerte ? "manana_fuerte" : "manana") || shibuFrase("manana");
  $("shibuBody").innerHTML = '<div class="shibu-top">' + shibuCara("grande entra") + '<div class="shibu-dice"><div class="shibu-nom"><b>Shibu</b> <small>el jefe · vigilando</small></div>' +
    '<p class="shibu-globo" id="shibuTxt"></p></div></div>' +
    "<h3>Tus misiones de hoy, " + esc(String(e.nombre || U.name).split(" ")[0]) + "</h3>" + shibuTarjetas(e.misiones || []) +
    '<p class="muted shibu-pie">Cada misión da sus puntos para la tienda y 1 ficha para jugar.</p>';
  $("shibuOk").textContent = "¡A trabajar!";
  $("shibuDlg").dataset.modo = "saludo";
  $("shibuDlg").showModal();
  shibuEscribe($("shibuTxt"), frase);
}
// ---- Celebración (una o varias misiones recién cumplidas)
function shibuCelebra() {
  var e = SHIBU.est; if (!e || !(e.nuevos || []).length) return;
  var nuevos = e.nuevos, pts = nuevos.reduce(function (s, x) { return s + (x.puntos || 0); }, 0);
  var todas = (e.misiones || []).length > 0 && (e.misiones || []).every(function (x) { return x.hecha; });
  var confeti = "";
  if (!shibuQuieto()) for (var i = 0; i < 18; i++) confeti += '<i style="left:' + (5 + i * 5.2).toFixed(1) + "%;animation-delay:" + (i % 6 * 0.12).toFixed(2) + 's"></i>';
  $("shibuBody").innerHTML = '<div class="shibu-confeti" aria-hidden="true">' + confeti + "</div>" +
    '<div class="shibu-top">' + shibuCara("grande salta") + '<div class="shibu-dice"><div class="shibu-nom"><b>Shibu</b> <small>el jefe</small></div><p class="shibu-globo" id="shibuTxt"></p></div></div>' +
    '<div class="shibu-fiesta"><div class="fiesta-titulo">' + (todas ? "¡Las 3 misiones de hoy!" : nuevos.length > 1 ? "¡Misiones cumplidas!" : "¡Misión cumplida!") + "</div>" +
    nuevos.map(function (x) { return '<div class="fiesta-mis">✓ ' + esc(x.texto) + "</div>"; }).join("") +
    '<div class="fiesta-premio"><b>+' + pts + "</b> punto" + (pts === 1 ? "" : "s") + " · <b>+" + nuevos.length + "</b> ficha" + (nuevos.length === 1 ? "" : "s") + "</div></div>";
  $("shibuOk").textContent = "Seguir";
  $("shibuDlg").dataset.modo = "fiesta";
  $("shibuDlg").dataset.ids = nuevos.map(function (x) { return x.id; }).join(",");
  $("shibuDlg").showModal();
  shibuEscribe($("shibuTxt"), shibuFrase(todas ? "dia_completo" : "mision"));
}
$("shibuOk").addEventListener("click", function () { $("shibuDlg").close(); });
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
  }
});

// ---- Mi perfil: puntos, fichas, misiones, tienda y Jugar
function shibuPerfil() {
  if (!SHIBU.est || !SHIBU.est.juega) return;
  shibuPerfilDibuja(); $("perfilDlg").showModal();
  rpc("mis_estado").then(function (e) { SHIBU.est = e; shibuChip(); if ($("perfilDlg").open) shibuPerfilDibuja(); }).catch(function () {});
}
function shibuPerfilDibuja() {
  var e = SHIBU.est; if (!e) return;
  var pts = e.puntos || 0, est = { pendiente: "Esperando a la cajera", entregado: "Entregado", rechazado: "No salió" };
  var juegos = e.juegos || {}, hayJuegos = typeof abrirJuegos === "function" && juegos.activo !== false;
  $("perfilBody").innerHTML =
    '<div class="perfil-top">' + shibuCara("media") + '<div class="perfil-quien"><b>' + esc(e.nombre || U.name) + '</b><div class="perfil-saldos">' +
      '<span class="pts"><b>' + pts + "</b> punto" + (pts === 1 ? "" : "s") + '</span><span class="fch"><b>' + (e.fichas || 0) + "</b> ficha" + (e.fichas === 1 ? "" : "s") + "</span></div></div>" +
      (hayJuegos ? '<button type="button" class="primary" id="perfilJugar">Jugar</button>' : "") + "</div>" +
    "<h3>Misiones de hoy</h3>" + shibuTarjetas(e.misiones || []) +
    "<h3>Tienda de premios</h3>" + ((e.tienda || []).length ? '<div class="tienda-list">' + e.tienda.map(function (t) {
      var alcanza = pts >= t.puntos;
      return '<div class="premio-card' + (alcanza ? " alcanza" : "") + '"><b>' + esc(t.nombre) + '</b><span class="premio-pts">' + t.puntos + " puntos</span>" +
        '<button type="button" data-canje="' + t.id + '"' + (alcanza ? "" : " disabled") + ">" + (alcanza ? "Canjear" : "Te faltan " + (t.puntos - pts)) + "</button></div>";
    }).join("") + "</div>" : '<p class="muted">La tienda está vacía por ahora.</p>') +
    ((e.canjes || []).length ? "<h3>Mis premios</h3>" + e.canjes.map(function (c) {
      return '<div class="canje-row ' + c.estado + '"><span>' + esc(c.nombre) + " · " + c.puntos + ' pts</span><b>' + esc(est[c.estado] || c.estado) + "</b></div>";
    }).join("") : "");
  if (hayJuegos) $("perfilJugar").addEventListener("click", function () { $("perfilDlg").close(); abrirJuegos(); });
}
$("perfilClose").addEventListener("click", function () { $("perfilDlg").close(); });
$("perfilBody").addEventListener("click", function (ev) {
  var b = ev.target.closest("[data-canje]"); if (!b || b.disabled) return;
  var t = (SHIBU.est.tienda || []).find(function (x) { return String(x.id) === b.dataset.canje; }); if (!t) return;
  b.disabled = true;
  rpc("tienda_canjear", { p_item: t.id }).then(function () {
    toast((shibuFrase("canje_pedido") ? shibuFrase("canje_pedido") + " " : "") + t.nombre + ": pídeselo a la cajera");
    return rpc("mis_estado").then(function (e) { SHIBU.est = e; shibuChip(); shibuPerfilDibuja(); });
  }).catch(function (err) { b.disabled = false; fail(err); });
});

// ---- Caja: premios por aprobar
function shibuPendientes() {
  if (!U || !U.charge) return Promise.resolve();
  return rpc("tienda_pendientes").then(function (l) {
    l = l || [];
    if (l.length > SHIBU.pend) {
      var x = l[l.length - 1];
      toast(x.quien + " pidió " + x.nombre + ": apruébalo en Caja");
    }
    SHIBU.pend = l.length;
    shibuPremiosCaja(l);
  }).catch(function () {});
}
// Lo llama pos-caja.js al dibujar «Resumen» (y aquí, al llegar un premio nuevo)
function shibuPremiosCaja(lista) {
  var box = $("premiosBox"); if (!box) return;
  if (!lista) { shibuPendientes(); return; }
  box.innerHTML = lista.length ? '<div class="card premios-caja"><b>Premios de misiones por aprobar</b>' + lista.map(function (x) {
    return '<div class="premio-row"><span>' + esc(x.quien) + " · " + esc(x.nombre) + ' <small class="muted">(' + x.puntos + " pts)</small></span>" +
      '<span><button type="button" class="ok" data-premio="' + x.id + '" data-ok="1">Aprobar</button> <button type="button" data-premio="' + x.id + '" data-ok="0">No</button></span></div>';
  }).join("") + '<p class="muted" style="margin:6px 0 0">Al aprobar, el premio sale a cocina en Ref 0.</p></div>' : "";
}
document.addEventListener("click", function (ev) {
  var b = ev.target.closest("[data-premio]"); if (!b || !$("premiosBox") || !$("premiosBox").contains(b)) return;
  var ok = b.dataset.ok === "1";
  b.disabled = true;
  rpc("tienda_resolver", { p_canje: Number(b.dataset.premio), p_aprobar: ok, p_nota: "" }).then(function () {
    toast(ok ? "Premio aprobado: sale a cocina" : "Premio rechazado: le vuelven sus puntos");
    SHIBU.pend = Math.max(0, SHIBU.pend - 1);
    return shibuPendientes();
  }).catch(function (err) { b.disabled = false; fail(err); });
});
