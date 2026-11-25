// ---------------------------------------------------------------- Tienda de Shibu: la máquina expendedora de Mi perfil
// Pedido de Edgar (24/11): la tienda es una máquina expendedora grande. Vive en la sección «Expendedora» de Mi perfil.
// La maid elige el premio en el vidrio (o con el teclado: A1, B2…), mantiene presionado el botón grande y el premio
// cae a la bandeja. La compra la hace la base (tienda_canjear): el premio sale a cocina en Ref 0 y queda en el cierre.
// Las casillas sin premio dicen «Pronto» (ahí van los comodines que Edgar está eligiendo).
var VM = { sel: null, tecla: "", ocupada: false, t: 0 };
var VM_COLS = 4, VM_MIN = 8, VM_MANTENER_MS = 1200;

function vmCodigo(i) { return String.fromCharCode(65 + Math.floor(i / VM_COLS)) + (i % VM_COLS + 1); }   // A1, A2… B1
function vmItems() { return (SHIBU.est && SHIBU.est.tienda) || []; }
function vmPuntos() { return (SHIBU.est && SHIBU.est.puntos) || 0; }
// Economía (Edgar, 25/11): el nivel 4 de estrellas regala un premio; cada premio dice por qué no se puede pedir ahora
// (la base lo decide: tope del mes, 2 al día, 1 grande por semana, nivel de la ventana premium o unidades de la semana)
function vmRegalo() { return !!(SHIBU.est && SHIBU.est.regalo); }
function vmNivelPremium() {
  var e = SHIBU.est || {}, n = e.premium_nivel || 2, niv = (e.estrellas && e.estrellas.niveles) || [5, 15, 30, 60, 100];
  return { n: n, estrellas: niv[n - 1] };
}
function vmBloqueoLcd(t) {
  var p = vmNivelPremium();
  return { recarga: "RECARGANDO · VUELVE EL DÍA 1", hoy: "YA PEDISTE TUS PREMIOS DE HOY · VUELVE MAÑANA", grande: "1 PREMIO GRANDE POR SEMANA · VUELVE EL LUNES",
           nivel: "SE ABRE CON EL NIVEL " + p.n + " DE ESTRELLAS (" + p.estrellas + " ⭐)", agotado: "AGOTADO ESTA SEMANA · VUELVE EL LUNES" }[t.bloqueo] || "";
}
function vmBloqueoCorto(t) {
  return { recarga: "Recargando", hoy: "Mañana", grande: "1 por semana", nivel: "Nivel " + vmNivelPremium().n, agotado: "Agotado" }[t.bloqueo] || "";
}
function vmFirma() { return JSON.stringify([vmItems(), vmPuntos(), ((SHIBU.est && SHIBU.est.canjes) || []).length, vmRegalo()]); }
// Lo primero que dice la pantalla: si la máquina se recarga, si ya pidió lo del día o si tiene un premio gratis
function vmMensajeInicial() {
  var it = vmItems(), e = SHIBU.est || {};
  if (it.length && it.every(function (x) { return x.bloqueo === "recarga"; })) {
    vmMensaje("RECARGANDO · VUELVE EL DÍA 1", "falta"); vmGlobo("La máquina se está recargando. Vuelve el día 1 por más premios."); return;
  }
  if (e.canjes_dia && e.canjes_hoy >= e.canjes_dia) {
    vmMensaje("YA PEDISTE TUS " + e.canjes_dia + " PREMIOS DE HOY", "falta"); vmGlobo("Por hoy ya está. Mañana la máquina te espera."); return;
  }
  if (vmRegalo()) { vmMensaje("🎁 TIENES 1 PREMIO GRATIS", "ok"); vmGlobo("¡Llegaste al nivel 4 de estrellas! Elige el premio que quieras: este va por la casa."); return; }
  vmMensaje("ELIGE UN PREMIO"); vmGlobo("");
}

