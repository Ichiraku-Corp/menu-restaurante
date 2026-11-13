// Pedido, cliente, delivery y cuenta dividida
"use strict";
// ---------------------------------------------------------------- Pedido
function openOrder(id) {
  cur.order = id; cur.cart = []; $("search").value = "";
  show("tablesView", false); show("orderView", true); syncBars(); $("orderGrid").classList.remove("show-menu");
  if (window.innerWidth <= 820) $("orderGrid").classList.add("show-menu");
  $("toggleMenu").textContent = $("orderGrid").classList.contains("show-menu") ? "Ver cuenta" : "Carta";
  drawMenu(); return loadOrder();
}
function loadOrder() {
  if (!cur.order) return Promise.resolve();
  return q(sb.rpc("pos_order", { p_order: cur.order })).then(function (d) {
    if (!d || d.status !== "abierta") { toast(d ? "Este pedido ya se cerró" : "Pedido no encontrado"); goTables(); return; }
    cur.data = d; drawTicket();
  }).catch(fail);
}
setInterval(function () { if (U && cur.order && !document.hidden && !anyDialogOpen()) loadOrder(); }, 6000);
$("back").addEventListener("click", function () {
  if (cur.cart.length && !confirm("Hay " + cur.cart.length + " platos sin enviar a cocina. ¿Salir y descartarlos?")) return;
  // mesa abierta por error: se borra sola al salir si no tiene platos
  if (cur.data && !cur.data.items.length && !cur.cart.length) rpc("pos_drop_empty", { p_order: cur.order }).then(refreshState).catch(function () {});
  goTables();
});
$("toggleMenu").addEventListener("click", function () {
  var g = $("orderGrid"); g.classList.toggle("show-menu");
  this.textContent = g.classList.contains("show-menu") ? "Ver cuenta (" + (cur.cart.length + (cur.data ? cur.data.items.filter(function (i) { return i.status !== "anulado"; }).length : 0)) + ")" : "Carta";
});

