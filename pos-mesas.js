// Carta, estado de sala y mesas
"use strict";
// ---------------------------------------------------------------- Carta
function loadMenu() {
  return Promise.all([
    q(sb.from("categories").select("id,name,position").order("position")),
    q(sb.from("dishes").select("id,category_id,name,price,variants,options,available,position,photo_url").order("position"))
  ]).then(function (r) { MENU.cats = r[0]; MENU.dishes = r[1]; if (!cur.cat && MENU.cats[0]) cur.cat = MENU.cats[0].id; if (cur.order) drawMenu(); }).catch(fail);
}
setInterval(function () { if (U) loadMenu(); }, 60000);
function variantsOf(d) { return Array.isArray(d.variants) && d.variants.length ? d.variants : null; }
// Promociones de hoy (se crean en Gestión). La caja muestra el precio con la promo antes de enviar; el que vale es
// el que pone el servidor al anotar el plato (pos_add), con la misma regla.
var PROMOS = [];
function hhmmCaracas() { return new Date(Date.now() - 4 * 3600e3).toISOString().slice(11, 16); }
function promoOf(d) {
  if (!d || !PROMOS.length) return null;
  var t = hhmmCaracas(), best = null;
  PROMOS.forEach(function (p) {
    if (t < p.start || t >= p.end) return;
    if ((p.dish_ids || []).indexOf(d.id) < 0 && (p.category_ids || []).indexOf(d.category_id) < 0) return;
    if (!best || num(p.percent) > num(best.percent)) best = p;
  });
  return best;
}
function promoTxt(p) { return p ? p.name + " -" + nf2.format(num(p.percent)).replace(/,00$/, "") + " %" : ""; }
// El mismo redondeo que el servidor (round de Postgres): en centavos enteros, sin errores de coma flotante (1,50 −15 % = 1,28, no 1,27)
function promoPrice(d, base) { var p = promoOf(d); return p ? Math.round(Math.round(base * 100) * Math.round((100 - num(p.percent)) * 100) / 10000) / 100 : base; }
function priceOf(d, v) { var vs = variantsOf(d), x = vs && vs.find(function (y) { return y.label === v; }); return promoPrice(d, x ? num(x.price) : num(d.price)); }
function minPrice(d) { var vs = variantsOf(d); return promoPrice(d, vs ? Math.min.apply(null, vs.map(function (v) { return num(v.price); })) : num(d.price)); }
function loadPromos() { q(sb.rpc("menu_promos")).then(function (l) { PROMOS = l || []; if (cur.order) { drawMenu(); drawTicket(); } }).catch(function () { /* sin promociones: precios normales */ }); }