// Abrir la tienda es abrir Mi perfil en la expendedora
function abrirTienda() { if (typeof shibuPerfil === "function") shibuPerfil("tienda"); }
// Mi perfil dibuja la máquina al entrar a la sección; lo nuevo de la base la pone al día sin reiniciarla
function vmAbre(cont) {
  if (!cont) return;
  vmSuelta(false);
  VM.sel = null; VM.tecla = ""; VM.ocupada = false;
  VM.firma = vmFirma();
  vmDibuja(cont);
  vmMensajeInicial();
}
function vmAlDia() {
  if (!$("vmSlots") || VM.ocupada || VM.t) return;
  // Solo si cambió algo (premios, saldo o compras): así no parpadean las fotos cada 30 s
  var firma = vmFirma();
  if (firma === VM.firma) return;
  VM.firma = firma;
  vmPintaSlots(); vmSaldo(); vmRecibo();
  if (VM.sel != null && vmItems()[VM.sel]) vmElige(VM.sel); else { VM.sel = null; vmMensajeInicial(); }
}

// ---- Dibujo de la máquina
function vmDibuja(cont) {
  var focos = "";
  for (var i = 0; i < 22; i++) focos += "<i></i>";
  cont.innerHTML =
    '<div class="vm-sala">' +
    '<div class="vm" role="group" aria-label="Máquina de premios de Shibu">' +
      '<div class="vm-letrero"><span class="vm-focos" aria-hidden="true">' + focos + '</span>' +
        '<span class="vm-marca"><b>SHIBU MART</b><small>Premios para maids · se pagan con puntos</small></span></div>' +
      '<div class="vm-cuerpo">' +
        '<div class="vm-vidrio"><div class="vm-estantes" id="vmSlots"></div><i class="vm-reflejo" aria-hidden="true"></i></div>' +
        '<div class="vm-panel">' +
          '<span class="vm-tornillo t1"></span><span class="vm-tornillo t2"></span><span class="vm-tornillo t3"></span><span class="vm-tornillo t4"></span>' +
          '<div class="vm-lcd" role="status" aria-live="polite"><div class="lcd-fila"><small>SALDO</small><b><span id="vmSaldo">0</span> PTS</b></div>' +
            '<div class="lcd-msg" id="vmMsg"></div></div>' +
          '<div class="vm-teclado" id="vmTeclado" aria-label="Teclado de la máquina"></div>' +
          '<div class="vm-boton-caja"><button type="button" class="vm-comprar" id="vmComprar" disabled aria-label="Mantén presionado para comprar">' +
            '<svg class="vm-anillo" viewBox="0 0 120 120" aria-hidden="true"><circle class="an-fondo" cx="60" cy="60" r="54"/><circle class="an-lleno" cx="60" cy="60" r="54"/></svg>' +
            '<span class="vm-comprar-txt"><b>MANTÉN</b><small>para comprar</small></span></button></div>' +
          '<div class="vm-shibu">' + shibuCara("media") + '<p class="vm-globo" id="vmGlobo" hidden></p>' +
            '<p class="vm-ayuda" id="vmAyuda">Elige un premio en el vidrio y mantén presionado el botón grande.</p></div>' +
          '<div class="vm-recibo" id="vmRecibo"></div>' +
        "</div>" +
      "</div>" +
      '<div class="vm-bandeja"><span class="vm-placa" aria-hidden="true"><img src="assets/logo-gato.png" alt=""><span><b>ICHIRAKU</b><small>RAMEN</small></span></span>' +
        '<div class="vm-hueco" id="vmHueco"><span class="vm-hueco-txt">RETIRA TU PREMIO AQUÍ</span></div><span class="vm-tapa" id="vmTapa" aria-hidden="true"></span>' +
        '<span class="vm-ranura" aria-hidden="true"><i></i>PUNTOS</span></div>' +
      '<div class="vm-patas" aria-hidden="true"><i></i><i></i></div>' +
    "</div></div>";
  vmPintaSlots(); vmTeclado(); vmSaldo(); vmRecibo();
}
function vmPintaSlots() {
  var items = vmItems(), pts = vmPuntos(), n = Math.max(VM_MIN, Math.ceil(items.length / VM_COLS) * VM_COLS), h = "";
  for (var i = 0; i < n; i++) {
    var t = items[i], cod = vmCodigo(i);
    if (!t) {
      h += '<div class="vm-slot vacio" aria-hidden="true"><span class="vm-prod"><svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="5" y="11" width="14" height="10" rx="2.5"/></svg></span>' +
        '<span class="vm-espiral"></span><span class="vm-etiqueta"><b>' + cod + "</b><span>Pronto</span></span></div>";
      continue;
    }
    var gratis = vmRegalo(), alcanza = !t.bloqueo && (gratis || pts >= t.puntos), precio = gratis ? "GRATIS" : t.puntos + " pts";
    var quedan = t.ventana === "rota" && t.quedan != null && !t.bloqueo ? '<span class="vm-quedan' + (t.quedan <= 2 ? " poco" : "") + '">' +
      (t.quedan <= 2 ? "¡Quedan " + t.quedan + "!" : "Quedan " + t.quedan) + "</span>" : "";
    h += '<button type="button" class="vm-slot ' + (alcanza ? "alcanza" : "falta") + (t.bloqueo ? " bloq b-" + t.bloqueo : "") + (t.ventana ? " v-" + t.ventana : "") +
      (VM.sel === i ? " sel" : "") + '" data-i="' + i + '" aria-label="' +
      esc(cod + ", " + t.nombre + ", " + (gratis ? "gratis" : t.puntos + " puntos") + (t.bloqueo ? ", " + vmBloqueoCorto(t) : "")) + '">' +
      (t.ventana === "premium" ? '<span class="vm-cinta-premium">PREMIUM</span>' : "") + quedan +
      '<span class="vm-prod">' + shibuFoto(t) + '</span><span class="vm-espiral"></span>' +
      (t.bloqueo ? '<span class="vm-bloq">' + (t.bloqueo === "nivel" ? "🔒 " : "") + esc(vmBloqueoCorto(t)) + "</span>" : "") +
      '<span class="vm-nombre">' + esc(t.nombre) + '</span><span class="vm-etiqueta"><b>' + cod + "</b><span>" + precio + "</span></span></button>";
  }
  $("vmSlots").innerHTML = h;
  vmBoton();
}
function vmTeclado() {
  var filas = Math.ceil(Math.max(VM_MIN, vmItems().length) / VM_COLS), k = "";
  // Arriba las letras (filas) y el borrar; abajo los números (columnas)
  for (var f = 0; f < Math.min(filas, 3); f++) k += '<button type="button" data-k="' + String.fromCharCode(65 + f) + '">' + String.fromCharCode(65 + f) + "</button>";
  k += '<button type="button" class="vm-borrar" data-k="borrar" aria-label="Borrar">⌫</button>';
  for (var c = 1; c <= VM_COLS; c++) k += '<button type="button" data-k="' + c + '">' + c + "</button>";
  $("vmTeclado").innerHTML = k;
}
function vmSaldo(desde) {
  var b = $("vmSaldo"); if (!b) return;
  if (desde != null) shibuCuentaEn(b, desde, vmPuntos(), 900); else b.textContent = vmPuntos();
}
function vmRecibo() {
  if (!$("vmRecibo")) return;
  var c = ((SHIBU.est && SHIBU.est.canjes) || []).slice(0, 4), est = { entregado: "A cocina", pendiente: "Esperando", rechazado: "No salió" };
  $("vmRecibo").innerHTML = '<b class="rec-tit">MIS PREMIOS</b>' + (c.length ? "<ol>" + c.map(function (x) {
    return '<li><span>' + esc(x.nombre) + "</span><span>" + (x.regalo ? "Gratis" : x.puntos + " pts") + " · " + esc(est[x.estado] || x.estado) + "</span></li>";
  }).join("") + "</ol>" : '<p>Todavía no compras nada.</p>');
}
function vmMensaje(txt, tipo) {
  var m = $("vmMsg"); if (!m) return;
  m.textContent = txt; m.className = "lcd-msg" + (tipo ? " " + tipo : "");
}
function vmGlobo(txt) {
  var g = $("vmGlobo"); if (!g) return;
  g.hidden = !txt; if ($("vmAyuda")) $("vmAyuda").hidden = !!txt;
  if (txt) shibuEscribe(g, txt);
}
// El botón grande se prende cuando lo elegido alcanza
function vmBoton() {
  var b = $("vmComprar"); if (!b) return;
  var t = VM.sel == null ? null : vmItems()[VM.sel];
  b.disabled = VM.ocupada || !t || !!t.bloqueo || (!vmRegalo() && vmPuntos() < t.puntos);
}