function drawMenu() {
  var term = $("search").value.trim().toLowerCase();
  $("cats").innerHTML = MENU.cats.map(function (c) { return '<button type="button" data-cat="' + c.id + '"' + (!term && cur.cat === c.id ? ' class="on"' : "") + ">" + esc(c.name) + "</button>"; }).join("");
  var list = MENU.dishes.filter(function (d) { return term ? d.name.toLowerCase().indexOf(term) >= 0 : d.category_id === cur.cat; });
  $("dishes").innerHTML = list.map(function (d) {
    var img = d.photo_url && /^(assets\/|data:image\/|https:\/\/)/.test(d.photo_url) ? '<img src="' + esc(d.photo_url) + '" alt="" loading="lazy">' : '<span class="ph">' + esc(d.name.charAt(0)) + "</span>";
    return '<button type="button" data-dish="' + d.id + '"' + (d.available ? "" : " disabled") + ">" + img + '<span class="tx"><b>' + esc(d.name) + "</b>" +
      "<span>" + (d.available ? (variantsOf(d) ? "desde " : "") + ref(minPrice(d)) : "Agotado") + "</span></span></button>";
  }).join("") || '<p class="muted">Sin resultados.</p>';
}
$("search").addEventListener("input", drawMenu);
$("cats").addEventListener("click", function (e) { var b = e.target.closest("[data-cat]"); if (!b) return; cur.cat = Number(b.dataset.cat); $("search").value = ""; drawMenu(); });
$("dishes").addEventListener("click", function (e) {
  var b = e.target.closest("[data-dish]"); if (!b) return;
  var d = MENU.dishes.find(function (x) { return x.id === Number(b.dataset.dish); });
  if (!d) return;
  pickDish(d); // todos los platos abren la ventanita: cantidad, opciones y nota para cocina
});
var pick = null;
function pickDish(d) {
  pick = { dish: d, variant: "", option: "", qty: 1 };
  var vs = variantsOf(d), ops = d.options || [];
  $("dishTitle").textContent = d.name;
  $("dishVariants").innerHTML = vs ? '<div class="muted">Tamaño</div><div class="chips">' + vs.map(function (v) { return '<button type="button" data-v="' + esc(v.label) + '">' + esc(v.label) + " · " + ref(num(v.price)) + "</button>"; }).join("") + "</div>" : "";
  $("dishOptions").innerHTML = ops.length ? '<div class="muted">Elige una opción</div><div class="chips">' + ops.map(function (o) { return '<button type="button" data-o="' + esc(o) + '">' + esc(o) + "</button>"; }).join("") + "</div>" : "";
  if (vs && vs.length === 1) pick.variant = vs[0].label;
  $("qVal").textContent = "1"; $("dishNote").value = ""; markPick();
  $("dishDlg").showModal();
}
function markPick() {
  document.querySelectorAll("#dishVariants [data-v]").forEach(function (b) { b.classList.toggle("on", b.dataset.v === pick.variant); });
  document.querySelectorAll("#dishOptions [data-o]").forEach(function (b) { b.classList.toggle("on", b.dataset.o === pick.option); });
}
$("dishVariants").addEventListener("click", function (e) { var b = e.target.closest("[data-v]"); if (b) { pick.variant = b.dataset.v; markPick(); } });
$("dishOptions").addEventListener("click", function (e) { var b = e.target.closest("[data-o]"); if (b) { pick.option = b.dataset.o; markPick(); } });
$("qMinus").addEventListener("click", function () { pick.qty = Math.max(1, pick.qty - 1); $("qVal").textContent = pick.qty; });
$("qPlus").addEventListener("click", function () { pick.qty = Math.min(50, pick.qty + 1); $("qVal").textContent = pick.qty; });
$("dishCancel").addEventListener("click", function () { $("dishDlg").close(); });
$("dishAdd").addEventListener("click", function () {
  if (variantsOf(pick.dish) && !pick.variant) return toast("Elige el tamaño", true);
  if ((pick.dish.options || []).length && !pick.option) return toast("Elige una opción (" + pick.dish.options.join(" / ") + ")", true);
  pick.notes = $("dishNote").value.trim(); addToCart(pick); $("dishDlg").close();
});
function addToCart(p) {
  var same = cur.cart.find(function (c) { return c.dish.id === p.dish.id && c.variant === p.variant && c.option === p.option && c.notes === p.notes && !p.notes; });
  if (same) same.qty += p.qty; else cur.cart.push({ dish: p.dish, variant: p.variant, option: p.option, qty: p.qty, notes: p.notes || "" });
  toast("+" + p.qty + " " + p.dish.name + (p.variant ? " " + p.variant : ""));
  try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {}
  var btn = document.querySelector('#dishes [data-dish="' + p.dish.id + '"]'); if (btn) { btn.classList.remove("flash"); void btn.offsetWidth; btn.classList.add("flash"); }
  drawTicket();
}

