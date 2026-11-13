// Modo sin internet (parte 1): si se cae el internet, los pedidos van por la laptop de caja y salen en cocina.
// Funciona cuando la caja se abre desde la laptop (http://IP-DE-LA-LAPTOP:8080/pos.html), que está en el wifi del local.
// Cómo: se envuelve sb.rpc. Con internet todo va a Supabase como siempre (y se guarda una copia de mesas, carta y
// personal). Sin internet, las funciones de pedido se atienden aquí y cada envío a cocina se manda al puente,
// que imprime la comanda y lo sube cuando vuelve la conexión. Cobrar, descontar y anular esperan al internet.
"use strict";
var SR = { on: false, token: "", url: "", tmp: {}, pend: {}, sent: {}, checking: false, lastTry: 0 };
var SR_LOCAL = location.port === "8080" || /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
function srGet(k) { try { return JSON.parse(localStorage.getItem("sr-" + k) || "null"); } catch (e) { return null; } }
function srSet(k, v) { try { localStorage.setItem("sr-" + k, JSON.stringify(v)); } catch (e) { /* sin espacio: se sigue sin copia */ } }
SR.token = srGet("token") || ""; SR.url = srGet("url") || "";
(function () { var s = srGet("orders"); if (s) { SR.tmp = s.tmp || {}; SR.sent = s.sent || {}; } })();
function srSaveOrders() { srSet("orders", { tmp: SR.tmp, sent: SR.sent }); }

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
    srShow("<b>Sin internet.</b> Los pedidos van por la laptop y salen en cocina. Cobrar, descontar y anular se hace cuando vuelva la conexión.");
    toast("Sin internet: los pedidos siguen por la laptop");
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
    SR.tmp = {}; SR.pend = {}; SR.sent = {}; srSaveOrders();
    if (was) {
      toast("Volvió el internet. Lo pedido sin internet se sube en unos segundos.");
      if (cur.order && cur.order < 0) goTables();
      if (U) refreshState().catch(function () {});
    }
  });
}, 8000);

// ---------------------------------------------------------------- Lo que se atiende sin internet
function srTableLabel(t) { return t ? t.area + " " + t.number : "Mesa"; }
function srNewId() { return -(Date.now() % 1e9 * 10 + Math.floor(Math.random() * 10)); }
function srOrderInfo(id) {
  if (SR.tmp[id]) return SR.tmp[id];
  var o = ST && ST.orders.find(function (x) { return x.id === id; });
  if (!o) return null;
  return { id: o.id, kind: o.kind, table_id: o.table_id, label: o.kind === "mesa" ? srTableLabel(tableById(o.table_id)) : o.label, opened_at: o.opened_at, opened_by: o.opened_by, existing: true };
}
function srSentItems(id) { return SR.sent[id] || []; }
var SRH = {
  pos_staff: function () { return srGet("staff") || []; },
  pos_state: function () {
    var s = JSON.parse(JSON.stringify(srGet("st") || ST || { tables: [], orders: [] }));
    s.orders = s.orders || [];
    Object.keys(SR.tmp).forEach(function (k) {
      var t = SR.tmp[k], sum = srSentItems(t.id).reduce(function (a, i) { return a + i.qty * i.unit_price; }, 0);
      s.orders.push({ id: t.id, kind: t.kind, table_id: t.table_id, label: t.label, opened_at: t.opened_at, opened_by: t.opened_by, total: sum, paid: 0, items: srSentItems(t.id).length, ready: 0, offline: true });
    });
    return s;
  },
  pos_check_pin: function (a) {
    var known = (srGet("pins") || {})[a.p_emp];
    if (known && known.h === srPinKey(a.p_emp, a.p_pin)) return { ok: true, name: known.name, can_charge: false };
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
                   opened_at: new Date().toISOString(), opened_by: U ? U.name : "" };
    srSaveOrders(); return id;
  },
  pos_order: function (a) {
    var info = srOrderInfo(a.p_order); if (!info) throw new Error("Pedido no encontrado");
    var items = srSentItems(a.p_order).map(function (i, k) { return Object.assign({ id: -1 - k, status: "enviado" }, i); }).concat((SR.pend[a.p_order] || []).map(function (i, k) { return Object.assign({ id: -100 - k, status: "pendiente" }, i); }));
    var sub = items.reduce(function (s, i) { return s + i.qty * i.unit_price; }, 0), pct = info.kind === "mesa" ? 10 : 0;
    return { id: info.id, kind: info.kind, table_id: info.table_id, label: info.label + (info.existing ? " (lo pedido sin internet)" : ""), status: "abierta", items: items,
             phone: info.phone || "", address: info.address || "", opened_by: info.opened_by || "", opened_at: info.opened_at, service_pct: pct, payments: [], split: null,
             totals: { subtotal: sub, discount: 0, service: Math.round(sub * pct) / 100, delivery: 0, total: sub + Math.round(sub * pct) / 100, paid: 0 } };
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
                                      : { tmp: "sr-" + Math.abs(info.id), kind: info.kind, table_id: info.table_id, label: info.label, phone: info.phone, address: info.address },
                 items: list };
    return srBridge("/api/sinred/enviar", { method: "POST", body: JSON.stringify(body) }).then(function (r) {
      SR.sent[a.p_order] = srSentItems(a.p_order).concat(list); delete SR.pend[a.p_order]; srSaveOrders();
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
  return Promise.resolve(srRealRpc(name, args)).then(function (r) {
    if (srNetErr(r)) {
      return srGoOffline().then(function (on) { return on && SRH[name] ? srAnswer(name, args) : r; });
    }
    // Con internet: se guarda lo necesario para seguir sin él
    if (!r.error) {
      if (name === "pos_state" && r.data) srSet("st", r.data);
      else if (name === "pos_staff" && r.data) srSet("staff", r.data);
      else if (name === "pos_check_pin" && r.data && r.data.ok && args) { var p = srGet("pins") || {}; p[args.p_emp] = { h: srPinKey(args.p_emp, args.p_pin), name: r.data.name }; srSet("pins", p); srLanToken(); }
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