// ---- Elegir (tocando el vidrio o con el teclado)
function vmElige(i) {
  if (VM.ocupada) return;
  var t = vmItems()[i]; if (!t) return;
  VM.sel = i; VM.tecla = "";
  Array.prototype.forEach.call(document.querySelectorAll("#vmSlots .vm-slot"), function (s) { s.classList.toggle("sel", Number(s.dataset.i) === i); });
  var falta = vmRegalo() ? 0 : t.puntos - vmPuntos();
  if (t.bloqueo) vmMensaje(vmCodigo(i) + " · " + t.nombre.toUpperCase() + " · " + vmBloqueoLcd(t), "falta");
  else vmMensaje(vmCodigo(i) + " · " + t.nombre.toUpperCase() + " · " + (vmRegalo() ? "GRATIS" : falta > 0 ? "TE FALTAN " + falta + " PTS" : t.puntos + " PTS"), falta > 0 ? "falta" : "");
  vmBoton();
}
function vmTecla(k) {
  if (VM.ocupada) return;
  if (k === "borrar") { VM.tecla = ""; VM.sel = null; vmPintaSlots(); vmMensajeInicial(); return; }
  if (/^[A-Z]$/.test(k)) { VM.tecla = k; vmMensaje(k + "_"); return; }
  if (!VM.tecla) { vmMensaje("PRIMERO LA LETRA", "falta"); return; }
  var i = (VM.tecla.charCodeAt(0) - 65) * VM_COLS + Number(k) - 1;
  if (!vmItems()[i]) { VM.tecla = ""; vmMensaje(String.fromCharCode(65 + Math.floor(i / VM_COLS)) + k + " · PRONTO", "falta"); return; }
  vmElige(i);
}