function drawTicket() {
  var d = cur.data; if (!d) return;
  $("orderTitle").innerHTML = esc(d.label) + (d.day_number ? "<small>Orden #" + d.day_number + "</small>" : "");
  $("btnClient").innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><span>' +
    (d.client ? esc(d.client.name) : "Cliente") + "</span>";
  $("btnClient").classList.toggle("has", !!d.client);
  var so = ST && ST.orders.find(function (x) { return x.id === d.id; }), rd = so ? so.ready || 0 : 0;
  show("served", rd > 0); $("servedTxt").textContent = rd + (rd === 1 ? " plato listo en cocina" : " platos listos en cocina");
  $("orderMeta").innerHTML = d.kind === "mesa" ? "Servicio " + num(d.service_pct) + " %" : d.kind === "delivery"
    ? 'Delivery · ' + esc(d.phone || "sin teléfono") + ' <button type="button" id="editDeliv" style="min-height:32px;padding:4px 10px;font-size:13px">Editar datos</button><div class="muted" style="font-weight:400">' + esc(d.address || "Sin dirección") + "</div>"
    : "Para llevar (sin servicio)";
  $("orderBy").textContent = "Abrió " + (d.opened_by || "") + " · " + mins(d.opened_at);
  var h = "";
  d.items.forEach(function (i) {
    var cls = i.status === "anulado" ? "void" : "click";
    h += '<div class="line ' + cls + '" data-item="' + i.id + '"><span class="q">' + fmtQ(i.qty) + '</span><span class="t">' + esc(i.name) + (i.variant ? " " + esc(i.variant) : "") +
      (i.option ? "<small>" + esc(i.option) + "</small>" : "") + (i.notes ? "<small>» " + esc(i.notes) + "</small>" : "") +
      (i.status === "anulado" ? "<small>Anulado: " + esc(i.void_reason) + "</small>" : i.status === "pendiente" ? "<small>sin enviar</small>" : "") +
      '</span><span class="p">' + ref(num(i.qty) * num(i.unit_price)) + personDots(d, i) + "</span></div>";
  });
  cur.cart.forEach(function (c, ix) {
    h += '<div class="line new" data-cart="' + ix + '"><span class="qty"><button type="button" data-dec aria-label="Uno menos">−</button><b>' + c.qty + '</b><button type="button" data-inc aria-label="Uno más">+</button></span><span class="t"><span>' + esc(c.dish.name) + (c.variant ? " " + esc(c.variant) : "") + "</span>" +
      (c.option ? "<small>" + esc(c.option) + "</small>" : "") + (c.notes ? "<small>» " + esc(c.notes) + "</small>" : "") + '<small>nuevo, sin enviar · toca para ' + (c.notes ? "cambiar la nota" : "agregar nota") + '</small></span><span class="p">' +
      ref(c.qty * priceOf(c.dish, c.variant)) + "</span></div>";
  });
  $("lines").innerHTML = h || '<p class="emptyline">Sin platos todavía.<br>Elige de la carta.</p>';
  var t = d.totals, cartSum = cur.cart.reduce(function (s, c) { return s + c.qty * priceOf(c.dish, c.variant); }, 0), rate = ST && ST.rate;
  var sub = num(t.subtotal) + cartSum, disc = Math.min(num(t.discount), sub), svc = Math.round((sub - disc) * num(d.service_pct)) / 100, dl = num(t.delivery), tot = sub - disc + svc + dl, paid = num(t.paid);
  cur.due = tot - paid;
  $("totals").innerHTML = '<div class="tot"><span>Subtotal</span><span>' + ref(sub) + "</span></div>" +
    (disc ? '<div class="tot"><span>Descuento' + (d.discount_reason ? " (" + esc(d.discount_reason) + ")" : "") + "</span><span>−" + ref(disc) + "</span></div>" : "") +
    (svc ? '<div class="tot"><span>Servicio ' + num(d.service_pct) + " %</span><span>" + ref(svc) + "</span></div>" : "") +
    (dl ? '<div class="tot"><span>Delivery</span><span>' + ref(dl) + "</span></div>" : "") +
    '<div class="tot big"><span>Total</span><span>' + ref(tot) + "</span></div>" +
    (paid ? '<div class="tot"><span>Abonado</span><span>−' + ref(paid) + '</span></div><div class="tot big"><span>Falta</span><span>' + ref(tot - paid) + "</span></div>" : "") +
    (rate ? '<div class="tot muted"><span>En bolívares</span><span>' + bs(Math.round((tot - paid) * rate * 100) / 100) + "</span></div>" : "") +
    (splitN(d) ? '<div class="psum">' + (d.split_totals || []).map(function (x) {
      var okp = x.person > 0 && num(x.paid) >= num(x.total) - 0.02 && num(x.total) > 0;
      return '<span style="--pc:' + pcol(x.person) + '"><i class="pdot' + (x.person ? "" : " none") + '"></i>' + (x.person ? "P" + x.person : "Sin asignar") + " " + ref(x.total) + (okp ? " ✓" : "") + "</span>";
    }).join("") + "</div>" : "") +
    (d.precuenta_at ? '<div class="muted">Precuenta impresa a las ' + new Date(d.precuenta_at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) + "</div>" : "");
  var pending = cur.cart.length + d.items.filter(function (i) { return i.status === "pendiente"; }).length;
  label("send", "send", pending ? "Enviar a cocina (" + pending + ")" : "Enviar a cocina");
  $("send").disabled = !pending;
  var hasItems = d.items.some(function (i) { return i.status !== "anulado"; });
  $("pay").disabled = !hasItems || pending > 0; $("precuenta").disabled = !hasItems || pending > 0;
  // Solo quien tiene permiso cobra, descuenta y anula (el servidor también lo exige)
  ["pay", "discount", "cancel"].forEach(function (id) { show(id, !!(U && U.charge)); });
  $("move").classList.toggle("hidden", d.kind !== "mesa");
  $("splitBtn").disabled = !hasItems || pending > 0;
  label("splitBtn", "users", splitN(d) ? "Dividida entre " + splitN(d) + " · cambiar" : "Dividir por persona");
  $("cancel").disabled = paid > 0;
  var ed = $("editDeliv"); if (ed) ed.onclick = function () { delivForm(d); };
  syncOrderBar();
}
function fmtQ(n) { n = num(n); return n % 1 ? nf2.format(n) : String(n); }

