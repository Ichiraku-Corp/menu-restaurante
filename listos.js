/* Pantalla de pedidos para llevar (TV o tablet de cara al cliente): «Preparando» y «¡Listo! Pasa a retirar»
   con el número del pedido del día. Suena cuando un pedido queda listo; sale al entregarlo en la caja. */
(function () {
  "use strict";
  var C = window.MENU_CONFIG || {}, $ = function (id) { return document.getElementById(id); };
  if (!C.SUPABASE_URL) { document.body.textContent = "Falta configurar Supabase en config.js."; return; }
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  var POLL_MS = 4000, NEW_MS = 60000, skew = 0, timer = null, soundOn = false, audio = null, seen = null, nuevos = {};
  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }

  // ---------------------------------------------------------------- Entrar (cuenta de sala, una sola vez)
  sb.auth.onAuthStateChange(function (_e, session) {
    $("login").classList.toggle("hidden", !!session); $("app").classList.toggle("hidden", !session);
    if (session && !timer) { load(); timer = setInterval(load, POLL_MS); setInterval(tick, 1000); tick(); awake(); }
  });
  $("login").addEventListener("submit", function (e) {
    e.preventDefault(); $("loginErr").textContent = "";
    sb.auth.signInWithPassword({ email: $("email").value, password: $("password").value })
      .then(function (r) { if (r.error) $("loginErr").textContent = "No se pudo entrar: " + r.error.message; });
  });

  // ---------------------------------------------------------------- Datos
  function load() {
    return q(sb.rpc("pos_listos")).then(function (d) {
      $("net").classList.add("hidden");
      skew = new Date(d.now).getTime() - Date.now();
      var ready = (d.listos || []).map(function (x) { return Number(x.n); });
      if (seen) {
        var fresh = ready.filter(function (n) { return seen.indexOf(n) < 0; });
        fresh.forEach(function (n) { nuevos[n] = Date.now(); });
        if (fresh.length) chime();
      }
      seen = ready; draw(d);
    }).catch(function (e) {
      $("net").classList.remove("hidden");
      $("net").textContent = /autorizado/.test(e.message || "") ? "Esta cuenta no puede ver los pedidos: entra con la cuenta de sala." : "Sin conexión: reintentando…";
    });
  }
  function nums(list, isReady) {
    var now = Date.now();
    return list.length ? list.map(function (x) {
      var n = Number(x.n), isNew = isReady && nuevos[n] && now - nuevos[n] < NEW_MS;
      return '<span class="num' + (isNew ? " new" : "") + '">' + n + "</span>";
    }).join("") : '<p class="empty">—</p>';
  }
  function draw(d) { $("prep").innerHTML = nums(d.preparando || [], false); $("ready").innerHTML = nums(d.listos || [], true); }
  function tick() { $("clock").textContent = new Date(Date.now() + skew).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }); }

  // ---------------------------------------------------------------- Sonido, pantalla encendida y pantalla completa
  function chime() {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [523, 659, 784].forEach(function (f, k) {
        var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + k * 0.16;
        o.frequency.value = f; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5); o.start(t); o.stop(t + 0.55);
      });
    } catch (e) { /* sin sonido */ }
  }
  function awake() { try { if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(function () { /* no se pudo: sigue igual */ }); } catch (e) { /* sin wake lock */ } }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) awake(); });
  $("sound").addEventListener("click", function () {
    soundOn = !soundOn; this.classList.toggle("on", soundOn); this.textContent = soundOn ? "🔔 Sonido activo" : "🔔 Activar sonido"; if (soundOn) chime();
  });
  $("full").addEventListener("click", function () { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); });
})();