// ---- Comprar: se mantiene presionado el botón grande hasta que el anillo se llena
function vmMantener() {
  var b = $("vmComprar");
  if (!b || b.disabled || VM.t) return;
  b.classList.add("cargando");
  vmMensaje("SIGUE PRESIONANDO…");
  VM.t = setTimeout(function () { VM.t = 0; b.classList.remove("cargando"); vmComprar(); }, VM_MANTENER_MS);
}
function vmSuelta(avisar) {
  if (!VM.t) return;
  clearTimeout(VM.t); VM.t = 0;
  var b = $("vmComprar"); if (b) b.classList.remove("cargando");
  if (avisar) vmMensaje("MANTÉN HASTA QUE SE LLENE", "falta");
}
function vmComprar() {
  var i = VM.sel, t = vmItems()[i]; if (!t) return;
  var antes = vmPuntos();
  VM.ocupada = true; vmBoton();
  vmMensaje("PREPARANDO TU PREMIO…");
  rpc("tienda_canjear", { p_item: t.id }).then(function () {
    return rpc("mis_estado").then(function (e) { SHIBU.est = e; shibuChip(); }, function () {});
  }).then(function () {
    vmCae(i, t, function () {
      vmSaldo(antes); vmRecibo();
      vmMensaje("¡LISTO! " + t.nombre.toUpperCase() + " VA A COCINA", "ok");
      vmGlobo(shibuFrase("canje_aprobado") || "Tu premio va a cocina.");
      VM.ocupada = false; VM.sel = null; VM.firma = vmFirma(); vmPintaSlots();
      if (typeof shibuHubLado === "function" && $("perfilDlg").open) shibuHubLado();
      if (typeof shibuTabRedibuja === "function") shibuTabRedibuja();
    });
  }).catch(function (err) {
    VM.ocupada = false; vmBoton();
    vmMensaje(String(errMsg(err) || "No se pudo comprar").toUpperCase(), "falta");
  });
}
// La espiral gira, el premio sale hacia adelante, cae a la bandeja y rebota; la tapa se mueve
function vmCae(i, t, fin) {
  var slot = document.querySelector('#vmSlots .vm-slot[data-i="' + i + '"]'), sala = document.querySelector("#perfilBody .vm-sala");
  var hueco = $("vmHueco"), prod = slot && slot.querySelector(".vm-prod");
  function enBandeja() {
    hueco.querySelectorAll(".vm-premio").forEach(function (x) { x.remove(); });
    var p = document.createElement("span"); p.className = "vm-premio"; p.innerHTML = shibuFoto(t);
    hueco.appendChild(p);
    $("vmTapa").classList.remove("golpe"); void hueco.offsetWidth; $("vmTapa").classList.add("golpe");
    fin();
  }
  if (!slot || !prod || !sala || !hueco || shibuQuieto() || !sala.animate) { if (hueco) enBandeja(); else fin(); return; }
  slot.classList.add("cae");
  var rs = sala.getBoundingClientRect(), r0 = prod.getBoundingClientRect(), r1 = hueco.getBoundingClientRect();
  var c = document.createElement("span");
  c.className = "vm-cayendo"; c.innerHTML = shibuFoto(t);
  c.style.left = (r0.left - rs.left) + "px"; c.style.top = (r0.top - rs.top) + "px"; c.style.width = r0.width + "px"; c.style.height = r0.height + "px";
  sala.appendChild(c);
  var dx = (r1.left + r1.width / 2) - (r0.left + r0.width / 2), dy = (r1.top + r1.height * 0.42) - (r0.top + r0.height / 2);
  setTimeout(function () {
    prod.style.visibility = "hidden";
    var a = c.animate([
      { transform: "translate(0,0) scale(1)" },
      { transform: "translate(0,10px) scale(1.06)", offset: 0.22 },
      { transform: "translate(" + dx * 0.55 + "px," + dy * 0.45 + "px) rotate(14deg) scale(.92)", offset: 0.6, easing: "cubic-bezier(.5,0,1,.6)" },
      { transform: "translate(" + dx + "px," + dy + "px) rotate(24deg) scale(.82)", offset: 0.84 },
      { transform: "translate(" + dx + "px," + (dy - 16) + "px) rotate(10deg) scale(.82)", offset: 0.93 },
      { transform: "translate(" + dx + "px," + dy + "px) rotate(4deg) scale(.82)" }
    ], { duration: 1100, fill: "forwards" });
    a.onfinish = function () {
      c.remove(); slot.classList.remove("cae");
      // La casilla se vuelve a llenar (las que rotan bajan una unidad: lo dice su etiqueta)
      prod.style.visibility = ""; prod.classList.add("repone"); setTimeout(function () { prod.classList.remove("repone"); }, 700);
      enBandeja();
    };
  }, 700);
}