$("lines").addEventListener("click", function (e) {
  var c = e.target.closest("[data-cart]");
  if (c) {
    var ci = Number(c.dataset.cart), it0 = cur.cart[ci];
    if (e.target.closest("[data-inc]")) it0.qty = Math.min(50, it0.qty + 1);
    else if (e.target.closest("[data-dec]")) { it0.qty -= 1; if (it0.qty <= 0) cur.cart.splice(ci, 1); }
    else if (e.target.closest(".t")) { // tocar el nombre: poner o cambiar la nota para cocina
      ask({ title: "Nota para cocina · " + it0.dish.name, help: "Ej.: sin cebollín, bien cocido, para compartir. Déjalo vacío para quitarla.", value: it0.notes || "" }).then(function (v) {
        if (v === null) return; it0.notes = String(v).trim().slice(0, 140); drawTicket();
      });
      return;
    }
    drawTicket(); return;
  }
  var l = e.target.closest("[data-item]"); if (!l || l.classList.contains("void")) return;
  var it = cur.data.items.find(function (i) { return i.id === Number(l.dataset.item); });
  if (it.status === "pendiente") { rpc("pos_void", { p_item: it.id, p_reason: "" }).then(loadOrder).catch(fail); return; }
  ask({ title: "Anular " + fmtQ(it.qty) + " " + it.name + (it.variant ? " " + it.variant : ""), help: "Ya está en cocina. Escribe el motivo: quedará en el cierre de caja.", value: "", required: 3 })
    .then(function (r) { if (r === null) return; return rpc("pos_void", { p_item: it.id, p_reason: r }).then(function () { toast("Anulado y avisado a cocina"); return loadOrder(); }); }).catch(fail);
});

var sending = false;
$("send").addEventListener("click", function () {
  if (sending) return; sending = true; $("send").disabled = true;
  var items = cur.cart.map(function (c) { return { dish_id: c.dish.id, variant: c.variant, option: c.option, notes: c.notes, qty: c.qty }; });
  (items.length ? rpc("pos_add", { p_order: cur.order, p_items: items }) : Promise.resolve())
    .then(function () { cur.cart = []; return rpc("pos_send", { p_order: cur.order }); })
    .then(function (n) { toast(n ? "Enviado a cocina (" + n + ")" : "Nada que enviar"); return loadOrder(); })
    .catch(fail).then(function () { sending = false; drawTicket(); });
});
// Precuenta: una a la vez, y si ya salió hace poco se pregunta antes de imprimir otra
var billBusy = false;
$("precuenta").addEventListener("click", function () {
  if (billBusy || !cur.data) return;
  var last = cur.data.precuenta_at ? (Date.now() - new Date(cur.data.precuenta_at).getTime()) / 1000 : Infinity;
  if (last < 90 && !confirm("La precuenta de " + cur.data.label + " ya salió hace " + Math.max(1, Math.round(last)) + " segundos. ¿Imprimir otra?")) return;
  billBusy = true;
  rpc("pos_precuenta", { p_order: cur.order }).then(function () {
    var t = tableById(cur.data.table_id); toast(t && t.area === "Edo" ? "Precuenta enviada a la impresora de Edo" : "Precuenta enviada a caja");
    cur.data.precuenta_at = new Date().toISOString(); return loadOrder();
  }).catch(fail).then(function () { billBusy = false; });
});
$("discount").addEventListener("click", function () {
  ask({ title: "Descuento (Ref)", help: "Monto en Ref sobre el subtotal. 0 para quitarlo.", value: cur.data.totals.discount || "", type: "number" }).then(function (a) {
    if (a === null) return;
    var amount = num(a);
    return (amount > 0 ? ask({ title: "Motivo del descuento", help: "Quedará en el cierre de caja.", value: cur.data.discount_reason || "", required: 3 }) : Promise.resolve(""))
      .then(function (reason) { if (reason === null) return; return rpc("pos_discount", { p_order: cur.order, p_amount: amount, p_reason: reason }).then(loadOrder); });
  }).catch(fail);
});
$("cancel").addEventListener("click", function () {
  var sent = cur.data.items.some(function (i) { return i.status === "enviado"; });
  (sent ? ask({ title: "Anular todo el pedido", help: "Hay platos en cocina. Escribe el motivo: quedará en el cierre de caja.", value: "", required: 3 })
        : Promise.resolve(confirm("¿Anular este pedido vacío?") ? "" : null))
    .then(function (r) { if (r === null) return; return rpc("pos_cancel", { p_order: cur.order, p_reason: r }).then(function () { toast("Pedido anulado"); goTables(); }); }).catch(fail);
});

