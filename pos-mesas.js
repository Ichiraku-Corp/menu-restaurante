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
function priceOf(d, v) { var vs = variantsOf(d); if (!vs) return num(d.price); var x = vs.find(function (y) { return y.label === v; }); return x ? num(x.price) : num(d.price); }
function minPrice(d) { var vs = variantsOf(d); return vs ? Math.min.apply(null, vs.map(function (v) { return num(v.price); })) : num(d.price); }

// ---------------------------------------------------------------- Estado de sala
function refreshState() {
  return q(sb.rpc("pos_state")).then(function (s) {
    ST = s;
    $("rate").classList.toggle("bad", !s.rate);
    $("rate").textContent = s.rate ? "€ BCV " + nf2.format(s.rate) + (s.rate_date && s.rate_date !== today() ? " (de " + s.rate_date.slice(8, 10) + "/" + s.rate_date.slice(5, 7) + ")" : "") : "Sin tasa del día";
    if (!$("tablesView").classList.contains("hidden")) drawTables();
    drawBanners();
  });
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
  $("banners").innerHTML = h;
  var sbtn = $("alertsSeen"); if (sbtn) sbtn.onclick = function () { rpc("pos_alerts_seen").then(refreshState).catch(fail); };
  document.querySelectorAll("#banners [data-verify]").forEach(function (b) { b.onclick = function () {
    if (!confirm("¿Confirmas que viste este pago en tu teléfono (PayPal/Binance) y llegó completo?")) return;
    rpc("pos_payment_verify", { p_payment: Number(b.dataset.verify) }).then(function () { toast("Pago confirmado"); return refreshState(); }).catch(fail);
  }; });
}

// ---------------------------------------------------------------- Mesas
function goTables() {
  cur.order = null; cur.data = null; cur.cart = [];
  show("orderView", false); show("tablesView", true); syncBars();
  refreshState().then(drawTables).catch(fail);
}
function drawTables() {
  if (!ST) return;
  if (AREAS.indexOf(cur.area) >= 0) { try { localStorage.setItem("pos-last-area", cur.area); } catch (e) {} }
  setTimeout(syncBars, 0);
  $("areas").innerHTML = AREAS.concat(["Para llevar", "Delivery", "Por cobrar", "Tops"]).map(function (a) {
    var n = a === "Para llevar" ? ST.orders.filter(function (o) { return o.kind === "llevar"; }).length
      : a === "Delivery" ? ST.orders.filter(function (o) { return o.kind === "delivery"; }).length
      : a === "Por cobrar" ? ST.orders.length
      : a === "Tops" ? 0
      : ST.orders.filter(function (o) { var t = tableById(o.table_id); return t && t.area === a; }).length;
    return '<button type="button" data-area="' + esc(a) + '"' + (cur.area === a ? ' class="on"' : "") + ">" + esc(a) + (n ? ' <span class="cnt">' + n + "</span>" : "") + "</button>";
  }).join("");
  var due = ST.orders.reduce(function (s, o) { return s + num(o.total) - num(o.paid); }, 0), asked = ST.orders.filter(function (o) { return o.precuenta_at; }).length,
    busyT = ST.orders.filter(function (o) { return o.kind === "mesa"; }).length;
  $("summary").innerHTML = '<div class="s"><span>Mesas ocupadas</span><b>' + busyT + " / " + ST.tables.length + '</b></div><div class="s"><span>Por cobrar</span><b>' + ref(due) + "</b></div>" +
    '<div class="s"><span>Pidieron la cuenta</span><b>' + asked + "</b></div>" + '<div class="s"><span>Caja</span><b style="color:' + (ST.session ? "var(--ok)" : "var(--warn)") + '">' + (ST.session ? "Abierta" : "Cerrada") + "</b></div>";
  if (cur.area === "Para llevar" || cur.area === "Delivery") {
    var kind = cur.area === "Delivery" ? "delivery" : "llevar", list = ST.orders.filter(function (o) { return o.kind === kind; });
    $("areaBody").innerHTML = '<div class="tables">' + '<button type="button" id="' + (kind === "delivery" ? "newDeliv" : "newTogo") + '" class="new"><span class="num">+</span><small>Nuevo ' + (kind === "delivery" ? "delivery" : "para llevar") + "</small></button>" +
      list.map(function (o) { return tableCard(o, esc(o.label.replace(/^(Para llevar|Delivery): /, "") || cur.area), 'data-order="' + o.id + '"'); }).join("") + "</div>";
    return;
  }
  if (cur.area === "Tops") { drawTops(); return; }
  if (cur.area === "Por cobrar") {
    var all = ST.orders.slice().sort(function (a, b) { return (b.precuenta_at ? 1 : 0) - (a.precuenta_at ? 1 : 0) || new Date(a.opened_at) - new Date(b.opened_at); });
    var due = all.reduce(function (s, o) { return s + num(o.total) - num(o.paid); }, 0), asked = all.filter(function (o) { return o.precuenta_at; }).length;
    $("areaBody").innerHTML = '<div class="card"><div class="row between"><b style="font-size:20px">' + all.length + " pedidos abiertos · " + ref(due) + " por cobrar</b>" +
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
  $("areaBody").innerHTML = '<div class="legend"><span><i></i>Libre</span><span><i class="busy"></i>Comiendo</span><span><i class="bill"></i>Pidió la cuenta</span><span><i class="pend"></i>Platos sin enviar</span><span>Tiempo en naranja: más de 1 hora</span></div>' +
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
  var m = Math.round((Date.now() - new Date(o.opened_at).getTime()) / 60000), cls = (o.precuenta_at ? "bill" : "busy") + (o.pending ? " has-pend" : "");
  return '<button type="button" class="' + cls + '" ' + attr + '><span class="st">' + (o.precuenta_at ? "Pidió la cuenta" : o.items ? "Comiendo" : "Abierta") + '</span><span class="num">' + title + "</span>" +
    '<span class="amt">' + ref(num(o.total) - num(o.paid)) + "</span><small>" + esc(o.opened_by || "") + ' · <span class="' + (m >= 60 ? "late" : "") + '">' + mins(o.opened_at) + "</span></small>" + badges(o) + "</button>";
}
function minsSince(t) { return Math.round((Date.now() - new Date(t).getTime()) / 60000); }
function waitInfo(o) {
  if (o.precuenta_at && num(o.total) - num(o.paid) > 0.02 && minsSince(o.precuenta_at) >= 10) return "pidió la cuenta hace " + minsSince(o.precuenta_at) + " min";
  if (!o.items && minsSince(o.opened_at) >= 10) return "sin pedido hace " + minsSince(o.opened_at) + " min";
  return "";
}
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