// ---------------------------------------------------------------- Estado de sala
// Indicador Internet · Laptop · Impresora: verde si funciona, rojo si no (al tocarlo explica qué pasa)
var HEALTH = {};
function healthDraw(okNet) {
  var off = typeof SR !== "undefined" && SR.on, now = Date.now(), h = {};
  h.net = okNet && !off ? ["ok", "Internet: conectado."] : ["bad", off ? "Sin internet: los pedidos siguen por la laptop y salen en cocina. Cobrar espera a que vuelva." : "Sin conexión con el sistema. Revisa el wifi de la tablet."];
  var seen = ST && ST.bridge_seen ? now - new Date(ST.bridge_seen).getTime() : null;
  h.lap = off ? ["unk", "Laptop: sin internet no se puede comprobar desde aquí."] : seen === null ? ["unk", "Laptop: todavía sin datos."]
    : seen < 90000 ? ["ok", "Laptop de caja: encendida y conectada."] : ["bad", "La laptop de caja no se conecta desde hace " + Math.round(seen / 60000) + " min: no salen comandas ni tickets. Revisa que esté encendida, con internet y con el puente abierto."];
  var late = ST && ST.printer_oldest && now - new Date(ST.printer_oldest).getTime() > 60000;
  h.prn = off ? ["unk", "Impresora: sin internet no se puede comprobar desde aquí."] : ST && num(ST.printer_error) ? ["bad", "La impresora dio error: " + (ST.printer_error_msg || "revisa que esté encendida y con papel") + "."]
    : late ? ["bad", "Hay " + (ST.printer_backlog || "") + " tickets esperando más de un minuto: revisa la laptop y la impresora."] : ["ok", "Impresora: imprimiendo al día."];
  HEALTH = h;
  var el = $("health"); if (!el) return;
  el.classList.toggle("hidden", !U);
  Object.keys(h).forEach(function (k) { var s = el.querySelector('[data-h="' + k + '"]'); if (s) s.className = h[k][0]; });
  el.classList.toggle("alarm", Object.keys(h).some(function (k) { return h[k][0] === "bad"; }));
}
$("health").addEventListener("click", function () {
  var bad = Object.keys(HEALTH).filter(function (k) { return HEALTH[k][0] === "bad"; });
  if (bad.length) notice(bad.map(function (k) { return HEALTH[k][1]; }).join(" "), "err");
  else notice(Object.keys(HEALTH).map(function (k) { return HEALTH[k][1]; }).join(" "), "ok");
});
function refreshState() {
  return q(sb.rpc("pos_state")).then(function (s) {
    ST = s; healthDraw(true); readyCheck(s);
    $("rate").classList.toggle("bad", !s.rate);
    $("rate").textContent = s.rate ? "€ BCV " + nf2.format(s.rate) + (s.rate_date && s.rate_date !== today() ? " (de " + s.rate_date.slice(8, 10) + "/" + s.rate_date.slice(5, 7) + ")" : "") : "Sin tasa del día";
    if (!$("tablesView").classList.contains("hidden")) drawTables();
    drawBanners();
  }, function (e) { healthDraw(false); throw e; });
}
// Plato listo: cuando cocina marca listo un plato de una mesa que abrí yo (o, si cobro, de un pedido para llevar
// o delivery), la tablet suena, vibra y avisa abajo; tocar el aviso abre el pedido.
var READY = null;
function readyMine(o) {
  if (!U) return false;
  var mine = o.opened_by_id != null ? o.opened_by_id === U.id : o.opened_by === U.name;
  return mine || (o.kind !== "mesa" && !!U.charge);
}
function readyCheck(s) {
  var now = {}, news = [];
  (s.orders || []).forEach(function (o) {
    var r = num(o.ready); now[o.id] = r;
    if (READY && r > (READY[o.id] || 0) && readyMine(o)) news.push(o);
  });
  READY = now;
  if (!news.length) return;
  chime(); readyNote(news);
}
function readyNote(list) {
  var n = $("readyNote");
  if (!n) {
    n = document.createElement("button"); n.type = "button"; n.id = "readyNote"; document.body.appendChild(n);
    n.addEventListener("click", function () { n.classList.remove("show"); var id = Number(n.dataset.order); if (id && U) openOrder(id); });
  }
  n.innerHTML = '<span class="rn">🍜</span><span><b>Listo en cocina</b> · ' + esc(list.map(function (o) { return o.label + ": " + o.ready + (num(o.ready) === 1 ? " plato" : " platos"); }).join(" · ")) +
    '</span><span class="rv">Ver</span>';
  n.dataset.order = list[0].id;
  n.classList.add("show"); clearTimeout(readyNote._t); readyNote._t = setTimeout(function () { n.classList.remove("show"); }, 12000);
}
function today() { return new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10); }
setInterval(function () { if (U && !document.hidden) refreshState().catch(function () {}); }, 5000);
function drawBanners() {
  var h = "";
  if (!ST.session) h += '<div class="banner warn">La caja está cerrada. Para cobrar, ábrela en «Caja».</div>';
  if (!ST.rate) h += '<div class="banner warn">No hay tasa del euro BCV. Escríbela en «Caja» para poder cobrar en bolívares.</div>';
  if (ST.printer_oldest && Date.now() - new Date(ST.printer_oldest).getTime() > 60000)
    h += '<div class="banner">La impresión está atrasada (' + ST.printer_backlog + ' pendientes). Revisa que la laptop de caja y su puente de impresión estén encendidos.</div>';
  var unv = ST.unverified || [];
  if (unv.length && U && U.charge) h += '<div class="banner alert"><b>⚠ Pagos sin confirmar (' + unv.length + "):</b> no aparecieron en la plataforma. Revísalos en el teléfono.<ul>" + unv.map(function (x) {
    return "<li>" + esc(x.label) + " · " + (x.method === "paypal" ? "PayPal" : "Binance") + " " + nf2.format(num(x.amount)) + (x.reference ? " · ref. " + esc(x.reference) : "") + " · " + esc(x.by || "") + " · " + ago(x.at) +
      ' <button type="button" data-verify="' + x.id + '" style="min-height:32px;padding:4px 10px;font-size:13px">Ya lo vi, llegó</button></li>';
  }).join("") + "</ul></div>";
  var low = ST.low_stock || [];
  if (low.length && U && U.charge) h += '<div class="banner warn"><b>Queda poco afuera:</b> ' + low.map(function (x) { return esc(x.name) + " (" + (num(x.stock) <= 0 ? "AGOTADO" : fmtQ(x.stock)) + ")"; }).join(" · ") + " · Cuando llegue, regístralo en Caja → Llegó mercancía.</div>";
  var al = (ST.alerts || []);
  if (al.length && U && U.charge) h += '<div class="banner alert"><b>⚠ Cobros hechos fuera de la caja (' + al.length + ")</b><ul>" + al.map(function (a) {
    return "<li>" + new Date(a.at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) + " · <b>" + esc(a.by || "") + "</b> cobró " + esc(a.label) + " · " + ref(num(a.amount_ref)) + " desde «" + esc(a.device) + "»</li>";
  }).join("") + '</ul><button type="button" id="alertsSeen">Visto</button></div>';
  // Mesas esperando: pidieron la cuenta hace más de 10 min sin cobrar, o abiertas más de 10 min sin ningún plato
  var wait = ST.orders.filter(function (o) { return waitInfo(o); });
  if (wait.length) h += '<div class="banner warn"><b>Mesas esperando (' + wait.length + "):</b> " + wait.map(function (o) { return esc(o.label) + " — " + waitInfo(o); }).join(" · ") + "</div>";
  if (typeof WA !== "undefined" && WA.data && WA.data.orders.length) h = '<div class="banner alert"><b>📱 WhatsApp: ' + WA.data.orders.length + " pedido" + (WA.data.orders.length > 1 ? "s" : "") +
    ' por aceptar</b><span class="grow"></span><button type="button" id="waBanner">Ver pedidos</button></div>' + h;
  $("banners").innerHTML = h;
  var wb = $("waBanner"); if (wb) wb.onclick = function () { waOpen("orders"); };
  var sbtn = $("alertsSeen"); if (sbtn) sbtn.onclick = function () { rpc("pos_alerts_seen").then(refreshState).catch(fail); };
  document.querySelectorAll("#banners [data-verify]").forEach(function (b) { b.onclick = function () {
    if (!confirm("¿Confirmas que viste este pago en tu teléfono (PayPal/Binance) y llegó completo?")) return;
    rpc("pos_payment_verify", { p_payment: Number(b.dataset.verify) }).then(function () { toast("Pago confirmado"); return refreshState(); }).catch(fail);
  }; });
}