// Mover mesa
var moveArea = "Tokio";
$("move").addEventListener("click", function () { moveArea = (tableById(cur.data.table_id) || {}).area || "Tokio"; drawMove(); $("moveDlg").showModal(); });
function drawMove() {
  $("moveAreas").innerHTML = AREAS.map(function (a) { return '<button type="button" data-area="' + a + '"' + (a === moveArea ? ' class="on"' : "") + ">" + a + "</button>"; }).join("");
  $("moveTables").innerHTML = ST.tables.filter(function (t) { return t.area === moveArea; }).map(function (t) {
    var busy = ST.orders.some(function (o) { return o.table_id === t.id; });
    return '<button type="button" data-table="' + t.id + '"' + (busy ? " disabled" : "") + ">" + t.number + "<small>" + (busy ? "ocupada" : "libre") + "</small></button>";
  }).join("");
}
$("moveAreas").addEventListener("click", function (e) { var b = e.target.closest("[data-area]"); if (b) { moveArea = b.dataset.area; drawMove(); } });
$("moveTables").addEventListener("click", function (e) {
  var b = e.target.closest("[data-table]"); if (!b || b.disabled) return;
  rpc("pos_move", { p_order: cur.order, p_table: Number(b.dataset.table) }).then(function () { $("moveDlg").close(); toast("Mesa cambiada"); return refreshState().then(loadOrder); }).catch(fail);
});
$("moveCancel").addEventListener("click", function () { $("moveDlg").close(); });

// ---------------------------------------------------------------- Cliente del pedido (para factura y registro)
var cliTimer = null;
function clientForm() {
  var c = (cur.data && cur.data.client) || {};
  $("cDoc").value = c.doc_id || ""; $("cName").value = c.name || ""; $("cPhone").value = c.phone || ""; $("cEmail").value = c.email || "";
  $("cConsent").checked = false; $("cErr").textContent = ""; $("cFound").textContent = "";
  $("cliDlg").showModal(); setTimeout(function () { $("cDoc").focus(); }, 50);
}
function lookupClient() {
  var d = $("cDoc").value.replace(/[\s.\-]/g, "");
  if (d.length < 5) { $("cFound").textContent = ""; return; }
  rpc("pos_find_customer", { p_doc: d }).then(function (r) {
    if (!r) { $("cFound").textContent = "Cliente nuevo: se registrará al guardar."; return; }
    $("cFound").textContent = "Cliente encontrado ✓";
    if (!$("cName").value) $("cName").value = r.name || ""; if (!$("cPhone").value) $("cPhone").value = r.phone || ""; if (!$("cEmail").value) $("cEmail").value = r.email || "";
    if (r.marketing_consent) $("cConsent").checked = true;
  }).catch(function () {});
}
$("cDoc").addEventListener("input", function () { clearTimeout(cliTimer); cliTimer = setTimeout(lookupClient, 400); });
$("cCancel").addEventListener("click", function () { $("cliDlg").close(); });
$("cOk").addEventListener("click", function () {
  var name = $("cName").value.trim();
  if (name.length < 2) { $("cErr").textContent = "Escribe el nombre o la razón social."; return; }
  rpc("pos_set_customer", { p_order: cur.order, p_doc: $("cDoc").value, p_name: name, p_phone: $("cPhone").value, p_email: $("cEmail").value, p_consent: $("cConsent").checked })
    .then(function () { $("cliDlg").close(); toast("Cliente guardado en el pedido"); return loadOrder(); })
    .catch(function (e) { $("cErr").textContent = errMsg(e); });
});
$("btnClient").addEventListener("click", clientForm);

