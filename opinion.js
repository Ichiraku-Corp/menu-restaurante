// Página de opinión del recibo (opinion.html?t=CÓDIGO): estrellas, comentario y, si quiere, nombre y WhatsApp.
// Habla con Supabase sin sesión (opinion_ver / opinion_enviar en supabase/opiniones.sql): el código del recibo es la llave.
(function () {
  "use strict";
  var C = window.MENU_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var token = (new URLSearchParams(location.search).get("t") || "").trim();
  var NIVEL = [null, "Muy mal", "Mal", "Normal", "¡Bien!", "¡Umai! Excelente"];
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.82 5.9 6.48.78-4.77 4.47 1.22 6.42L12 17.02l-5.75 3.15 1.22-6.42L2.7 9.28l6.48-.78z"/></svg>';
  var S = { rating: 0, info: null };

  function rpc(fn, args) {
    var base = String(C.SUPABASE_URL || "").replace(/\/$/, "");
    return fetch(base + "/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(args),
      headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY, "Content-Type": "application/json" } })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) {
          if (!r.ok) { var e = new Error((j && j.message) || "Error " + r.status); e.servidor = true; throw e; }
          return j;
        });
      });
  }
  function mostrar(id) { ["cargando", "aviso", "form", "gracias"].forEach(function (k) { $(k).hidden = k !== id; }); }
  function aviso(t, p, reintentar) { $("avisoT").textContent = t; $("avisoP").textContent = p; $("reintentar").hidden = !reintentar; mostrar("aviso"); }

  // Estrellas: un grupo de opciones (flechas para moverse, como cualquier lista de opciones)
  var stars = $("stars");
  for (var i = 1; i <= 5; i++) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "star"; b.dataset.n = i; b.innerHTML = STAR;
    b.setAttribute("role", "radio"); b.setAttribute("aria-label", i + (i === 1 ? " estrella" : " estrellas") + ": " + NIVEL[i]);
    stars.appendChild(b);
  }
  function calificar(n) {
    S.rating = n;
    stars.querySelectorAll(".star").forEach(function (x) {
      var k = Number(x.dataset.n); x.classList.toggle("on", k <= n); x.setAttribute("aria-checked", String(k === n));
      x.tabIndex = k === (n || 1) ? 0 : -1;
    });
    $("meter").style.width = n * 20 + "%";
    $("nivel").textContent = n ? NIVEL[n] : "Toca una estrella";
    $("comentarioL").textContent = !n ? "Cuéntanos (si quieres)" : n <= 2 ? "¿Qué salió mal? Lo vamos a arreglar" : n === 3 ? "¿Qué podemos mejorar?" : "¿Qué fue lo que más te gustó?";
    if (n) $("error").hidden = true;
  }
  stars.addEventListener("click", function (e) { var b = e.target.closest(".star"); if (b) calificar(Number(b.dataset.n)); });
  stars.addEventListener("keydown", function (e) {
    var d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!d) return;
    e.preventDefault(); var n = Math.min(5, Math.max(1, (S.rating || 0) + d)); calificar(n); stars.querySelector('[data-n="' + n + '"]').focus();
  });
  $("comentario").addEventListener("input", function () { $("cuenta").textContent = this.value.length + " / 500"; });
  $("form").addEventListener("input", function () { $("error").hidden = true; });  // al corregir, se quita el aviso
  $("quiero").addEventListener("change", function () { $("datos").hidden = !this.checked; if (this.checked) $("nombre").focus(); });

  // Quién atendió (lo dice el recibo): «¿Cómo te atendió Mei?» · «¿Cómo te atendieron Mei y Nami?»
  function pregunta(quien) {
    quien = (Array.isArray(quien) ? quien : []).filter(function (x) { return typeof x === "string" && x.trim(); }).slice(0, 3);
    if (!quien.length) return "¿Cómo te fue?";
    var juntos = quien.length > 1 ? quien.slice(0, -1).join(", ") + " y " + quien[quien.length - 1] : quien[0];
    return "¿Cómo te " + (quien.length > 1 ? "atendieron " : "atendió ") + juntos + "?";
  }
  function formulario() {
    var info = S.info || {};
    $("titulo").textContent = pregunta(info.atendio);
    $("fecha").textContent = info.fecha ? "Tu visita del " + info.fecha + " · tarda 1 minuto" : "";
    calificar(info.rating || 0);
    $("comentario").value = info.comment || ""; $("cuenta").textContent = $("comentario").value.length + " / 500";
    $("quiero").checked = false; $("datos").hidden = true; $("nombre").value = ""; $("tel").value = "";
    $("quieroL").textContent = info.contacto ? "Cambiar mis datos de contacto" : "Quiero que me contacten";
    $("notaDatos").firstChild.textContent = info.contacto ? "Si no los cambias, se quedan los que ya nos dejaste. " : "Solo lo ve el equipo de Ichiraku para responderte. ";
    $("error").hidden = true; $("enviar").disabled = false; $("enviar").textContent = "Enviar";
    mostrar("form");
  }
  function gracias(recien) {
    var info = S.info, r = info.rating, mala = r <= 2;
    // Con 1–2 estrellas se pide disculpas (sin el chiste de juego); con 3–5, «¡Arigatou!»
    $("grK").textContent = mala ? "ごめんなさい" : "ありがとう"; $("grT").textContent = mala ? "Lo sentimos mucho" : "¡Arigatou!"; $("grX").hidden = mala;
    $("grS").textContent = "★★★★★".slice(0, r) + "☆☆☆☆☆".slice(0, 5 - r);
    $("grS").setAttribute("aria-label", r + " de 5 estrellas");
    var p = r >= 4 ? "¡Nos alegra mucho que te haya gustado! Te esperamos pronto."
      : r === 3 ? "Gracias por contarnos. Vamos a mejorar para que la próxima sea de 5 estrellas."
      : "Gracias por contarnos. Ya le avisamos al encargado para arreglarlo." +
        (!info.contacto && info.cambios > 0 ? " Si quieres que te escribamos, toca «Cambiar mi opinión» y déjanos tu WhatsApp." : "");
    $("grP").textContent = (recien ? "" : "Ya nos diste tu opinión. ") + p;
    var g = info.google && /^https:\/\//i.test(info.google) ? info.google : "";
    // A todos se les invita a Google (sus normas no permiten invitar solo a los contentos); el texto cambia según la nota
    $("google").hidden = !g; if (g) $("googleA").href = g;
    $("googleT").textContent = r >= 4 ? "¿Nos ayudas con un minuto más?" : "¿Quieres contarlo también en Google?";
    $("googleP").textContent = r >= 4 ? "Cuéntalo también en Google Maps: así más gente nos encuentra." : "Tu opinión ayuda a otros clientes y a nosotros a mejorar.";
    $("cambiar").hidden = !(info.cambios > 0);
    mostrar("gracias");
    if (recien) $("grT").focus();
  }
  $("cambiar").addEventListener("click", formulario);

  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = function (m) { $("error").textContent = m; $("error").hidden = false; };
    if (!S.rating) return err("Toca de 1 a 5 estrellas para calificar tu visita.");
    var quiere = $("quiero").checked, nom = quiere ? $("nombre").value.trim() : "", tel = quiere ? $("tel").value.trim() : "";
    if (quiere && !nom && !tel) return err("Escribe tu nombre y tu WhatsApp, o apaga «" + $("quieroL").textContent + "».");
    var dig = tel.replace(/\D/g, "").length;
    if (tel && (dig < 7 || dig > 15)) return err("Revisa el número de WhatsApp (por ejemplo 0414 123 4567).");
    $("enviar").disabled = true; $("enviar").textContent = "Enviando…"; $("error").hidden = true;
    var com = $("comentario").value.trim();
    rpc("opinion_enviar", { p_token: token, p_rating: S.rating, p_comment: com, p_name: nom, p_phone: tel })
      .then(function (res) {
        S.info = Object.assign({}, S.info, { estado: "respondida", rating: S.rating, comment: com, contacto: !!(S.info && S.info.contacto) || !!(nom || tel),
          cambios: res && res.cambios != null ? res.cambios : 0, google: res && res.google });
        gracias(true);
      })
      .catch(function (x) {
        $("enviar").disabled = false; $("enviar").textContent = "Enviar";
        err(x.servidor ? x.message : "Sin conexión: revisa tu internet e intenta de nuevo. Lo que escribiste sigue aquí.");
      });
  });

  function cargar() {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(token)) return aviso("Este enlace no está completo", "Escanea de nuevo el código QR de tu recibo.");
    if (!C.SUPABASE_URL) return aviso("No disponible", "La página de opiniones no está configurada.");
    mostrar("cargando");
    rpc("opinion_ver", { p_token: token }).then(function (info) {
      if (!info || info.estado === "no_existe") return aviso("Este enlace no es válido", "Escanea de nuevo el código QR de tu recibo.");
      if (info.estado === "vencida") return aviso("Este enlace ya venció", "Dura 30 días después de tu visita. ¡Te esperamos pronto en Ichiraku!");
      S.info = info;
      if (info.estado === "respondida") gracias(false); else formulario();
    }).catch(function () { aviso("Sin conexión", "No pudimos abrir tu opinión. Revisa tu internet e intenta de nuevo.", true); });
  }
  $("reintentar").addEventListener("click", cargar);
  cargar();
})();
