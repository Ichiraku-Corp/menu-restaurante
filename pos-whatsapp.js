// WhatsApp en caja: pedidos por aceptar, reservas y chats (parte de la caja; se carga antes de pos-caja)
"use strict";
// ---------------------------------------------------------------- WhatsApp (supabase/whatsapp.sql + función «whatsapp»)
// Pedidos por aceptar, reservas y chats. Si el SQL de WhatsApp aún no está instalado, todo esto se queda oculto.
var WA = { on: null, data: null, tab: "orders", conv: null, seen: {}, timer: null };
var PAY_WA = { pago_movil: "Pago móvil", zelle: "Zelle", binance: "Binance", paypal: "PayPal", efectivo: "Efectivo al recibir" };
function waStart() { if (WA.on === false) return; waPoll(); clearInterval(WA.timer); WA.timer = setInterval(function () { if (U && !document.hidden) waPoll(); }, 8000); }
function waStop() { clearInterval(WA.timer); show("btnWa", false); }
function waPoll() {
  if (!U) return Promise.resolve();
  return rpc("wa_pending").then(function (d) {
    WA.on = true; WA.data = d; show("btnWa", true);
    var n = d.orders.length + d.reservations.length, unread = num(d.unread);
    $("waBadge").textContent = n + unread; $("waBadge").classList.toggle("hidden", !(n + unread));
    var fresh = d.orders.concat(d.reservations).filter(function (x) { var k = (x.items ? "o" : "r") + x.id; var nw = !WA.seen[k]; WA.seen[k] = 1; return nw; });
    if (fresh.length && WA.primed) waBeep();
    WA.primed = true;
    drawBanners();
    if ($("waDlg").open) waDraw();
  }).catch(function (e) { if (/wa_pending|does not exist|schema cache/i.test(errMsg(e))) { WA.on = false; waStop(); } });
}
function waBeep() {
  try { var a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start();
    o.frequency.setValueAtTime(660, a.currentTime + 0.18); o.stop(a.currentTime + 0.4); } catch (e) {}
}
// Pide a la función que envíe ya los avisos que acaba de dejar caja (si falla, salen con el próximo mensaje).
function waFlush() { try { sb.functions.invoke("whatsapp", { body: { action: "flush" } }).catch(function () {}); } catch (e) {} }
function waOpen(tab) { if (tab) WA.tab = tab; WA.conv = null; $("waDlg").showModal(); waDraw(); waPoll(); }
$("btnWa").addEventListener("click", function () { waOpen(WA.data && WA.data.orders.length ? "orders" : WA.data && WA.data.reservations.length ? "res" : WA.tab); });
$("waClose").addEventListener("click", function () { $("waDlg").close(); });
$("waTabs").addEventListener("click", function (e) { var b = e.target.closest("[data-watab]"); if (!b) return; WA.tab = b.dataset.watab; WA.conv = null; waDraw(); });
function waWhen(ts) { return new Date(ts).toLocaleString("es-VE", { timeZone: "America/Caracas", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }); }
function waPhone(p) { return '<a href="https://wa.me/' + esc(p) + '" target="_blank" rel="noopener">+' + esc(p) + "</a>"; }
function waOrderCard(o, active) {
  var place = o.kind === "delivery" ? "🛵 Delivery" + (o.zone ? " · " + esc(o.zone) + " (" + ref(num(o.delivery_fee)) + ")" : "") : "🥡 Retiro en el local";
  var loc = o.location ? ' · <a href="https://maps.google.com/?q=' + num(o.location.latitude) + "," + num(o.location.longitude) + '" target="_blank" rel="noopener">ver en el mapa</a>' : "";
  var items = (o.items || []).map(function (x) { return "<li>" + num(x.qty) + " × " + esc(x.name) + (x.variant ? " (" + esc(x.variant) + ")" : "") + (x.option ? " " + esc(x.option) : "") +
    (x.notes ? ' <span class="muted">— ' + esc(x.notes) + "</span>" : "") + "</li>"; }).join("");
  var h = '<div class="wacard"><h3>' + (active ? esc(o.label || "") : place) + "</h3>";
  if (o.scheduled_for) h += '<p style="margin:2px 0"><b>🕒 Para: ' + esc(waWhen(o.scheduled_for)) + "</b></p>";
  h += '<p style="margin:2px 0">👤 <b>' + esc(o.customer_name || o.wa_name || "") + "</b>" + (o.doc_id ? " · " + esc(o.doc_id) : "") + " · " + waPhone(o.phone) + "</p>";
  if (o.kind === "delivery" && !active) h += '<p style="margin:2px 0">📍 ' + esc(o.address || "") + loc + "</p>";
  if (!active) {
    h += "<ul>" + items + "</ul>";
    h += '<p style="margin:2px 0"><b>Total ' + ref(num(o.total)) + "</b> (Bs " + nf2.format(num(o.total_bs)) + ") · 💳 " + esc(PAY_WA[o.payment_method] || o.payment_method) +
      (o.payment_ref ? " · ref. <b>" + esc(o.payment_ref) + "</b>" : "") + "</p>";
    if (o.payment_method === "binance" || o.payment_method === "paypal") h += '<p class="muted" style="margin:2px 0">Al cobrarlo en caja, el sistema comprueba solo el pago de ' + esc(PAY_WA[o.payment_method]) + ".</p>";
    h += '<p class="muted" style="margin:2px 0">Llegó ' + ago(o.submitted_at) + "</p>";
  }
  h += '<div class="actions">';
  if (o.payment_media && !active) h += '<button type="button" data-waimg="' + esc(o.payment_media) + '">Ver captura del pago</button>';
  if (active) h += '<button type="button" class="ok" data-waready="' + o.pos_order_id + '">' + (o.kind === "delivery" ? "🛵 Avisar: va en camino" : "🍜 Avisar: listo para retirar") + "</button>";
  else h += '<button type="button" class="danger" data-wareject="' + o.id + '">Rechazar</button><button type="button" class="primary" data-waaccept="' + o.id + '">Aceptar y enviar a cocina</button>';
  return h + "</div></div>";
}
function waDraw() {
  var d = WA.data || { orders: [], reservations: [], active: [], unread: 0 };
  var tabs = [["orders", "Pedidos", d.orders.length], ["res", "Reservas", d.reservations.length], ["chats", "Chats", num(d.unread)]];
  $("waTabs").innerHTML = tabs.map(function (t) { return '<button type="button" data-watab="' + t[0] + '"' + (WA.tab === t[0] ? ' class="on"' : "") + ">" + t[1] + (t[2] ? ' <span class="cnt">' + t[2] + "</span>" : "") + "</button>"; }).join("");
  var h = "";
  if (WA.tab === "orders") {
    h += d.orders.length ? d.orders.map(function (o) { return waOrderCard(o, false); }).join("") : '<p class="muted">No hay pedidos por aceptar.</p>';
    if ((d.active || []).length) h += '<h3 style="margin:18px 0 0">Aceptados: avisa al cliente cuando salga</h3>' + d.active.map(function (o) { return waOrderCard(o, true); }).join("");
  } else if (WA.tab === "res") {
    h += d.reservations.length ? d.reservations.map(function (r) {
      return '<div class="wacard"><h3>📅 ' + esc(waWhen(r.reserved_for)) + " · " + r.people + " persona" + (r.people > 1 ? "s" : "") + "</h3>" +
        '<p style="margin:2px 0">👤 <b>' + esc(r.name) + "</b> · " + waPhone(r.phone) + (r.area ? " · prefiere " + esc(r.area) : "") + "</p>" + (r.notes ? '<p class="muted">' + esc(r.notes) + "</p>" : "") +
        '<div class="actions"><button type="button" class="danger" data-wares="' + r.id + '" data-st="rechazada">No se puede</button><button type="button" class="primary" data-wares="' + r.id + '" data-st="confirmada">Confirmar</button></div></div>';
    }).join("") : '<p class="muted">No hay reservas por confirmar.</p>';
  } else if (WA.conv) {
    h += '<div id="waThread" class="muted">Cargando…</div>';
  } else {
    h += '<div id="waInbox" class="walist muted">Cargando…</div>';
  }
  $("waBody").innerHTML = h;
  if (WA.tab === "chats") (WA.conv ? waThread() : waInbox());
}
function waInbox() {
  rpc("wa_inbox", { p_limit: 60 }).then(function (list) {
    var el = $("waInbox"); if (!el) return;
    el.classList.remove("muted");
    el.innerHTML = list.length ? list.map(function (c) {
      return '<button type="button" data-waconv="' + c.id + '"><span><b>' + esc(c.name || ("+" + c.phone)) + (c.bot_paused ? " · 🙋 atiende una persona" : "") + "</b>" +
        '<span class="muted">' + esc(c.last || "") + "</span></span><span class=\"muted\" style=\"text-align:right;white-space:nowrap\">" + ago(c.last_msg_at) +
        (c.unread ? '<br><span class="wabadge">' + c.unread + "</span>" : "") + "</span></button>";
    }).join("") : '<p class="muted">Todavía no hay conversaciones.</p>';
  }).catch(fail);
}
function waThread() {
  var conv = WA.conv;
  rpc("wa_thread", { p_conv: conv.id }).then(function (msgs) {
    var el = $("waThread"); if (!el || !WA.conv || WA.conv.id !== conv.id) return;
    el.classList.remove("muted");
    el.innerHTML = '<div class="row between"><button type="button" id="waBack">← Chats</button><b>' + esc(conv.name || "") + " · " + waPhone(conv.phone) + "</b></div>" +
      '<div class="wachat" id="waMsgs">' + msgs.map(function (m) {
        return '<div class="wamsg ' + m.direction + '">' + esc(m.body) + "<small>" + new Date(m.created_at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) +
          (m.direction === "out" ? " · " + esc(m.sent_by || "") + (m.status === "error" ? " · ⚠ no se envió" : m.status === "leido" ? " · ✓✓ leído" : "") : "") + "</small></div>";
      }).join("") + "</div>" +
      (conv.in_window ? '<textarea id="waText" rows="2" placeholder="Escribe tu respuesta…" style="margin-top:8px"></textarea>' +
        '<div class="row between" style="margin-top:8px">' + (conv.bot_paused ? '<button type="button" id="waBot">🤖 Devolver al bot</button>' : '<span class="muted">Al responder, el bot se pausa en este chat.</span>') +
        '<button type="button" class="primary" id="waSend">Enviar</button></div>'
        : '<p class="muted">Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp no permite escribirle hasta que vuelva a escribir.</p>');
    var box = $("waMsgs"); box.scrollTop = box.scrollHeight;
    $("waBack").onclick = function () { WA.conv = null; waDraw(); waPoll(); };
    if ($("waBot")) $("waBot").onclick = function () { rpc("wa_set_paused", { p_conv: conv.id, p_paused: false }).then(function () { conv.bot_paused = false; toast("El bot vuelve a atender este chat"); waThread(); }).catch(fail); };
    if ($("waSend")) $("waSend").onclick = function () {
      var t = $("waText").value.trim(); if (!t) return;
      $("waSend").disabled = true;
      rpc("wa_reply", { p_conv: conv.id, p_text: t }).then(function () { conv.bot_paused = true; waFlush(); setTimeout(waThread, 1500); }).catch(function (e) { $("waSend").disabled = false; fail(e); });
    };
  }).catch(fail);
}
$("waBody").addEventListener("click", function (e) {
  var b = e.target.closest("button"); if (!b) return;
  if (b.dataset.waconv) {
    var c = null; rpc("wa_inbox", { p_limit: 60 }).then(function (list) {
      c = list.find(function (x) { return String(x.id) === b.dataset.waconv; }); if (!c) return; WA.conv = c; waDraw();
    }).catch(fail);
  } else if (b.dataset.waaccept) {
    if (!confirm("¿Aceptar este pedido? Se abre en caja y la comanda sale en cocina.")) return;
    b.disabled = true;
    rpc("wa_accept", { p_order: Number(b.dataset.waaccept) }).then(function () { toast("Pedido aceptado y enviado a cocina"); waFlush(); refreshState(); return waPoll(); })
      .catch(function (err) { b.disabled = false; fail(err); });
  } else if (b.dataset.wareject) {
    ask({ title: "Rechazar pedido", help: "Escribe el motivo. Se le envía al cliente por WhatsApp.", required: 3 }).then(function (r) {
      if (r === null) return;
      return rpc("wa_reject", { p_order: Number(b.dataset.wareject), p_reason: r }).then(function () { toast("Pedido rechazado; se avisó al cliente"); waFlush(); return waPoll(); });
    }).catch(fail);
  } else if (b.dataset.waready) {
    b.disabled = true;
    rpc("wa_notify_ready", { p_pos_order: Number(b.dataset.waready) }).then(function () { toast("Aviso enviado al cliente"); waFlush(); return waPoll(); })
      .catch(function (err) { b.disabled = false; fail(err); });
  } else if (b.dataset.wares) {
    var st = b.dataset.st;
    (st === "rechazada" ? ask({ title: "No se puede reservar", help: "Opcional: el motivo o una hora alternativa. Se le envía al cliente." }) : Promise.resolve(""))
      .then(function (note) {
        if (note === null) return;
        return rpc("wa_reservation_set", { p_id: Number(b.dataset.wares), p_status: st, p_note: note }).then(function () { toast(st === "confirmada" ? "Reserva confirmada" : "Se avisó al cliente"); waFlush(); return waPoll(); });
      }).catch(fail);
  } else if (b.dataset.waimg) {
    $("waImg").removeAttribute("src"); $("waImgHelp").textContent = "Cargando…"; $("waImgDlg").showModal();
    sb.functions.invoke("whatsapp", { body: { action: "media", id: b.dataset.waimg } }).then(function (r) {
      if (r.error || !(r.data instanceof Blob)) { $("waImgHelp").textContent = "No se pudo cargar la captura. Pídesela de nuevo al cliente."; return; }
      $("waImgHelp").textContent = "Compárala con el pago recibido antes de aceptar.";
      $("waImg").src = URL.createObjectURL(r.data);
    }).catch(function () { $("waImgHelp").textContent = "No se pudo cargar la captura."; });
  }
});
$("waImgClose").addEventListener("click", function () { $("waImgDlg").close(); var s0 = $("waImg").src; if (s0) URL.revokeObjectURL(s0); });