// ---------------------------------------------------------------- Delivery
var delivEdit = null;
function delivForm(d) {
  delivEdit = d; $("delivTitle").textContent = d ? "Datos del delivery" : "Nuevo delivery"; $("dErr").textContent = "";
  $("dName").value = d ? d.customer : ""; $("dPhone").value = d ? d.phone : ""; $("dAddr").value = d ? d.address : ""; $("dFee").value = d ? num(d.delivery_fee) : "0";
  $("dChan").value = d && d.channel === "yummy" ? "yummy" : "propio"; delivChan();
  $("dCard").classList.add("hidden"); delivPhoneKey = "";
  $("delivDlg").showModal(); setTimeout(function () { $(d ? "dName" : "dPhone").focus(); }, 50);
  if (d && d.phone) delivLookup();
}
// Ficha del cliente: con el teléfono se llenan nombre y dirección y se ve qué suele pedir
var delivPhoneKey = "", delivTimer = null;
function delivLookup() {
  var digits = $("dPhone").value.replace(/\D/g, ""), key = digits.length >= 10 ? digits.slice(-10) : "";
  if (key === delivPhoneKey) return;
  delivPhoneKey = key;
  if (!key) { $("dCard").classList.add("hidden"); return; }
  rpc("pos_customer_by_phone", { p_phone: $("dPhone").value }).then(function (c) {
    if (key !== delivPhoneKey) return;
    if (!c) { $("dCard").innerHTML = "Cliente nuevo: se guardará al crear el pedido."; $("dCard").classList.remove("hidden"); return; }
    if (!$("dName").value.trim() && c.name) $("dName").value = c.name;
    if (!$("dAddr").value.trim() && c.address) $("dAddr").value = c.address;
    var n = num(c.orders), last = c.last_at ? Math.round((Date.now() - new Date(c.last_at).getTime()) / 86400000) : null;
    $("dCard").innerHTML = "<b>" + esc(c.name || "Cliente") + "</b> · " + (n ? n + (n === 1 ? " pedido" : " pedidos") + " · " + ref(c.spent) +
      (last != null ? " · último " + (last < 1 ? "hoy" : last === 1 ? "ayer" : "hace " + last + " días") : "") : "sin pedidos cobrados todavía") +
      (c.top && c.top.length ? '<div class="muted">Suele pedir: ' + esc(c.top.join(", ")) + "</div>" : "") +
      (c.notes ? '<div class="muted">Nota: ' + esc(c.notes) + "</div>" : "");
    $("dCard").classList.remove("hidden");
  }).catch(function () { $("dCard").classList.add("hidden"); });
}
$("dPhone").addEventListener("input", function () { clearTimeout(delivTimer); delivTimer = setTimeout(delivLookup, 350); });
// Yummy cobra su envío en su app: aquí no lleva costo de delivery
function delivChan() { var y = $("dChan").value === "yummy"; $("dFeeBox").classList.toggle("hidden", y); if (y) $("dFee").value = "0"; }
$("dChan").addEventListener("change", delivChan);
$("dCancel").addEventListener("click", function () { $("delivDlg").close(); });
$("dOk").addEventListener("click", function () {
  var a = { p_name: $("dName").value.trim(), p_phone: $("dPhone").value.trim(), p_address: $("dAddr").value.trim(), p_fee: num($("dFee").value), p_channel: $("dChan").value };
  if (a.p_name.length < 2) { $("dErr").textContent = "Escribe el nombre del cliente."; return; }
  (delivEdit ? rpc("pos_set_delivery", Object.assign({ p_order: delivEdit.id }, a)).then(function () { return delivEdit.id; }) : rpc("pos_open_delivery", a))
    .then(function (id) { $("delivDlg").close(); return openOrder(id); }).catch(function (e) { $("dErr").textContent = errMsg(e); });
});

