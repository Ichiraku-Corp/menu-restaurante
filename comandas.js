/* Pantalla de cocina: muestra cada comanda enviada con su tiempo; un toque en un plato lo marca listo
   (la mesera lo ve en su tablet) y así se mide el tiempo real de cada plato. */
(function () {
  "use strict";
  var C = window.MENU_CONFIG || {}, $ = function (id) { return document.getElementById(id); };
  if (!C.SUPABASE_URL) { document.body.textContent = "Falta configurar Supabase en config.js."; return; }
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  var WARN_MIN = 10, BAD_MIN = 20, POLL_MS = 4000;
  var data = null, skew = 0, known = {}, first = true, timer = null, soundOn = false, audio = null;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function fmtQ(n) { n = Number(n); return n % 1 ? String(n).replace(".", ",") : String(n); }
  function elapsed(t) { return Math.max(0, Math.floor((Date.now() + skew - new Date(t).getTime()) / 1000)); }
  function mmss(s) { var m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0"); }

  // ---------------------------------------------------------------- Entrar
  sb.auth.onAuthStateChange(function (_e, session) {
    $("login").classList.toggle("hidden", !!session); $("app").classList.toggle("hidden", !session);
    if (session && !timer) { load(); timer = setInterval(load, POLL_MS); setInterval(tick, 1000); }
  });
  $("login").addEventListener("submit", function (e) {
    e.preventDefault(); $("loginErr").textContent = "";
    sb.auth.signInWithPassword({ email: $("email").value, password: $("password").value })
      .then(function (r) { if (r.error) $("loginErr").textContent = "No se pudo entrar: " + r.error.message; });
  });

  // ---------------------------------------------------------------- Datos
  function load() {
    return q(sb.rpc("pos_kitchen")).then(function (d) {
      $("net").classList.add("hidden");
      skew = new Date(d.now).getTime() - Date.now();
      var fresh = (d.orders || []).some(function (o) { return o.items.some(function (i) { return !known[i.id]; }); });
      (d.orders || []).forEach(function (o) { o.items.forEach(function (i) { known[i.id] = true; }); });
      if (fresh && !first) beep();
      first = false; data = d; draw();
    }).catch(function (e) {
      $("net").classList.remove("hidden");
      $("net").textContent = /autorizado/.test(e.message || "") ? "Esta cuenta no puede ver la cocina: entra con la cuenta de sala." : "Sin conexión: reintentando…";
    });
  }
  function draw() {
    var orders = (data && data.orders) || [];
    $("board").innerHTML = orders.length ? orders.map(function (o) {
      var s = elapsed(o.first_sent), m = s / 60, cls = m >= BAD_MIN ? " bad" : m >= WARN_MIN ? " warn" : "";
      return '<section class="card' + cls + '" data-order="' + o.id + '"><div class="head"><b>' + esc(o.label) + '</b><span class="t" data-since="' + esc(o.first_sent) + '">' + mmss(s) + "</span></div>" +
        '<div class="sub">#' + esc(o.day_number || "") + (o.waiter ? " · " + esc(o.waiter) : "") + "</div>" +
        o.items.map(function (i) {
          return '<button type="button" class="item" data-item="' + i.id + '" title="Tocar cuando esté listo"><span class="q">' + fmtQ(i.qty) + '</span><span><span class="n">' + esc(i.name) + "</span>" +
            (i.variant || i.option ? '<span class="v">' + esc([i.variant, i.option].filter(Boolean).join(" · ")) + "</span>" : "") +
            (i.notes ? '<span class="note">' + esc(i.notes) + "</span>" : "") + "</span></button>";
        }).join("") +
        (o.items.length > 1 ? '<button type="button" class="allready" data-all="' + o.id + '">Todo listo ✓</button>' : "") + "</section>";
    }).join("") : '<p class="empty">No hay comandas pendientes 🍜</p>';
    var t = (data && data.today) || {};
    $("stats").textContent = (t.count ? "Hoy: " + t.count + " platos · promedio " + String(t.avg).replace(".", ",") + " min" : "Hoy: sin platos listos todavía") +
      (orders.length ? " · " + orders.length + " comanda" + (orders.length === 1 ? "" : "s") + " en cola" : "");
    var rec = (data && data.recent) || [];
    $("recent").innerHTML = rec.length ? "Listos: " + rec.map(function (r) {
      return '<button type="button" data-undo="' + r.id + '" title="Tocar para deshacer">' + fmtQ(r.qty) + " " + esc(r.name) + " · " + esc(r.label) + " · " + String(r.minutes).replace(".", ",") + " min ↺</button>";
    }).join("") : "";
  }
  function tick() {
    $("clock").textContent = new Date(Date.now() + skew).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
    document.querySelectorAll("[data-since]").forEach(function (el) {
      var s = elapsed(el.dataset.since), m = s / 60, card = el.closest(".card");
      el.textContent = mmss(s);
      card.classList.toggle("warn", m >= WARN_MIN && m < BAD_MIN); card.classList.toggle("bad", m >= BAD_MIN);
    });
  }

  // ---------------------------------------------------------------- Marcar listo / deshacer
  function ready(ids, on) {
    // Se quita de la pantalla al instante; si falla, vuelve con la próxima lectura
    if (on) ids.forEach(function (id) { var b = document.querySelector('[data-item="' + id + '"]'); if (b) b.remove(); });
    document.querySelectorAll(".card").forEach(function (c) { if (!c.querySelector(".item")) c.remove(); });
    return q(sb.rpc("pos_kitchen_ready", { p_items: ids, p_ready: on })).then(load).catch(function (e) { alert("No se pudo guardar: " + (e.message || e)); load(); });
  }
  $("board").addEventListener("click", function (e) {
    var it = e.target.closest("[data-item]"); if (it) { ready([Number(it.dataset.item)], true); return; }
    var all = e.target.closest("[data-all]");
    if (all) { var ids = Array.prototype.map.call(all.closest(".card").querySelectorAll("[data-item]"), function (b) { return Number(b.dataset.item); }); ready(ids, true); }
  });
  $("recent").addEventListener("click", function (e) { var b = e.target.closest("[data-undo]"); if (b) ready([Number(b.dataset.undo)], false); });

  // ---------------------------------------------------------------- Sonido y pantalla completa
  function beep() {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22].forEach(function (d) { var o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.25, audio.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d + 0.18); o.start(audio.currentTime + d); o.stop(audio.currentTime + d + 0.2); });
    } catch (e) { /* sin sonido */ }
  }
  $("sound").addEventListener("click", function () { soundOn = !soundOn; this.classList.toggle("on", soundOn); this.textContent = soundOn ? "🔔 Sonido activo" : "🔔 Sonido"; if (soundOn) beep(); });
  $("full").addEventListener("click", function () { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); });
})();