// Meta del día (solo quien cobra): promedio de ese día de la semana en las últimas 8 semanas contra lo cobrado hoy
var META = null;
function loadMeta() {
  if (!U || !U.charge) { META = null; return; }
  rpc("pos_meta").then(function (m) { META = m; if (ST && !$("tablesView").classList.contains("hidden")) drawTables(); }).catch(function () { /* sin la meta, la caja sigue igual */ });
}
setInterval(function () { if (U && U.charge && !document.hidden) loadMeta(); }, 60000);
function metaTile() {
  if (!U || !U.charge || !META || !num(META.meta)) return "";
  var meta = num(META.meta), v = num(META.vendido), p = Math.round(v / meta * 100), r0 = function (n) { return "Ref " + Math.round(n).toLocaleString("es-VE"); };
  return '<div class="s meta' + (v >= meta ? " done" : "") + '"><span>Meta de hoy · ' + p + " %" + (v >= meta ? " ✓" : "") + "</span><b>" + r0(v) + ' <small>de ' + r0(meta) + "</small></b>" +
    '<i class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(p, 100) + '"><i style="width:' + Math.min(p, 100) + '%"></i></i></div>';
}

// ---------------------------------------------------------------- Mesas
function goTables(noSoltar) {
  // Al volver al mapa, la mesa queda libre de inmediato (salvo que ya la haya tomado otra persona)
  if (cur.order && noSoltar !== true && U && !attOff()) rpc("pos_soltar", { p_order: cur.order, p_device: attDev() }).catch(function () {});
  cur.order = null; cur.data = null; cur.cart = [];
  show("orderView", false); show("tablesView", true); syncBars();
  refreshState().then(drawTables).catch(fail);
}
function drawTables() {
  if (!ST) return;
  if (AREAS.indexOf(cur.area) >= 0) { try { localStorage.setItem("pos-last-area", cur.area); } catch (e) {} }
  setTimeout(syncBars, 0);
  $("areas").innerHTML = AREAS.concat(["Para llevar", "Delivery", "Por cobrar", "Tops"]).map(function (a) {
    var n = a === "Para llevar" ? ST.orders.filter(function (o) { return o.kind === "llevar"; }).length + (ST.entregar || []).length
      : a === "Delivery" ? ST.orders.filter(function (o) { return o.kind === "delivery"; }).length
      : a === "Por cobrar" ? ST.orders.length
      : a === "Tops" ? 0
      : ST.orders.filter(function (o) { var t = tableById(o.table_id); return t && t.area === a; }).length;
    return '<button type="button" data-area="' + esc(a) + '"' + (cur.area === a ? ' class="on"' : "") + ">" + esc(a) + (n ? ' <span class="cnt">' + n + "</span>" : "") + "</button>";
  }).join("");
  var due = ST.orders.reduce(function (s, o) { return s + num(o.total) - num(o.paid); }, 0), asked = ST.orders.filter(function (o) { return o.precuenta_at; }).length,
    busyT = ST.orders.filter(function (o) { return o.kind === "mesa"; }).length;
  $("summary").innerHTML = '<div class="s"><span>Mesas ocupadas</span><b>' + busyT + " / " + ST.tables.length + '</b></div><div class="s"><span>Por cobrar</span><b>' + ref(due) + "</b></div>" +
    '<div class="s"><span>Pidieron la cuenta</span><b>' + asked + "</b></div>" + '<div class="s"><span>Caja</span><b style="color:' + (ST.session ? "var(--ok)" : "var(--warn)") + '">' + (ST.session ? "Abierta" : "Cerrada") + "</b></div>" + metaTile();
  if (cur.area === "Para llevar" || cur.area === "Delivery") {
    var kind = cur.area === "Delivery" ? "delivery" : "llevar", list = ST.orders.filter(function (o) { return o.kind === kind; }), ent = kind === "llevar" ? ST.entregar || [] : [];
    // Ya cobrados y listos en cocina: al entregarlos salen de la pantalla de pedidos listos
    $("areaBody").innerHTML = (ent.length ? '<div class="card entregar"><b>Listos para entregar</b> <span class="muted">(ya cobrados)</span><div class="row" style="margin-top:8px">' +
      ent.map(function (x) { return '<button type="button" class="readybtn" data-entregar="' + Number(x.id) + '">🍜 #' + esc(String(x.n)) + " · Entregado ✓</button>"; }).join("") + "</div></div>" : "") +
      '<div class="tables">' + '<button type="button" id="' + (kind === "delivery" ? "newDeliv" : "newTogo") + '" class="new"><span class="num">+</span><small>Nuevo ' + (kind === "delivery" ? "delivery" : "para llevar") + "</small></button>" +
      list.map(function (o) { return tableCard(o, esc(o.label.replace(/^(Para llevar|Delivery): /, "") || cur.area), 'data-order="' + o.id + '"'); }).join("") + "</div>";
    return;
  }
  if (cur.area === "Tops") { drawTops(); return; }
  if (cur.area === "Por cobrar") {
    var all = ST.orders.slice().sort(function (a, b) { return (b.precuenta_at ? 1 : 0) - (a.precuenta_at ? 1 : 0) || new Date(a.opened_at) - new Date(b.opened_at); });
    var due = all.reduce(function (s, o) { return s + num(o.total) - num(o.paid); }, 0), asked = all.filter(function (o) { return o.precuenta_at; }).length;
    $("areaBody").innerHTML = '<div class="card"><div class="row between"><b style="font-size:20px">' + all.length + (all.length === 1 ? " pedido abierto · " : " pedidos abiertos · ") + ref(due) + " por cobrar</b>" +
      '<span class="muted">' + asked + " pidieron la cuenta</span></div>" + (all.length && window.innerWidth <= 560 ? '<div class="duecards">' + all.map(function (o) {
        return '<button type="button" data-order="' + o.id + '"><b>' + esc(o.label) + '</b><b class="n">' + ref(num(o.total) - num(o.paid)) + "</b><small>" + esc(o.opened_by || "") + " · " + mins(o.opened_at) + "</small><small style=\"text-align:right\">" +
          (o.precuenta_at ? '<span class="pill bill">pidió la cuenta</span>' : '<span class="pill eat">comiendo</span>') + (num(o.paid) > 0 ? ' <span class="pill paid">abonó</span>' : "") + "</small></button>";
      }).join("") + "</div>" : all.length ? '<table class="tbl" style="margin-top:8px"><thead><tr><th>Pedido</th><th>Tiempo</th><th>Estado</th><th class="r">Total</th><th class="r">Falta</th></tr></thead><tbody>' +
      all.map(function (o) { return '<tr data-order="' + o.id + '" style="cursor:pointer"><td><b>' + esc(o.label) + '</b><div class="muted">' + esc(o.opened_by || "") + "</div></td><td>" + mins(o.opened_at) + "</td><td>" +
        (o.precuenta_at ? '<span class="pill bill">pidió la cuenta</span>' : '<span class="pill eat">comiendo</span>') +
        (num(o.paid) > 0 ? ' <span class="pill paid">abonó ' + ref(num(o.paid)) + "</span>" : "") + '</td><td class="r">' + ref(o.total) + '</td><td class="r"><b>' + ref(num(o.total) - num(o.paid)) + "</b></td></tr>"; }).join("") +
      "</tbody></table>" : '<p class="muted">No hay mesas por cobrar.</p>') + "</div>";
    return;
  }
  var tables = ST.tables.filter(function (t) { return t.area === cur.area; });
  $("areaBody").innerHTML = '<div class="legend"><span><i></i>Libre</span><span><i class="busy"></i>Comiendo</span><span><i class="bill"></i>Pidió la cuenta</span><span><i class="pend"></i>Platos sin enviar</span><span><i class="att"></i>Tomando pedido</span><span>Tiempo en naranja: más de 1 hora</span></div>' +
    '<div class="tables">' + tables.map(function (t) {
    var o = ST.orders.find(function (x) { return x.table_id === t.id; });
    return o ? tableCard(o, String(t.number), 'data-table="' + t.id + '"')
      : '<button type="button" data-table="' + t.id + '"><span class="st">Libre</span><span class="num">' + t.number + "</span><small>&nbsp;</small></button>";
  }).join("") + "</div>";
}
var topsCache = null, topsAt = 0;
function drawTops() {
  if (!topsCache || Date.now() - topsAt > 30000) {
    topsAt = Date.now();
    q(sb.rpc("pos_tops")).then(function (t) { topsCache = t; if (cur.area === "Tops") drawTops(); }).catch(fail);
    if (!topsCache) { $("areaBody").innerHTML = '<p class="muted">Cargando…</p>'; return; }
  }
  var medals = ["#d4a017", "#9aa3ad", "#b8733a"];
  function block(title, sub, rows) {
    var max = rows.length ? num(rows[0].sales) : 0;
    return '<div class="card topcard"><div class="row between"><h3>' + title + '</h3><span class="muted">' + sub + "</span></div>" +
      (rows.length ? (function () {
        var w = rows[0];
        return '<div class="winner">' + avatar(w.name, w.id) + '<div><span class="muted">Mejor vendedor</span><b>' + esc(w.name) + "</b></div><b class=\"n big\">" + ref(num(w.sales)) + "</b></div>" +
          '<ol class="rank">' + rows.map(function (r, i) {
            return '<li><span class="pos" style="background:' + (medals[i] || "var(--chip)") + ";color:" + (i < 3 ? "#fff" : "var(--text)") + '">' + (i + 1) + "</span>" + avatar(r.name, r.id) +
              '<span class="nm">' + esc(r.name) + '<small>' + fmtQ(r.items) + (num(r.items) === 1 ? " plato · " : " platos · ") + r.orders + (r.orders === 1 ? " pedido" : " pedidos") + '</small></span><span class="br"><i style="width:' + (max ? num(r.sales) / max * 100 : 0).toFixed(1) + '%"></i></span><b class="n">' + ref(num(r.sales)) + "</b></li>";
          }).join("") + "</ol>";
      })() : '<p class="muted">Todavía no hay ventas cobradas.</p>') + "</div>";
  }
  function dm(s) { return s ? s.slice(8, 10) + "/" + s.slice(5, 7) : ""; }
  var t = topsCache;
  $("areaBody").innerHTML = '<p class="muted" style="margin:6px 2px 0">Cada plato cuenta para quien lo pidió. Solo lo cobrado, sin anulaciones ni el 10 % de servicio.</p><div class="tops">' +
    block("Hoy", dm(t.day.from), t.day.rows) + block("Esta semana", dm(t.week.from) + " al " + dm(t.week.to), t.week.rows) + block("Este mes", dm(t.month.from) + " al " + dm(t.month.to), t.month.rows) + "</div>";
}
function tableCard(o, title, attr) {
  var at = o.atiende && !attMine(o.atiende) ? o.atiende : null;  // alguien está tomando el pedido ahora mismo
  var m = Math.round((Date.now() - new Date(o.opened_at).getTime()) / 60000), cls = (o.precuenta_at ? "bill" : "busy") + (o.pending ? " has-pend" : "") + (at ? " att" : "");
  return '<button type="button" class="' + cls + '" ' + attr + '><span class="st">' + (at ? "Tomando pedido" : o.precuenta_at ? "Pidió la cuenta" : o.items ? "Comiendo" : "Abierta") + '</span><span class="num">' + title + "</span>" +
    (at ? '<span class="pill att">' + esc(at.name || "Alguien") + "</span>" : "") +
    '<span class="amt">' + ref(num(o.total) - num(o.paid)) + "</span><small>" + esc(o.opened_by || "") + ' · <span class="' + (m >= 60 ? "late" : "") + '">' + mins(o.opened_at) + "</span></small>" + badges(o) + "</button>";
}
function minsSince(t) { return Math.round((Date.now() - new Date(t).getTime()) / 60000); }
function waitInfo(o) {
  if (o.precuenta_at && num(o.total) - num(o.paid) > 0.02 && minsSince(o.precuenta_at) >= 10) return "pidió la cuenta hace " + minsSince(o.precuenta_at) + " min";
  if (!o.items && minsSince(o.opened_at) >= 10) return "sin pedido hace " + minsSince(o.opened_at) + " min";
  return "";
}
$("areaBody").addEventListener("click", function (e) {
  var b = e.target.closest("[data-entregar]"); if (!b) return;
  b.disabled = true;
  rpc("pos_served", { p_order: Number(b.dataset.entregar) }).then(function () { toast("Entregado: sale de la pantalla de pedidos listos"); return refreshState(); })
    .catch(function (er) { b.disabled = false; fail(er); });
});
$("served").addEventListener("click", function () {
  rpc("pos_served", { p_order: cur.order }).then(function (n) { toast(n ? "Listo: " + n + " servido" + (n === 1 ? "" : "s") : "Nada pendiente"); show("served", false); return refreshState(); }).catch(fail);
});
function badges(o) {
  return (o.ready ? '<span class="pill ready">🍜 ' + o.ready + " listo" + (o.ready === 1 ? "" : "s") + "</span>" : "") + (waitInfo(o) ? '<span class="pill wait">esperando</span>' : "") + (o.pending ? '<span class="pend">sin enviar</span>' : "") + (num(o.paid) > 0 ? '<span class="pill paid">abonó ' + ref(num(o.paid)) + "</span>" : "");
}
function tableById(id) { return ST && ST.tables.find(function (t) { return t.id === id; }); }
function mins(ts) { var m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000)); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60) + " min"; }
$("areas").addEventListener("click", function (e) {
  var b = e.target.closest("[data-area]"); if (!b) return;
  cur.area = b.dataset.area; try { localStorage.setItem("pos-area", cur.area); } catch (e2) {}
  drawTables();
});
$("areaBody").addEventListener("click", function (e) {
  var b = e.target.closest("button, tr[data-order]"); if (!b) return;
  if (b.id === "newDeliv") { delivForm(null); return; }
  if (b.id === "newTogo") {
    ask({ title: "Nuevo pedido para llevar", help: "Nombre del cliente (opcional)", value: "" }).then(function (name) {
      if (name === null) return;
      return rpc("pos_open", { p_table: null, p_label: name }).then(openOrder);
    }).catch(fail);
  } else if (b.dataset.order) openOrder(Number(b.dataset.order));
  else if (b.dataset.table) {
    var t = tableById(Number(b.dataset.table)), o = ST.orders.find(function (x) { return x.table_id === t.id; });
    if (o) openOrder(o.id);
    else rpc("pos_open", { p_table: t.id }).then(openOrder).catch(fail);
  }
});