// ---------------------------------------------------------------- Cuenta dividida por persona (colores)
var PCOL = ["#2563eb", "#dc2626", "#16a34a", "#ea580c", "#7c3aed", "#db2777", "#0d9488", "#ca8a04"];
var PNAME = ["Azul", "Rojo", "Verde", "Naranja", "Morado", "Rosado", "Turquesa", "Amarillo"];
function pcol(p) { return p > 0 ? PCOL[p - 1] : "#888"; }
function pname(p) { return p > 0 ? "Persona " + p + " · " + PNAME[p - 1] : "Sin asignar"; }
function splitN(d) { return d && d.split && num(d.split.n) >= 2 ? num(d.split.n) : 0; }
function unitsOf(d) { // cada unidad de cada plato (2 Gyozas = 2 unidades)
  var out = [];
  d.items.forEach(function (i) {
    if (i.status === "anulado") return;
    var q2 = num(i.qty), n = Math.ceil(q2), saved = d.split && d.split.units && d.split.units[i.id];
    for (var k = 0; k < n; k++) out.push({ item: i.id, k: k, name: i.name + (i.variant ? " " + i.variant : ""), price: Math.round(num(i.unit_price) * Math.min(1, q2 - k) * 100) / 100, person: saved ? num(saved[k]) : 0 });
  });
  return out;
}
function personDots(d, i) {
  var n = splitN(d), u = n && d.split.units && d.split.units[i.id]; if (!u || i.status === "anulado") return "";
  return '<span class="pdots">' + u.map(function (p) { return '<i class="pdot' + (p ? "" : " none") + '" style="--pc:' + pcol(p) + '" title="' + pname(p) + '"></i>'; }).join("") + "</span>";
}
function paidBy(d, p) { return (d.payments || []).reduce(function (s2, x) { return s2 + (num(x.person) === p ? num(x.amount_ref) : 0); }, 0); }
// Mismo cálculo que el servidor (pos_split): platos + parte proporcional de descuento y servicio + delivery en partes iguales
function splitCalc(d, units, n) {
  var t = d.totals, sub = num(t.subtotal), anyFree = units.some(function (u) { return !u.person; }), rows = [], acc = 0, last = 0;
  units.forEach(function (u) { if (u.person > last) last = u.person; });
  var list = []; for (var p = 1; p <= n; p++) list.push(p); if (anyFree) list.push(0);
  list.forEach(function (p) {
    var s2 = Math.round(units.reduce(function (a, u) { return a + (u.person === p ? u.price : 0); }, 0) * 100) / 100;
    var disc = sub > 0 ? Math.round(num(t.discount) * s2 / sub * 100) / 100 : 0, svc = Math.round((s2 - disc) * num(d.service_pct)) / 100,
      dl = p > 0 ? Math.round(num(t.delivery) / n * 100) / 100 : 0, tot = Math.round((s2 - disc + svc + dl) * 100) / 100;
    if (p === last && p > 0 && !anyFree) tot = Math.round((num(t.total) - acc) * 100) / 100;
    acc += tot; rows.push({ person: p, total: tot, paid: paidBy(d, p), count: units.filter(function (u) { return u.person === p; }).length });
  });
  return rows;
}
var sp = { n: 2, sel: 1, units: [], thenPay: false };
function openSplit(thenPay) {
  var d = cur.data; sp.thenPay = !!thenPay; sp.units = unitsOf(d);
  sp.n = splitN(d) || Math.max(2, Math.min(8, d.kind === "mesa" ? 2 : 2)); sp.sel = 1; $("spErr").textContent = "";
  drawSplit(); $("splitDlg").showModal();
}
function lockedP(p) { return p > 0 && paidBy(cur.data, p) > 0.009; } // quien ya pagó no se puede cambiar
function drawSplit() {
  var d = cur.data, rows = splitCalc(d, sp.units, sp.n);
  $("spN").textContent = sp.n;
  $("spPersons").innerHTML = rows.filter(function (r) { return r.person > 0; }).map(function (r) {
    var done = r.paid >= r.total - 0.02 && r.total > 0;
    return '<button type="button" data-p="' + r.person + '" style="--pc:' + pcol(r.person) + '"' + (r.person === sp.sel ? ' class="on' + (done ? " done" : "") + '"' : done ? ' class="done"' : "") + ">" +
      '<b><i class="pdot"></i>' + esc(pname(r.person)) + "</b><small>" + r.count + " plato" + (r.count === 1 ? "" : "s") + " · " + ref(r.total) + (done ? " · pagado ✓" : lockedP(r.person) ? " · abonó" : "") + "</small></button>";
  }).join("");
  var free = sp.units.filter(function (u) { return !u.person; }).length;
  $("spLeft").textContent = free ? "Faltan " + free + " plato" + (free === 1 ? "" : "s") + " por asignar" : "Todos los platos tienen dueño ✓";
  $("spLeft").style.color = free ? "var(--warn)" : "var(--ok)";
  $("spRest").disabled = !free || lockedP(sp.sel);
  $("spRest").innerHTML = '<i class="pdot" style="--pc:' + pcol(sp.sel) + '"></i> Lo que falta → ' + esc(pname(sp.sel));
  $("spUnits").innerHTML = sp.units.map(function (u, ix) {
    return '<button type="button" data-u="' + ix + '" style="--pc:' + (u.person ? pcol(u.person) : "transparent") + '"' + (u.person ? ' class="set"' : "") + (lockedP(u.person) ? " disabled" : "") + ">" +
      "<span>" + esc(u.name) + "<small>" + ref(u.price) + "</small></span>" + (u.person ? '<b class="tag">P' + u.person + "</b>" : "") + "</button>";
  }).join("") || '<p class="muted">No hay platos.</p>';
  var maxPaid = 0; for (var p = 1; p <= 8; p++) if (lockedP(p)) maxPaid = p;
  $("spMinus").disabled = sp.n <= Math.max(2, maxPaid); $("spPlus").disabled = sp.n >= 8;
}
$("spPersons").addEventListener("click", function (e) { var b = e.target.closest("[data-p]"); if (b) { sp.sel = Number(b.dataset.p); drawSplit(); } });
$("spUnits").addEventListener("click", function (e) {
  var b = e.target.closest("[data-u]"); if (!b || b.disabled) return;
  if (lockedP(sp.sel)) { $("spErr").textContent = pname(sp.sel) + " ya pagó: elige otra persona."; return; }
  var u = sp.units[Number(b.dataset.u)]; u.person = u.person === sp.sel ? 0 : sp.sel; $("spErr").textContent = ""; drawSplit();
});
$("spRest").addEventListener("click", function () { sp.units.forEach(function (u) { if (!u.person) u.person = sp.sel; }); drawSplit(); });
$("spMinus").addEventListener("click", function () {
  sp.n = Math.max(2, sp.n - 1); sp.units.forEach(function (u) { if (u.person > sp.n) u.person = 0; }); if (sp.sel > sp.n) sp.sel = sp.n; drawSplit();
});
$("spPlus").addEventListener("click", function () { sp.n = Math.min(8, sp.n + 1); sp.sel = sp.n; drawSplit(); });
$("spCancel").addEventListener("click", function () { $("splitDlg").close(); if (sp.thenPay) $("pay").click(); });
function saveSplit(clear) {
  var units = {}; sp.units.forEach(function (u) { (units[u.item] = units[u.item] || [])[u.k] = u.person; });
  return rpc("pos_set_split", { p_order: cur.order, p_split: clear ? null : { n: sp.n, units: units } }).then(loadOrder);
}
$("spClear").addEventListener("click", function () {
  if (sp.units.some(function (u) { return lockedP(u.person); })) { $("spErr").textContent = "Alguien ya pagó su parte: no se puede quitar la división."; return; }
  if (!confirm("¿Quitar la división? La cuenta vuelve a ser una sola.")) return;
  saveSplit(true).then(function () { $("splitDlg").close(); toast("División quitada"); if (sp.thenPay) $("pay").click(); }).catch(function (e) { $("spErr").textContent = errMsg(e); });
});
$("spSave").addEventListener("click", function () {
  saveSplit(false).then(function () { $("splitDlg").close(); toast("Cuenta dividida entre " + sp.n); if (sp.thenPay) $("pay").click(); }).catch(function (e) { $("spErr").textContent = errMsg(e); });
});
$("spPrint").addEventListener("click", function () {
  var free = sp.units.filter(function (u) { return !u.person; }).length;
  if (free && !confirm("Quedan " + free + " platos sin asignar. ¿Imprimir igual?")) return;
  saveSplit(false).then(function () { return rpc("pos_precuenta", { p_order: cur.order }); }).then(function () {
    $("splitDlg").close(); var t = tableById(cur.data.table_id); toast(t && t.area === "Edo" ? "Precuenta por persona enviada a Edo" : "Precuenta por persona enviada a caja"); return loadOrder();
  }).catch(function (e) { $("spErr").textContent = errMsg(e); });
});
$("splitBtn").addEventListener("click", function () { openSplit(false); });