// ---- Eventos
document.addEventListener("click", function (ev) {
  if (!ev.target.closest(".vm-sala")) return;
  var s = ev.target.closest(".vm-slot[data-i]"); if (s) { vmElige(Number(s.dataset.i)); return; }
  var k = ev.target.closest("#vmTeclado [data-k]"); if (k) vmTecla(k.dataset.k);
});
document.addEventListener("pointerdown", function (ev) {
  var b = ev.target.closest("#vmComprar"); if (!b) return;
  ev.preventDefault();
  try { b.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura igual funciona */ }
  vmMantener();
});
document.addEventListener("pointerup", function (ev) { if (ev.target.closest("#vmComprar")) vmSuelta(true); });
document.addEventListener("pointercancel", function (ev) { if (ev.target.closest("#vmComprar")) vmSuelta(false); });
document.addEventListener("keydown", function (ev) {
  if (!ev.target.closest || !ev.target.closest("#vmComprar") || (ev.key !== " " && ev.key !== "Enter")) return;
  ev.preventDefault(); if (!ev.repeat) vmMantener();
});
document.addEventListener("keyup", function (ev) {
  if (ev.target.closest && ev.target.closest("#vmComprar") && (ev.key === " " || ev.key === "Enter")) vmSuelta(true);
});
document.addEventListener("contextmenu", function (ev) { if (ev.target.closest && ev.target.closest("#vmComprar")) ev.preventDefault(); });
