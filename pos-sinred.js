// Modo sin internet: si se cae el internet, los pedidos y los cobros van por la laptop de caja.
// Funciona cuando la caja se abre desde la laptop (http://IP-DE-LA-LAPTOP:8080/pos.html), que está en el wifi del local.
// Cómo: se envuelve sb.rpc. Con internet todo va a Supabase como siempre (y se guarda una copia de mesas, carta,
// personal y de cada cuenta que se abre). Sin internet, las funciones de pedido se atienden aquí: cada envío a cocina
// y cada cobro se manda al puente, que imprime la comanda o el recibo y lo sube cuando vuelve la conexión.
// Todas las tablets ven lo de las demás leyendo la lista de la laptop. Sin internet se cobra la cuenta completa
// (sin abonos, partes ni cargos a cuenta de empleado); descontar y anular esperan al internet.
"use strict";
var SR = { on: false, token: "", url: "", tmp: {}, pend: {}, sent: {}, mine: [], remote: [], paid: {}, checking: false, lastTry: 0, syncing: 0 };
var SR_LOCAL = location.port === "8080" || /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
function srGet(k) { try { return JSON.parse(localStorage.getItem("sr-" + k) || "null"); } catch (e) { return null; } }
function srSet(k, v) { try { localStorage.setItem("sr-" + k, JSON.stringify(v)); } catch (e) { /* sin espacio: se sigue sin copia */ } }
SR.token = srGet("token") || ""; SR.url = srGet("url") || "";
(function () { var s = srGet("orders"); if (s) { SR.tmp = s.tmp || {}; SR.sent = s.sent || {}; SR.mine = s.mine || []; SR.paid = s.paid || {}; } })();
function srSaveOrders() { srSet("orders", { tmp: SR.tmp, sent: SR.sent, mine: SR.mine, paid: SR.paid }); }

// SHA-256 (para recordar en esta tablet los PIN que ya entraron con internet; el servidor los vuelve a verificar al subir)
function srSha256(msg) {
  var K = [], H = [], i, j, p = 2;
  function frac(x) { return ((x - Math.floor(x)) * 4294967296) | 0; }
  for (i = 0; i < 64; p++) { for (j = 2; j * j <= p; j++) if (p % j === 0) break; if (j * j > p) { if (i < 8) H[i] = frac(Math.pow(p, 1 / 2)); K[i++] = frac(Math.pow(p, 1 / 3)); } }
  var bytes = unescape(encodeURIComponent(msg)), l = bytes.length, words = [];
  for (i = 0; i < l; i++) words[i >> 2] |= bytes.charCodeAt(i) << (24 - (i % 4) * 8);
  words[l >> 2] |= 0x80 << (24 - (l % 4) * 8); words[((l + 8) >> 6) * 16 + 15] = l * 8;
  function r(x, n) { return (x >>> n) | (x << (32 - n)); }
  for (j = 0; j < words.length; j += 16) {
    var w = [], a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      w[i] = i < 16 ? words[j + i] | 0 : (r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10)) + w[i - 7] + (r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 16] | 0;
      var t1 = h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i] | 0, t2 = (r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c)) | 0;
      h = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
    }
    H = [H[0] + a | 0, H[1] + b | 0, H[2] + c | 0, H[3] + d | 0, H[4] + e | 0, H[5] + f | 0, H[6] + g | 0, H[7] + h | 0];
  }
  return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
}
function srSalt() { var s = srGet("salt"); if (!s) { s = Array.from(crypto.getRandomValues(new Uint8Array(12)), function (b) { return b.toString(16); }).join(""); srSet("salt", s); } return s; }
function srPinKey(emp, pin) { return srSha256(srSalt() + ":" + emp + ":" + pin); }

// ---------------------------------------------------------------- Detección
function srNetErr(r) { return !!(r && r.error && /Failed to fetch|NetworkError|Load failed|fetch failed|ERR_INTERNET|network/i.test(String(r.error.message || r.error))); }
function srBridge(pathname, opts) {
  opts = opts || {}; opts.headers = Object.assign({ "x-sinred": SR.token, "Content-Type": "application/json" }, opts.headers || {});
  return fetch(pathname, opts).then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || "La laptop no respondió"); return j; }); });
}
function srBanner() {
  var el = $("srBar");
  if (!el) { el = document.createElement("div"); el.id = "srBar"; el.className = "srbar hidden"; el.setAttribute("role", "status"); document.body.insertBefore(el, document.body.firstChild); }
  return el;
}
function srShow(html) { var el = srBanner(); el.innerHTML = html; el.classList.toggle("hidden", !html); document.body.classList.toggle("sinred", !!html); }
// Se cayó el internet: ¿se puede seguir por la laptop?
function srGoOffline() {
  if (SR.on) return Promise.resolve(true);
  if (SR.checking || Date.now() - SR.lastTry < 5000) return Promise.resolve(false);
  SR.checking = true; SR.lastTry = Date.now();
  if (!SR_LOCAL) {
    SR.checking = false;
    srShow("<b>Sin internet.</b> " + (SR.url ? 'Para seguir tomando pedidos abre la caja por la laptop: <a href="' + esc(SR.url) + '">' + esc(SR.url.replace(/^https?:\/\//, "")) + "</a> (con la tablet en el wifi del local)." : "Revisa el wifi de la tablet."));
    return Promise.resolve(false);
  }
  return srBridge("/api/sinred/estado").then(function () {
    SR.on = true; SR.checking = false;
    srShow("<b>Sin internet.</b> Los pedidos y los cobros van por la laptop (la comanda y el recibo salen ahí). Descontar y anular se hace cuando vuelva la conexión.");
    toast("Sin internet: los pedidos y los cobros siguen por la laptop");
    if (U) refreshState().catch(function () {});
    return true;
  }).catch(function (e) {
    SR.checking = false;
    srShow("<b>Sin internet y sin conexión con la laptop.</b> " + esc(e.message || ""));
    return false;
  });
}
// ¿Volvió el internet?
setInterval(function () {
  if (!SR.on && !document.body.classList.contains("sinred")) return;
  srRealRpc("pos_staff").then(function (r) {
    if (srNetErr(r)) return;
    var was = SR.on; SR.on = false; srShow("");
    SR.tmp = {}; SR.pend = {}; SR.sent = {}; SR.mine = []; SR.paid = {}; srSaveOrders();
    if (was) {
      toast("Volvió el internet. Lo hecho sin internet se sube en unos segundos.");
      if (cur.order && cur.order < 0) goTables();
      if (U) refreshState().catch(function () {});
      srWaitSync();
    }
  });
}, 8000);

// Al volver el internet, la laptop tarda unos segundos en subir lo hecho sin internet: mientras tanto se avisa y no se
// deja cobrar de nuevo una cuenta que ya se cobró sin internet.
function srWaitSync() {
  if (!SR_LOCAL || !SR.token) return;
  srBridge("/api/sinred/pedidos").then(function (j) {
    SR.remote = j.pedidos || []; SR.syncing = SR.remote.length;
    if (SR.syncing) {
      srShow("<b>Subiendo lo hecho sin internet</b> (" + SR.syncing + " pendiente" + (SR.syncing === 1 ? "" : "s") + "). Espera antes de cobrar las cuentas que se cobraron sin internet.");
      setTimeout(srWaitSync, 5000);
    } else { srShow(""); if (U) refreshState().catch(function () {}); }
  }).catch(function () { SR.syncing = 0; srShow(""); });
}
function srPaidOffline(orderId) { return SR.remote.some(function (e) { return e.type === "pago" && e.order && e.order.id === orderId; }); }

// ---------------------------------------------------------------- Lo que se atiende sin internet
function srTableLabel(t) { return t ? t.area + " " + t.number : "Mesa"; }
function srNewId() { return -(Date.now() % 1e9 * 10 + Math.floor(Math.random() * 10)); }
function srTmpOf(id) { return "sr-" + Math.abs(id); }
function srIdOfTmp(tmp) { return -Number(String(tmp).slice(3)); }
function srKeyOf(id) { return id > 0 ? "id:" + id : "tmp:" + srTmpOf(id); }
function srKey(o) { return o.id ? "id:" + o.id : "tmp:" + o.tmp; }
function srSvcPct() { var s = srGet("st") || ST || {}; return s.service_pct != null ? num(s.service_pct) : 10; }
function srSum(list) { return list.reduce(function (a, i) { return a + num(i.qty) * num(i.unit_price); }, 0); }
// Lo que está en la laptop (de todas las tablets) más lo que esta tablet mandó y la laptop aún no listó
function srRemote() { return srBridge("/api/sinred/pedidos").then(function (j) { SR.remote = j.pedidos || []; }, function () { /* se usa la última lista */ }); }
function srEntriesAll() { var seen = {}, all = SR.remote.concat(SR.mine); return all.filter(function (e) { if (seen[e.uuid]) return false; seen[e.uuid] = true; return true; }); }
function srPaidKeys() { var k = {}; srEntriesAll().forEach(function (e) { if (e.type === "pago") k[srKey(e.order)] = true; }); Object.keys(SR.paid).forEach(function (x) { k[x] = true; }); return k; }
function srItemsOf(key) {
  var out = [];
  srEntriesAll().forEach(function (e) { if (e.type !== "pago" && srKey(e.order) === key) (e.items || []).forEach(function (i) {
    out.push({ dish_id: i.dish_id, name: i.name, variant: i.variant || "", option: i.option || "", notes: i.notes || "", qty: num(i.qty), unit_price: num(i.unit_price) }); }); });
  return out;
}
function srOrderInfo(id) {
  if (SR.tmp[id]) return SR.tmp[id];
  var o = ST && ST.orders.find(function (x) { return x.id === id; });
  if (!o) return null;
  return { id: o.id, kind: o.kind, table_id: o.table_id, label: o.kind === "mesa" ? srTableLabel(tableById(o.table_id)) : o.label, opened_at: o.opened_at, opened_by: o.opened_by,
           phone: o.phone || "", address: o.address || "", existing: id > 0 };
}
function srSentItems(id) { return srItemsOf(srKeyOf(id)); }
// El vuelto, igual que lo calcula el servidor (pos_give_change / pos_change_to_tip)
function srChange(over, cc, rate) {
  if (cc === "PROPINA") return { currency: "PROPINA", amount: over };
  if (cc === "MIX" && rate && Math.floor(over) >= 1 && over - Math.floor(over) > 0.009) { var usd = Math.floor(over); return { currency: "MIX", amount: over, usd: usd, bs: Math.round((over - usd) * rate * 100) / 100 }; }
  if (cc === "MOVIL" && rate) return { currency: "MOVIL", amount: Math.round(over * rate * 100) / 100 };
  if ((cc === "BS" || cc === "MIX") && rate && !(cc === "MIX" && over - Math.floor(over) <= 0.009)) return { currency: "BS", amount: Math.round(over * rate * 100) / 100 };
  return { currency: "REF", amount: over };
}
var SRH = {
  pos_staff: function () { return srGet("staff") || []; },
  // Mesas y cuentas: la copia de cuando había internet, más lo pedido y cobrado sin internet en todas las tablets
  pos_state: function () {
    return srRemote().then(function () {
      var s = JSON.parse(JSON.stringify(srGet("st") || ST || { tables: [], orders: [] })), paid = srPaidKeys(), pct = srSvcPct(), tmps = {};
      s.orders = (s.orders || []).filter(function (o) { return o.id > 0 && !paid["id:" + o.id]; });
      s.orders.forEach(function (o) {
        var its = srItemsOf("id:" + o.id); if (!its.length) return;
        o.total = Math.round((num(o.total) + srSum(its) * (100 + (o.kind === "mesa" ? pct : 0)) / 100) * 100) / 100; o.items = num(o.items) + its.length;
      });
      srEntriesAll().forEach(function (e) {
        if (e.type === "pago" || !e.order || !e.order.tmp || paid["tmp:" + e.order.tmp] || tmps[e.order.tmp]) return;
        tmps[e.order.tmp] = { order: e.order, at: e.at, by: e.emp_name || "" };
      });
      Object.keys(SR.tmp).forEach(function (id) {
        var t = SR.tmp[id], tmp = srTmpOf(t.id);
        if (!paid["tmp:" + tmp] && !tmps[tmp]) tmps[tmp] = { order: { tmp: tmp, kind: t.kind, table_id: t.table_id, label: t.label, phone: t.phone, address: t.address }, at: t.opened_at, by: t.opened_by };
      });
      Object.keys(tmps).forEach(function (tmp) {
        var x = tmps[tmp], its = srItemsOf("tmp:" + tmp), svc = x.order.kind === "mesa" ? pct : 0;
        s.orders.push({ id: srIdOfTmp(tmp), kind: x.order.kind, table_id: x.order.table_id, label: x.order.label, phone: x.order.phone || "", address: x.order.address || "",
                        opened_at: x.at, opened_by: x.by, total: Math.round(srSum(its) * (100 + svc)) / 100, paid: 0, items: its.length, ready: 0, offline: true });
      });
      return s;
    });
  },
  pos_check_pin: function (a) {
    var known = (srGet("pins") || {})[a.p_emp];
    if (known && known.h === srPinKey(a.p_emp, a.p_pin)) return { ok: true, name: known.name, can_charge: !!known.charge };
    return { ok: false, error: known ? "PIN incorrecto" : "Sin internet: en esta tablet solo entra quien ya entró antes con internet" };
  },
  pos_open: function (a) {
    if (a.p_table) {
      var o = ST && ST.orders.find(function (x) { return x.table_id === a.p_table; });
      if (o) return o.id;
    }
    var id = srNewId(), t = a.p_table ? tableById(a.p_table) : null;
    SR.tmp[id] = { id: id, kind: a.p_table ? "mesa" : "llevar", table_id: a.p_table || null, label: a.p_table ? srTableLabel(t) : "Para llevar" + (a.p_label ? ": " + a.p_label : ""),
                   opened_at: new Date().toISOString(), opened_by: U ? U.name : "" };
    srSaveOrders(); return id;
  },
  pos_open_delivery: function (a) {
    var id = srNewId();
    SR.tmp[id] = { id: id, kind: "delivery", table_id: null, label: (a.p_channel === "yummy" ? "Yummy" : "Delivery") + ": " + (a.p_name || ""), phone: a.p_phone || "", address: a.p_address || "",
                   delivery_fee: Math.max(0, Math.min(100, num(a.p_fee))), opened_at: new Date().toISOString(), opened_by: U ? U.name : "" };
    srSaveOrders(); return id;
  },
  // Una cuenta: lo que se guardó de ella con internet (o su total, si esta tablet no la abrió) más lo de sin internet
  pos_order: function (a) {
    var id = a.p_order, info = srOrderInfo(id); if (!info) throw new Error("Pedido no encontrado");
    var cached = id > 0 ? (srGet("ords") || {})[id] : null, so = id > 0 && ST ? ST.orders.find(function (x) { return x.id === id; }) : null;
    var off = srSentItems(id).map(function (i, k) { return Object.assign({ id: -1 - k, status: "enviado", offline: true }, i); });
    // La copia de la cuenta es de cuando se abrió en esta tablet; la lista de cuentas se refresca cada 5 s. Si la lista es más
    // nueva y no cuadra (otra tablet le agregó platos, un abono o un descuento), se cobra con el total de la lista, no con la copia
    if (cached && so && cached.totals && num((srGet("st") || {})._saved) >= num(cached._saved)) {
      var lt = num(so.total) - srSum(off) * (100 + (info.kind === "mesa" ? srSvcPct() : 0)) / 100;
      if (Math.abs(lt - num(cached.totals.total)) > 0.05 || Math.abs(num(so.paid) - num(cached.totals.paid)) > 0.05) cached = null;
    }
    var base = cached ? (cached.items || []).filter(function (i) { return i.status !== "pendiente"; }) : [];
    var pend = (SR.pend[id] || []).map(function (i, k) { return Object.assign({ id: -100 - k, status: "pendiente" }, i); });
    var pct = cached ? num(cached.service_pct) : info.kind === "mesa" ? srSvcPct() : 0, ct = cached && cached.totals, prev = null, items, tt;
    if (ct) {
      var sub = num(ct.subtotal) + srSum(off) + srSum(pend), disc = Math.min(num(ct.discount), sub), svc = Math.round((sub - disc) * pct) / 100;
      tt = { subtotal: sub, discount: disc, service: svc, delivery: num(ct.delivery), total: Math.round((sub - disc + svc + num(ct.delivery)) * 100) / 100, paid: num(ct.paid) };
      items = base.concat(off, pend); prev = num(ct.paid) ? { total: 0, paid: num(ct.paid) } : null;
    } else {
      // Cuenta abierta con internet en otra tablet: se conoce su total, no sus platos
      var pt = so ? num(so.total) - srSum(off) * (100 + (info.kind === "mesa" ? srSvcPct() : 0)) / 100 : 0, pp = so ? num(so.paid) : 0;
      var s2 = srSum(off) + srSum(pend), v2 = Math.round(s2 * pct) / 100, dl = id < 0 ? num(info.delivery_fee) : 0;   // delivery abierto sin internet
      items = (pt > 0.009 ? [{ id: -999, name: "Consumo anterior (con internet)", qty: 1, unit_price: Math.round(pt * 100) / 100, status: "enviado", synthetic: true }] : []).concat(off, pend);
      tt = { subtotal: Math.round((pt + s2) * 100) / 100, discount: 0, service: v2, delivery: dl, total: Math.round((pt + s2 + v2 + dl) * 100) / 100, paid: pp };
      prev = pt > 0.009 || pp ? { total: Math.round(pt * 100) / 100, paid: pp } : null;
    }
    return { id: info.id, kind: info.kind, table_id: info.table_id, label: info.label + (info.existing ? " (sin internet)" : ""), status: "abierta", items: items,
             phone: info.phone || "", address: info.address || "", opened_by: info.opened_by || "", opened_at: info.opened_at, service_pct: pct, payments: [], split: null,
             totals: tt, prev: prev, offline: true };
  },
  // Cobrar sin internet: la cuenta completa; la laptop imprime el recibo y lo sube al volver la conexión
  pos_pay: function (a) {
    if (!U || !U.charge) throw new Error("Sin internet cobra solo quien tiene permiso de cobrar y ya entró antes con internet en esta tablet");
    if (a.p_partial) throw new Error("Sin internet se cobra la cuenta completa (sin abonos ni partes)");
    var id = a.p_order, d = SRH.pos_order({ p_order: id }), rate = num(ST && ST.rate);
    var lines = (a.p_payments || []).filter(function (p) { return num(p.amount) > 0; });
    if (lines.some(function (p) { return p.method === "cuenta"; })) throw new Error("Sin internet no se carga a cuenta de empleado");
    if (d.items.some(function (i) { return i.status === "pendiente"; })) throw new Error("Hay platos sin enviar a cocina: envíalos o quítalos antes de cobrar");
    var due = Math.round((num(d.totals.total) - num(d.totals.paid)) * 100) / 100, paid = 0;
    lines.forEach(function (p) { if (!p.tip) paid += minfo(p.method)[2] === "REF" ? num(p.amount) : rate ? num(p.amount) / rate : 0; });
    paid = Math.round(paid * 100) / 100;
    if (paid < due - 0.02) throw new Error("Falta por cobrar " + ref(due - paid));
    var over = Math.round((paid - due) * 100) / 100, cc = a.p_change_currency || "REF", ch = over > 0.02 ? srChange(over, cc, rate) : null;
    var key = id > 0 ? { id: id } : { tmp: srTmpOf(id) };
    var body = { uuid: "sp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10), device: devName(), emp: U.id, emp_name: U.name, pin: U.pin,
                 order: Object.assign({ label: d.label.replace(/ \(sin internet\)$/, "") }, key),
                 lines: lines.map(function (p) { return { method: p.method, amount: num(p.amount), reference: p.reference || "", tip: !!p.tip }; }),
                 change_currency: ch ? cc : "", change: ch ? Object.assign({ text: chgTxt(ch) }, ch) : null, total: due, service: num(d.totals.service), rate: rate || null, prev: d.prev,
                 items: d.items.filter(function (i) { return !i.synthetic && i.status !== "anulado"; }).map(function (i) { return { name: i.name, variant: i.variant || "", qty: num(i.qty), unit_price: num(i.unit_price) }; }) };
    return srBridge("/api/sinred/cobrar", { method: "POST", body: JSON.stringify(body) }).then(function (r) {
      SR.paid[srKey(key)] = true; SR.mine.push({ type: "pago", uuid: body.uuid, order: key, lines: body.lines, total: due }); delete SR.pend[id]; if (id < 0) delete SR.tmp[id]; srSaveOrders();
      if (r.impreso === false) toast("Cobrado y guardado en la laptop, pero el recibo no salió: " + (r.error || ""), true);
      return { total: num(d.totals.total), paid: due, rest: 0, change: ch, closed: true, offline: true };
    });
  },
  pos_add: function (a) {
    var list = SR.pend[a.p_order] = SR.pend[a.p_order] || [];
    (a.p_items || []).forEach(function (it) {
      var d = (MENU.dishes || []).find(function (x) { return x.id === it.dish_id; });
      if (d) list.push({ dish_id: d.id, name: d.name, variant: it.variant || "", option: it.option || "", notes: it.notes || "", qty: num(it.qty), unit_price: priceOf(d, it.variant) });
    });
    return list.length;
  },
  pos_void: function (a) {
    // Solo se puede quitar lo que aún no salió a cocina (los pendientes llevan id -100, -101…)
    if (a.p_item > -100) throw new Error("Sin internet no se puede anular lo que ya salió a cocina");
    var list = SR.pend[cur.order] || []; list.splice(-100 - a.p_item, 1);
    return "quitado";
  },
  pos_send: function (a) {
    var list = SR.pend[a.p_order] || [], info = srOrderInfo(a.p_order);
    if (!list.length) return 0;
    var body = { uuid: "sr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10), device: devName(), emp: U.id, emp_name: U.name, pin: U.pin,
                 added: !!(info.existing || srSentItems(a.p_order).length),
                 order: info.existing ? { id: info.id, kind: info.kind, table_id: info.table_id, label: info.label }
                                      : { tmp: "sr-" + Math.abs(info.id), kind: info.kind, table_id: info.table_id, label: info.label, phone: info.phone, address: info.address,
                                          delivery_fee: num(info.delivery_fee) },
                 items: list };
    return srBridge("/api/sinred/enviar", { method: "POST", body: JSON.stringify(body) }).then(function (r) {
      SR.mine.push({ type: "comanda", uuid: body.uuid, at: new Date().toISOString(), emp_name: U.name, order: body.order, items: list }); delete SR.pend[a.p_order]; srSaveOrders();
      if (r.impreso === false) toast("Guardado en la laptop, pero la impresora falló: " + (r.error || ""), true);
      return list.length;
    });
  },
  // Lo que no hace falta sin internet: se responde vacío
  pos_device_hello: function () { return null; }, pos_announcements: function () { return []; }, pos_tops: function () { return []; }
};

// ---------------------------------------------------------------- Envoltura de sb.rpc
var srRealRpc = sb.rpc.bind(sb);
function srAnswer(name, args) {
  return Promise.resolve().then(function () { return SRH[name](args || {}); })
    .then(function (d) { return { data: d, error: null }; }, function (e) { return { data: null, error: { message: e.message || String(e) } }; });
}
sb.rpc = function (name, args) {
  if (SR.on) return SRH[name] ? srAnswer(name, args) : Promise.resolve({ data: null, error: { message: "Sin internet: esto se hace cuando vuelva la conexión" } });
  if (name === "pos_pay" && args && SR.syncing && srPaidOffline(args.p_order))
    return Promise.resolve({ data: null, error: { message: "Esta cuenta ya se cobró sin internet: la laptop la está subiendo. Espera unos segundos." } });
  return Promise.resolve(srRealRpc(name, args)).then(function (r) {
    if (srNetErr(r)) {
      return srGoOffline().then(function (on) { return on && SRH[name] ? srAnswer(name, args) : r; });
    }
    // Con internet: se guarda lo necesario para seguir sin él
    if (!r.error) {
      if (name === "pos_state" && r.data) srSet("st", Object.assign({}, r.data, { _saved: Date.now() }));   // _saved: para saber qué copia es más nueva
      else if (name === "pos_staff" && r.data) srSet("staff", r.data);
      else if (name === "pos_check_pin" && r.data && r.data.ok && args) { var p = srGet("pins") || {}; p[args.p_emp] = { h: srPinKey(args.p_emp, args.p_pin), name: r.data.name, charge: !!r.data.can_charge }; srSet("pins", p); srLanToken(); }
      else if (name === "pos_order" && r.data && args) {
        // Copia de cada cuenta abierta (para cobrarla sin internet con sus platos); se quitan las que ya se cerraron
        var m = srGet("ords") || {}, open = {}; (ST && ST.orders || []).forEach(function (o) { open[o.id] = true; });
        Object.keys(m).forEach(function (k) { if (!open[k]) delete m[k]; });
        if (r.data.status === "abierta") m[args.p_order] = Object.assign({}, r.data, { _saved: Date.now() }); else delete m[args.p_order];
        srSet("ords", m);
      }
    }
    return r;
  });
};
// La llave de la red local y la dirección de la laptop (se piden con internet, una vez por sesión)
var srTokenAt = 0;
function srLanToken() {
  if (Date.now() - srTokenAt < 600000) return; srTokenAt = Date.now();
  srRealRpc("pos_lan_token").then(function (r) {
    if (!r || r.error || !r.data) return;
    SR.token = r.data.token; srSet("token", SR.token);
    var ips = r.data.ips || [], ip = ips.find(function (x) { return /^192\.168\.0\./.test(x); }) || ips[0];
    if (ip) { SR.url = "http://" + ip + ":" + (r.data.port || 8080) + "/pos.html"; srSet("url", SR.url); }
  });
}
// Carta: se guarda una copia; sin internet se usa la copia
loadMenu = function () {
  return Promise.all([
    q(sb.from("categories").select("id,name,position").order("position")),
    q(sb.from("dishes").select("id,category_id,name,price,variants,options,available,position,photo_url").order("position"))
  ]).then(function (r) { MENU.cats = r[0]; MENU.dishes = r[1]; srSet("menu", { cats: r[0], dishes: r[1] }); },
    function (e) { var m = srGet("menu"); if (!m) throw e; if (!(MENU.dishes || []).length) { MENU.cats = m.cats; MENU.dishes = m.dishes; } })
    .then(function () { if (!cur.cat && MENU.cats[0]) cur.cat = MENU.cats[0].id; if (cur.order) drawMenu(); }).catch(fail);
};
