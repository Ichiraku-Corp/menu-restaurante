// Sistema de ventas de Ichiraku (sala y caja). Funciona con supabase/pos.sql.
(function () {
  "use strict";
  var C = window.MENU_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  function show(id, on) { $(id).classList.toggle("hidden", !on); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; }
  var nf2 = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function ref(n) { return "Ref " + nf2.format(n || 0); }
  function bs(n) { return "Bs " + nf2.format(n || 0); }
  function toast(msg, err) { var t = $("toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, err ? 4000 : 2200); }
  function errMsg(e) { return (e && (e.message || e.error_description)) || String(e); }
  function fail(e) { console.error(e); toast(errMsg(e), true); if (/PIN incorrecto/.test(errMsg(e))) lock(); }

  if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY) { show("noconfig", true); return; }
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }

  var METHODS = [
    ["efectivo_usd", "Efectivo $", "REF"], ["efectivo_bs", "Efectivo Bs", "BS"], ["pago_movil", "Pago móvil", "BS"],
    ["punto_debito", "Punto débito", "BS"], ["punto_credito", "Punto crédito", "BS"], ["zelle", "Zelle", "REF"],
    ["binance", "Binance", "REF"], ["paypal", "PayPal", "REF"]];
  var MNAME = {}; METHODS.forEach(function (m) { MNAME[m[0]] = m[1]; });
  // Logos: Zelle, Binance y PayPal de Simple Icons (CC0; las marcas son de sus dueños); los demás son iconos propios.
  var LOGO = {"efectivo_usd": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#15803d\"/><rect x=\"4.5\" y=\"9\" width=\"23\" height=\"14\" rx=\"2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><text x=\"16\" y=\"19.8\" text-anchor=\"middle\" font-family=\"system-ui,sans-serif\" font-size=\"9.5\" font-weight=\"800\" fill=\"#fff\">$</text></svg>", "efectivo_bs": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#166534\"/><rect x=\"4.5\" y=\"9\" width=\"23\" height=\"14\" rx=\"2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><text x=\"16\" y=\"19.8\" text-anchor=\"middle\" font-family=\"system-ui,sans-serif\" font-size=\"7.5\" font-weight=\"800\" fill=\"#fff\">Bs</text></svg>", "pago_movil": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#0f766e\"/><rect x=\"10.5\" y=\"5.5\" width=\"11\" height=\"21\" rx=\"2.5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><circle cx=\"16\" cy=\"22.5\" r=\"1.3\" fill=\"#fff\"/><path d=\"M14 10.5h4.5M16.2 8.5l2.3 2-2.3 2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M18 16.5h-4.5M15.8 14.5l-2.3 2 2.3 2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>", "punto_debito": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#1d4ed8\"/><rect x=\"5\" y=\"9\" width=\"22\" height=\"15\" rx=\"2.5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M5 13.5h22\" stroke=\"#fff\" stroke-width=\"2.6\"/><text x=\"16\" y=\"21.6\" text-anchor=\"middle\" font-family=\"system-ui,sans-serif\" font-size=\"6.2\" font-weight=\"800\" fill=\"#fff\">DÉB</text></svg>", "punto_credito": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#7c3aed\"/><rect x=\"5\" y=\"9\" width=\"22\" height=\"15\" rx=\"2.5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M5 13.5h22\" stroke=\"#fff\" stroke-width=\"2.6\"/><text x=\"16\" y=\"21.6\" text-anchor=\"middle\" font-family=\"system-ui,sans-serif\" font-size=\"6.2\" font-weight=\"800\" fill=\"#fff\">CRÉ</text></svg>", "zelle": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#6d1ed4\"/><g transform=\"translate(6 6) scale(.8333)\"><path fill=\"#fff\" d=\"M13.559 24h-2.841a.483.483 0 0 1-.483-.483v-2.765H5.638a.667.667 0 0 1-.666-.666v-2.234a.67.67 0 0 1 .142-.412l8.139-10.382h-7.25a.667.667 0 0 1-.667-.667V3.914c0-.367.299-.666.666-.666h4.23V.483c0-.266.217-.483.483-.483h2.841c.266 0 .483.217.483.483v2.765h4.323c.367 0 .666.299.666.666v2.137a.67.67 0 0 1-.141.41l-8.19 10.481h7.665c.367 0 .666.299.666.666v2.477a.667.667 0 0 1-.666.667h-4.32v2.765a.483.483 0 0 1-.483.483Z\"/></g></svg>", "binance": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#181a20\"/><g transform=\"translate(6 6) scale(.8333)\"><path fill=\"#f0b90b\" d=\"M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z\"/></g></svg>", "paypal": "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#003087\"/><g transform=\"translate(6 6) scale(.8333)\"><path fill=\"#fff\" d=\"M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087zM19.79 6.142c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.612c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.89-4.906z\"/></g></svg>"};
  function logo(k) { return '<span class="logo">' + (LOGO[k] || "") + "</span>"; }
  var AREAS = ["Feria", "Tokio", "Edo"];
  var IC = {
    send: '<path d="M4 12 20 4l-4 16-4-7-8-1z"/><path d="m12 13 8-9"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    move: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    box: '<path d="M4 7h16v13H4zM2 4h20v3H2zM10 11h4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h10"/>'
  };
  function icon(n) { return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + "</svg>"; }
  function label(id, n, text) { $(id).innerHTML = icon(n) + "<span>" + esc(text) + "</span>"; }
  var AV = ["#e5206b", "#2563c4", "#22784a", "#a85a00", "#7c3aed", "#0f766e", "#b3261e", "#4b5563"];
  function avatar(name, id) { var t = String(name || "?").trim(); return '<span class="avatar" style="background:' + AV[(Number(id) || t.length) % AV.length] + '">' + esc(t.charAt(0).toUpperCase()) + "</span>"; }
  label("precuenta", "receipt", "Precuenta"); label("pay", "cash", "Cobrar"); label("discount", "percent", "Descuento");
  label("move", "move", "Mover"); label("cancel", "x", "Anular pedido"); label("back", "back", "Mesas"); label("btnCaja", "box", "Caja");

  var U = null;              // { id, name, pin } persona que está usando el dispositivo
  var ST = null;             // estado de sala (pos_state)
  var MENU = { cats: [], dishes: [] };
  var cur = { area: null, order: null, data: null, cart: [], cat: null };
  try { cur.area = localStorage.getItem("pos-area") || "Tokio"; } catch (e) { cur.area = "Tokio"; }

  // ---------------------------------------------------------------- Dispositivo y PIN
  sb.auth.onAuthStateChange(function (_e, session) {
    setTimeout(function () { session ? startDevice() : deviceLogin(); }, 0);
  });
  function deviceLogin() {
    U = null; ["pin", "tablesView", "orderView", "btnCaja", "btnUser"].forEach(function (id) { show(id, false); }); show("device", true);
  }
  $("device").addEventListener("submit", function (e) {
    e.preventDefault(); $("devErr").textContent = "";
    sb.auth.signInWithPassword({ email: $("devEmail").value.trim(), password: $("devPass").value })
      .then(function (r) { if (r.error) $("devErr").textContent = "No se pudo activar: " + r.error.message; });
  });
  $("devOut").addEventListener("click", function () { if (confirm("¿Desactivar este dispositivo? Habrá que volver a escribir la cuenta de sala.")) sb.auth.signOut(); });

  var staffList = [];
  function startDevice() {
    show("device", false);
    q(sb.rpc("pos_staff")).then(function (list) {
      staffList = list || [];
      if (!staffList.length) { $("people").innerHTML = '<p class="muted">Esta cuenta no está autorizada como dispositivo de sala, o nadie tiene PIN todavía (Gestión → Nómina).</p>'; }
      lock();
    }).catch(fail);
    loadMenu();
  }
  function lock() {
    U = null; pinBuf = ""; selected = null;
    ["tablesView", "orderView", "btnCaja", "btnUser"].forEach(function (id) { show(id, false); }); show("pin", true); show("padBox", false);
    $("people").innerHTML = staffList.map(function (s) { return '<button type="button" data-emp="' + s.id + '">' + avatar(s.name, s.id) + "<span>" + esc(s.name) + "</span></button>"; }).join("");
    closeDialogs();
  }
  var selected = null, pinBuf = "";
  $("people").addEventListener("click", function (e) {
    var b = e.target.closest("[data-emp]"); if (!b) return;
    selected = staffList.find(function (s) { return String(s.id) === b.dataset.emp; });
    document.querySelectorAll("#people button").forEach(function (x) { x.classList.toggle("on", x === b); });
    pinBuf = ""; $("pinErr").textContent = ""; drawDots(); show("padBox", true);
  });
  $("pad").innerHTML = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].map(function (k) { return '<button type="button" data-k="' + k + '">' + k + "</button>"; }).join("");
  function drawDots() { $("dots").textContent = "●".repeat(pinBuf.length) + "○".repeat(Math.max(0, 4 - pinBuf.length)); }
  $("pad").addEventListener("click", function (e) {
    var b = e.target.closest("[data-k]"); if (!b || !selected) return;
    var k = b.dataset.k;
    if (k === "⌫") pinBuf = pinBuf.slice(0, -1);
    else if (k === "✓" || pinBuf.length < 4) { if (k !== "✓") pinBuf += k; }
    drawDots();
    if (pinBuf.length === 4) tryPin();
  });
  function tryPin() {
    var emp = selected, pin = pinBuf;
    q(sb.rpc("pos_check_pin", { p_emp: emp.id, p_pin: pin })).then(function (r) {
      if (!r || !r.ok) { pinBuf = ""; drawDots(); $("pinErr").textContent = (r && r.error) || "PIN incorrecto"; return; }
      U = { id: emp.id, name: r.name || emp.name, pin: pin };
      show("pin", false); show("btnCaja", true); show("btnUser", true); $("btnUser").innerHTML = avatar(U.name, U.id) + "<span>" + esc(U.name) + ' · <span class="muted">Salir</span></span>';
      touch(); goTables();
    }).catch(fail);
  }
  $("btnUser").addEventListener("click", lock);
  // Bloqueo automático tras 3 minutos sin uso.
  var idle;
  function touch() { clearTimeout(idle); if (U) idle = setTimeout(function () { toast("Sesión bloqueada por inactividad"); lock(); }, 180000); }
  ["pointerdown", "keydown"].forEach(function (ev) { document.addEventListener(ev, touch, true); });

  function rpc(name, args) { return q(sb.rpc(name, Object.assign({ p_emp: U.id, p_pin: U.pin }, args || {}))); }

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
    $("banners").innerHTML = h;
  }

  // ---------------------------------------------------------------- Mesas
  function goTables() {
    cur.order = null; cur.data = null; cur.cart = [];
    show("orderView", false); show("tablesView", true);
    refreshState().then(drawTables).catch(fail);
  }
  function drawTables() {
    if (!ST) return;
    $("areas").innerHTML = AREAS.concat(["Para llevar", "Delivery", "Por cobrar"]).map(function (a) {
      var n = a === "Para llevar" ? ST.orders.filter(function (o) { return o.kind === "llevar"; }).length
        : a === "Delivery" ? ST.orders.filter(function (o) { return o.kind === "delivery"; }).length
        : a === "Por cobrar" ? ST.orders.length
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
    if (cur.area === "Por cobrar") {
      var all = ST.orders.slice().sort(function (a, b) { return (b.precuenta_at ? 1 : 0) - (a.precuenta_at ? 1 : 0) || new Date(a.opened_at) - new Date(b.opened_at); });
      var due = all.reduce(function (s, o) { return s + num(o.total) - num(o.paid); }, 0), asked = all.filter(function (o) { return o.precuenta_at; }).length;
      $("areaBody").innerHTML = '<div class="card"><div class="row between"><b style="font-size:20px">' + all.length + " pedidos abiertos · " + ref(due) + " por cobrar</b>" +
        '<span class="muted">' + asked + " pidieron la cuenta</span></div>" + (all.length ? '<table class="tbl" style="margin-top:8px"><thead><tr><th>Pedido</th><th>Tiempo</th><th>Estado</th><th class="r">Total</th><th class="r">Falta</th></tr></thead><tbody>' +
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
  function tableCard(o, title, attr) {
    var m = Math.round((Date.now() - new Date(o.opened_at).getTime()) / 60000), cls = (o.precuenta_at ? "bill" : "busy") + (o.pending ? " has-pend" : "");
    return '<button type="button" class="' + cls + '" ' + attr + '><span class="st">' + (o.precuenta_at ? "Pidió la cuenta" : o.items ? "Comiendo" : "Abierta") + '</span><span class="num">' + title + "</span>" +
      '<span class="amt">' + ref(num(o.total) - num(o.paid)) + "</span><small>" + esc(o.opened_by || "") + ' · <span class="' + (m >= 60 ? "late" : "") + '">' + mins(o.opened_at) + "</span></small>" + badges(o) + "</button>";
  }
  function badges(o) {
    return (o.pending ? '<span class="pend">sin enviar</span>' : "") + (num(o.paid) > 0 ? '<span class="pill paid">abonó ' + ref(num(o.paid)) + "</span>" : "");
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

  // ---------------------------------------------------------------- Pedido
  function openOrder(id) {
    cur.order = id; cur.cart = []; $("search").value = "";
    show("tablesView", false); show("orderView", true); $("orderGrid").classList.remove("show-menu");
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
    var vs = variantsOf(d), ops = d.options || [];
    if (!vs && !ops.length) { addToCart({ dish: d, variant: "", option: "", qty: 1, notes: "" }); return; }
    pickDish(d);
  });
  var pick = null;
  function pickDish(d) {
    pick = { dish: d, variant: "", option: "", qty: 1 };
    var vs = variantsOf(d), ops = d.options || [];
    $("dishTitle").textContent = d.name;
    $("dishVariants").innerHTML = vs ? '<div class="muted">Tamaño</div><div class="chips">' + vs.map(function (v) { return '<button type="button" data-v="' + esc(v.label) + '">' + esc(v.label) + " · " + ref(num(v.price)) + "</button>"; }).join("") + "</div>" : "";
    $("dishOptions").innerHTML = ops.length ? '<div class="muted">Sabor</div><div class="chips">' + ops.map(function (o) { return '<button type="button" data-o="' + esc(o) + '">' + esc(o) + "</button>"; }).join("") + "</div>" : "";
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
    if ((pick.dish.options || []).length && !pick.option) return toast("Elige el sabor", true);
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
        '</span><span class="p">' + ref(num(i.qty) * num(i.unit_price)) + "</span></div>";
    });
    cur.cart.forEach(function (c, ix) {
      h += '<div class="line new" data-cart="' + ix + '"><span class="qty"><button type="button" data-dec aria-label="Uno menos">−</button><b>' + c.qty + '</b><button type="button" data-inc aria-label="Uno más">+</button></span><span class="t"><span>' + esc(c.dish.name) + (c.variant ? " " + esc(c.variant) : "") + "</span>" +
        (c.option ? "<small>" + esc(c.option) + "</small>" : "") + (c.notes ? "<small>» " + esc(c.notes) + "</small>" : "") + '<small>nuevo, sin enviar</small></span><span class="p">' +
        ref(c.qty * priceOf(c.dish, c.variant)) + "</span></div>";
    });
    $("lines").innerHTML = h || '<p class="emptyline">Sin platos todavía.<br>Elige de la carta.</p>';
    var t = d.totals, cartSum = cur.cart.reduce(function (s, c) { return s + c.qty * priceOf(c.dish, c.variant); }, 0), rate = ST && ST.rate;
    var sub = num(t.subtotal) + cartSum, disc = Math.min(num(t.discount), sub), svc = Math.round((sub - disc) * num(d.service_pct)) / 100, dl = num(t.delivery), tot = sub - disc + svc + dl, paid = num(t.paid);
    $("totals").innerHTML = '<div class="tot"><span>Subtotal</span><span>' + ref(sub) + "</span></div>" +
      (disc ? '<div class="tot"><span>Descuento' + (d.discount_reason ? " (" + esc(d.discount_reason) + ")" : "") + "</span><span>−" + ref(disc) + "</span></div>" : "") +
      (svc ? '<div class="tot"><span>Servicio ' + num(d.service_pct) + " %</span><span>" + ref(svc) + "</span></div>" : "") +
      (dl ? '<div class="tot"><span>Delivery</span><span>' + ref(dl) + "</span></div>" : "") +
      '<div class="tot big"><span>Total</span><span>' + ref(tot) + "</span></div>" +
      (paid ? '<div class="tot"><span>Abonado</span><span>−' + ref(paid) + '</span></div><div class="tot big"><span>Falta</span><span>' + ref(tot - paid) + "</span></div>" : "") +
      (rate ? '<div class="tot muted"><span>En bolívares</span><span>' + bs(Math.round((tot - paid) * rate * 100) / 100) + "</span></div>" : "") +
      (d.precuenta_at ? '<div class="muted">Precuenta impresa a las ' + new Date(d.precuenta_at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) + "</div>" : "");
    var pending = cur.cart.length + d.items.filter(function (i) { return i.status === "pendiente"; }).length;
    label("send", "send", pending ? "Enviar a cocina (" + pending + ")" : "Enviar a cocina");
    $("send").disabled = !pending;
    var hasItems = d.items.some(function (i) { return i.status !== "anulado"; });
    $("pay").disabled = !hasItems || pending > 0; $("precuenta").disabled = !hasItems || pending > 0;
    $("move").classList.toggle("hidden", d.kind !== "mesa");
    $("cancel").disabled = paid > 0;
    var ed = $("editDeliv"); if (ed) ed.onclick = function () { delivForm(d); };
  }
  function fmtQ(n) { n = num(n); return n % 1 ? nf2.format(n) : String(n); }

  $("lines").addEventListener("click", function (e) {
    var c = e.target.closest("[data-cart]");
    if (c) {
      var ci = Number(c.dataset.cart), it0 = cur.cart[ci];
      if (e.target.closest("[data-inc]")) it0.qty = Math.min(50, it0.qty + 1);
      else if (e.target.closest("[data-dec]")) { it0.qty -= 1; if (it0.qty <= 0) cur.cart.splice(ci, 1); }
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
  $("precuenta").addEventListener("click", function () { rpc("pos_precuenta", { p_order: cur.order }).then(function () { toast("Precuenta enviada a caja"); }).catch(fail); });
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

  // ---------------------------------------------------------------- Delivery
  var delivEdit = null;
  function delivForm(d) {
    delivEdit = d; $("delivTitle").textContent = d ? "Datos del delivery" : "Nuevo delivery"; $("dErr").textContent = "";
    $("dName").value = d ? d.customer : ""; $("dPhone").value = d ? d.phone : ""; $("dAddr").value = d ? d.address : ""; $("dFee").value = d ? num(d.delivery_fee) : "0";
    $("delivDlg").showModal(); setTimeout(function () { $("dName").focus(); }, 50);
  }
  $("dCancel").addEventListener("click", function () { $("delivDlg").close(); });
  $("dOk").addEventListener("click", function () {
    var a = { p_name: $("dName").value.trim(), p_phone: $("dPhone").value.trim(), p_address: $("dAddr").value.trim(), p_fee: num($("dFee").value) };
    if (a.p_name.length < 2) { $("dErr").textContent = "Escribe el nombre del cliente."; return; }
    (delivEdit ? rpc("pos_set_delivery", Object.assign({ p_order: delivEdit.id }, a)).then(function () { return delivEdit.id; }) : rpc("pos_open_delivery", a))
      .then(function (id) { $("delivDlg").close(); return openOrder(id); }).catch(function (e) { $("dErr").textContent = errMsg(e); });
  });

  // ---------------------------------------------------------------- Cobro
  var pays = [], changeCur = "REF";
  $("pay").addEventListener("click", function () {
    refreshState().then(function () {
      if (!ST.session) { toast("La caja está cerrada: ábrela en «Caja»", true); return; }
      pays = []; changeCur = "REF"; $("payErr").textContent = "";
      var t = cur.data.totals;
      $("payTitle").textContent = "Cobrar · " + cur.data.label;
      var dueNow = num(t.total) - num(t.paid); splitN = 0;
      $("payTotal").textContent = ref(dueNow) + (num(t.paid) ? " (de " + ref(num(t.total)) + ")" : "");
      $("payRateTxt").textContent = ST.rate ? "Tasa € BCV " + nf2.format(ST.rate) : "Sin tasa: solo divisas";
      $("payTotalBs").textContent = ST.rate ? bs(Math.round(dueNow * ST.rate * 100) / 100) : "";
      $("payMethods").innerHTML = METHODS.map(function (m) { return '<button type="button" class="mbtn" data-m="' + m[0] + '"' + (m[2] === "BS" && !ST.rate ? " disabled" : "") + ">" + logo(m[0]) + "<span>" + m[1] + "</span></button>"; }).join("");
      drawPays(); $("payDlg").showModal();
    }).catch(fail);
  });
  function payRef(p) { var m = METHODS.find(function (x) { return x[0] === p.method; }); return m[2] === "REF" ? num(p.amount) : (ST.rate ? num(p.amount) / ST.rate : 0); }
  var splitN = 0;
  function paySums() { if (!cur.data) return { total: 0, paid: 0, rest: 0 }; var total = num(cur.data.totals.total) - num(cur.data.totals.paid), paid = pays.reduce(function (s, p) { return s + payRef(p); }, 0); return { total: total, paid: paid, rest: Math.round((total - paid) * 100) / 100 }; }
  $("payMethods").addEventListener("click", function (e) {
    var b = e.target.closest("[data-m]"); if (!b || b.disabled) return;
    var m = METHODS.find(function (x) { return x[0] === b.dataset.m; }), s = paySums(), rest = Math.max(0, s.rest);
    if (splitN > 1) rest = Math.min(rest, Math.ceil(s.total / splitN * 100) / 100);
    pays.push({ method: m[0], amount: m[2] === "REF" ? rest.toFixed(2) : (Math.round(rest * ST.rate * 100) / 100).toFixed(2), reference: "" });
    drawPays();
    var inputs = document.querySelectorAll("#payLines .amt"); if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
  });
  function drawPays() {
    $("payLines").innerHTML = pays.map(function (p, i) {
      var m = METHODS.find(function (x) { return x[0] === p.method; }), needRef = ["pago_movil", "zelle", "binance", "paypal", "punto_debito", "punto_credito"].indexOf(p.method) >= 0;
      return '<div class="pay" data-i="' + i + '"><b class="mname">' + logo(m[0]) + m[1] + '</b><input class="amt n" inputmode="decimal" value="' + esc(p.amount) + '" aria-label="Monto en ' + (m[2] === "REF" ? "dólares" : "bolívares") + '">' +
        '<input class="refin" placeholder="' + (needRef ? "Referencia (opcional)" : "—") + '" value="' + esc(p.reference) + '"' + (needRef ? "" : " disabled") + '>' +
        '<button type="button" class="danger del" aria-label="Quitar">✕</button><span class="muted" style="grid-column:1/-1;margin-top:-4px">' + (m[2] === "REF" ? "en divisas" : "en bolívares") + "</span></div>";
    }).join("");
    updatePaySums();
  }
  function updatePaySums() {
    var s = paySums();
    $("payPaid").textContent = ref(s.paid);
    if (s.rest > 0.009) { $("payRestLbl").textContent = "Falta"; $("payRest").textContent = ref(s.rest) + (ST.rate ? " · " + bs(Math.round(s.rest * ST.rate * 100) / 100) : ""); show("changeBox", false); }
    else if (s.rest < -0.009) {
      $("payRestLbl").textContent = "Vuelto"; var ch = -s.rest;
      $("payRest").textContent = changeCur === "BS" && ST.rate ? bs(Math.round(ch * ST.rate * 100) / 100) : "$ " + nf2.format(ch);
      show("changeBox", true);
    } else { $("payRestLbl").textContent = "Completo"; $("payRest").textContent = "✓"; show("changeBox", false); }
    document.querySelectorAll("#changeCur button").forEach(function (b) { b.classList.toggle("on", b.dataset.cur === changeCur); b.disabled = b.dataset.cur === "BS" && !ST.rate; });
    $("payOk").disabled = !pays.length || s.rest > 0.02;
    show("payPartial", pays.length > 0 && s.rest > 0.02 && s.paid > 0);
    $("payPartial").textContent = "Cobrar solo " + ref(s.paid) + " (abono)";
  }
  $("paySplit").addEventListener("click", function () {
    ask({ title: "Dividir la cuenta", help: "¿Entre cuántas personas? Cada método que toques pondrá la parte de una persona.", value: "2", type: "number" }).then(function (v) {
      if (v === null) return; splitN = Math.max(1, Math.round(num(v)));
      toast(splitN > 1 ? "Cada parte: " + ref(Math.ceil(paySums().total / splitN * 100) / 100) : "Sin dividir");
    });
  });
  $("payPartial").addEventListener("click", function () { doPay(true); });
  $("payLines").addEventListener("input", function (e) {
    var row = e.target.closest("[data-i]"); if (!row) return; var p = pays[Number(row.dataset.i)];
    if (e.target.classList.contains("amt")) p.amount = e.target.value; else if (e.target.classList.contains("refin")) p.reference = e.target.value;
    updatePaySums();
  });
  $("payLines").addEventListener("click", function (e) { var b = e.target.closest(".del"); if (!b) return; pays.splice(Number(b.closest("[data-i]").dataset.i), 1); drawPays(); });
  $("changeCur").addEventListener("click", function (e) { var b = e.target.closest("[data-cur]"); if (!b || b.disabled) return; changeCur = b.dataset.cur; updatePaySums(); });
  $("payCancel").addEventListener("click", function () { $("payDlg").close(); });
  var paying = false;
  $("payOk").addEventListener("click", function () { doPay(false); });
  function doPay(partial) {
    if (paying) return; paying = true; $("payOk").disabled = true; $("payErr").textContent = "";
    var list = pays.map(function (p) { return { method: p.method, amount: num(p.amount), reference: p.reference }; }).filter(function (p) { return p.amount > 0; });
    rpc("pos_pay", { p_order: cur.order, p_payments: list, p_change_currency: changeCur, p_partial: partial }).then(function (r) {
      $("payDlg").close();
      if (r && r.closed === false) { toast("Abono de " + ref(r.paid) + " · falta " + ref(r.rest)); return loadOrder(); }
      var ch = r && r.change;
      toast("Cobrado " + ref(r.total) + (ch ? " · Vuelto " + (ch.currency === "BS" ? bs(ch.amount) : "$ " + nf2.format(ch.amount)) : ""));
      if (ch) alert("Entrega de vuelto: " + (ch.currency === "BS" ? bs(ch.amount) : "$ " + nf2.format(ch.amount)));
      goTables();
    }).catch(function (e) { $("payErr").textContent = errMsg(e); if (/PIN incorrecto/.test(errMsg(e))) lock(); })
      .then(function () { paying = false; if (cur.data) updatePaySums(); });
  }

  // ---------------------------------------------------------------- Caja
  $("btnCaja").addEventListener("click", function () { openCash(); });
  $("cashClose").addEventListener("click", function () { $("cashDlg").close(); });
  function openCash() {
    refreshState().then(function () { return q(sb.rpc("pos_cash_summary")); }).then(function (sm) {
      var h = '<div class="card" style="margin:10px 0"><div class="row between"><div><b>Tasa euro BCV de hoy</b><div class="muted">' +
        (ST.rate ? nf2.format(ST.rate) + " Bs/€" + (ST.rate_date !== today() ? " (es de otro día)" : "") : "Sin tasa") +
        '</div></div><button type="button" id="setRate">Escribir tasa</button></div><p class="muted" style="margin-bottom:0">Se actualiza sola desde el BCV a través de la laptop de caja; aquí puedes corregirla.</p></div>';
      if (!sm) {
        h += '<div class="card"><h3 style="margin-top:0">Abrir caja</h3><div class="row"><label class="grow">Fondo en efectivo $<input id="fUsd" inputmode="decimal" value="0"></label>' +
          '<label class="grow">Fondo en efectivo Bs<input id="fBs" inputmode="decimal" value="0"></label></div><p><button type="button" class="primary big" id="openCash" style="width:100%">Abrir caja</button></p></div>';
      } else {
        var rows = METHODS.map(function (m) {
          var v = sm.methods[m[0]] ? num(sm.methods[m[0]].amount) : 0, exp = v + (m[0] === "efectivo_usd" ? num(sm.opening_usd) : m[0] === "efectivo_bs" ? num(sm.opening_bs) : 0);
          return '<tr><td><span class="mname">' + logo(m[0]) + m[1] + '</span></td><td class="r">' + (m[2] === "REF" ? "$ " : "Bs ") + nf2.format(exp) + '</td><td><input class="cnt n" data-m="' + m[0] + '" inputmode="decimal" placeholder="Contado" style="padding:6px 8px"></td></tr>';
        }).join("");
        h += '<div class="card"><div class="row between"><b>Caja abierta</b><span class="muted">desde ' + new Date(sm.opened_at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) + " por " + esc(sm.opened_by || "") + "</span></div>" +
          '<div class="tot"><span>Pedidos cobrados</span><b>' + sm.orders + '</b></div><div class="tot"><span>Ventas (con IVA)</span><b>' + ref(num(sm.sales)) + '</b></div><div class="tot"><span>Servicio</span><b>' + ref(num(sm.service)) + "</b></div>" +
          (sm.open_orders ? '<div class="banner warn">Hay ' + sm.open_orders + " pedidos abiertos: cóbralos o anúlalos antes de cerrar.</div>" : "") +
          '<h3>Cierre: escribe lo que hay en cada método</h3><table class="tbl"><thead><tr><th>Método</th><th class="r">Esperado</th><th>Contado</th></tr></thead><tbody>' + rows + "</tbody></table>" +
          "<h3>Anulaciones (" + sm.voids.length + ")</h3>" + (sm.voids.length ? sm.voids.map(function (v) { return '<div class="muted">' + esc(v.order) + " · " + fmtQ(v.qty) + " " + esc(v.item) + " · " + ref(num(v.amount)) + " · " + esc(v.by || "") + "<br>Motivo: " + esc(v.reason) + "</div>"; }).join("<hr>") : '<p class="muted">Ninguna</p>') +
          "<h3>Descuentos (" + sm.discounts.length + ")</h3>" + (sm.discounts.length ? sm.discounts.map(function (v) { return '<div class="muted">' + esc(v.order) + " · " + ref(num(v.amount)) + " · " + esc(v.by || "") + " · " + esc(v.reason) + "</div>"; }).join("") : '<p class="muted">Ninguno</p>') +
          '<textarea id="cashNotes" placeholder="Notas del cierre (opcional)" style="margin-top:10px"></textarea>' +
          '<p><button type="button" class="primary big" id="doClose" style="width:100%"' + (sm.open_orders ? " disabled" : "") + ">Cerrar caja e imprimir el cierre</button></p></div>";
      }
      h += '<div class="card"><div class="row"><button type="button" id="soldOut" class="grow">Platos agotados</button><button type="button" id="invCount" class="grow">Conteo de inventario</button></div></div>';
      $("cashBody").innerHTML = h;
      if (!$("cashDlg").open) $("cashDlg").showModal();
    }).catch(fail);
  }
  $("cashBody").addEventListener("click", function (e) {
    var id = e.target.id;
    if (id === "setRate") {
      ask({ title: "Tasa del euro BCV (Bs por 1 €)", help: "Escribe la tasa oficial de hoy.", value: ST.rate || "", type: "number" }).then(function (v) {
        if (v === null) return; return rpc("pos_set_rate", { p_rate: num(v), p_source: "manual" }).then(function () { toast("Tasa guardada"); openCash(); });
      }).catch(fail);
    } else if (id === "openCash") {
      rpc("pos_cash_open", { p_usd: num($("fUsd").value), p_bs: num($("fBs").value) }).then(function () { toast("Caja abierta"); openCash(); }).catch(fail);
    } else if (id === "soldOut") { openSoldOut();
    } else if (id === "invCount") { openCount();
    } else if (id === "doClose") {
      var counted = {}; document.querySelectorAll("#cashBody .cnt").forEach(function (i) { if (i.value.trim() !== "") counted[i.dataset.m] = num(i.value); });
      if (!confirm("¿Cerrar la caja? Se imprimirá el cierre y las ventas pasarán a la gestión.")) return;
      rpc("pos_cash_close", { p_counted: counted, p_notes: $("cashNotes").value.trim() }).then(function () { toast("Caja cerrada. Cierre enviado a la impresora."); $("cashDlg").close(); refreshState(); }).catch(fail);
    }
  });

  // ---------------------------------------------------------------- Agotados e inventario
  var listMode = null, invRows = [];
  function openSoldOut() {
    listMode = "agotados"; $("listTitle").textContent = "Platos agotados"; $("listHelp").textContent = "Toca un plato para marcarlo agotado o disponible. Se oculta en la carta y nadie puede pedirlo.";
    $("listSearch").value = ""; drawList(); $("listFoot").innerHTML = ""; $("listDlg").showModal();
  }
  function openCount() {
    q(sb.rpc("pos_inventory")).then(function (rows) {
      invRows = rows || []; listMode = "inventario"; $("listTitle").textContent = "Conteo de inventario";
      $("listHelp").textContent = invRows.length ? "Escribe lo que hay de verdad, en la unidad de compra. Deja en blanco lo que no contaste." : "Todavía no hay insumos cargados. Se cargan en Gestión → Insumos.";
      $("listSearch").value = ""; drawList();
      $("listFoot").innerHTML = invRows.length ? '<button type="button" class="primary big" id="saveCount" style="width:100%">Guardar conteo</button>' : "";
      $("listDlg").showModal();
    }).catch(fail);
  }
  function drawList() {
    var term = $("listSearch").value.trim().toLowerCase();
    if (listMode === "agotados") {
      $("listBody").innerHTML = '<div class="dishes">' + MENU.dishes.filter(function (d) { return !term || d.name.toLowerCase().indexOf(term) >= 0; }).map(function (d) {
        return '<button type="button" data-av="' + d.id + '"' + (d.available ? "" : ' style="background:var(--danger);color:#fff;border-color:var(--danger)"') + ">" + esc(d.name) + "<span" + (d.available ? "" : ' style="color:#fff"') + ">" + (d.available ? "Disponible" : "AGOTADO") + "</span></button>";
      }).join("") + "</div>";
    } else {
      $("listBody").innerHTML = '<table class="tbl"><thead><tr><th>Insumo</th><th class="r">Sistema</th><th>Contado</th></tr></thead><tbody>' + invRows.filter(function (r) { return !term || r.name.toLowerCase().indexOf(term) >= 0; }).map(function (r) {
        var low = num(r.stock) <= num(r.min) && num(r.min) > 0;
        return "<tr><td>" + esc(r.name) + (low ? ' <span class="pend" style="background:var(--warn);color:#fff;border-radius:999px;padding:0 8px;font-size:12px">bajo</span>' : "") + '</td><td class="r">' + nf2.format(num(r.stock)) + " " + esc(r.unit) +
          '</td><td><input class="cnt n" data-ing="' + r.id + '" inputmode="decimal" placeholder="' + esc(r.unit) + '" style="padding:6px 8px" value="' + esc(r._c || "") + '"></td></tr>';
      }).join("") + "</tbody></table>";
    }
  }
  $("listSearch").addEventListener("input", function () {
    document.querySelectorAll("#listBody [data-ing]").forEach(function (i) { var r = invRows.find(function (x) { return String(x.id) === i.dataset.ing; }); if (r) r._c = i.value; });
    drawList();
  });
  $("listBody").addEventListener("input", function (e) { var i = e.target.closest("[data-ing]"); if (!i) return; var r = invRows.find(function (x) { return String(x.id) === i.dataset.ing; }); if (r) r._c = i.value; });
  $("listBody").addEventListener("click", function (e) {
    var b = e.target.closest("[data-av]"); if (!b) return;
    var d = MENU.dishes.find(function (x) { return x.id === Number(b.dataset.av); });
    rpc("pos_set_available", { p_dish: d.id, p_available: !d.available }).then(function () { d.available = !d.available; toast(d.name + (d.available ? " disponible" : " AGOTADO")); drawList(); drawMenu(); }).catch(fail);
  });
  $("listFoot").addEventListener("click", function (e) {
    if (e.target.id !== "saveCount") return;
    var counts = invRows.filter(function (r) { return r._c != null && String(r._c).trim() !== ""; }).map(function (r) { return { id: r.id, qty: num(r._c) }; });
    if (!counts.length) return toast("No escribiste ninguna cantidad", true);
    rpc("pos_count", { p_counts: counts }).then(function (n) { toast("Conteo guardado (" + n + " insumos)"); $("listDlg").close(); }).catch(fail);
  });
  $("listClose").addEventListener("click", function () { $("listDlg").close(); });

  // ---------------------------------------------------------------- Diálogo de texto
  var askResolve = null, askCfg = null;
  function ask(cfg) {
    askCfg = cfg; $("askTitle").textContent = cfg.title; $("askHelp").textContent = cfg.help || ""; $("askErr").textContent = "";
    var i = $("askInput"); i.value = cfg.value == null ? "" : cfg.value; i.setAttribute("inputmode", cfg.type === "number" ? "decimal" : "text");
    $("askDlg").showModal(); setTimeout(function () { i.focus(); i.select(); }, 50);
    return new Promise(function (res) { askResolve = res; });
  }
  function askDone(v) { var r = askResolve; askResolve = null; $("askDlg").close(); if (r) r(v); }
  $("askOk").addEventListener("click", function () {
    var v = $("askInput").value.trim();
    if (askCfg.required && v.length < askCfg.required) { $("askErr").textContent = "Escribe al menos " + askCfg.required + " letras."; return; }
    askDone(v);
  });
  $("askInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("askOk").click(); } });
  $("askCancel").addEventListener("click", function () { askDone(null); });
  $("askDlg").addEventListener("cancel", function () { if (askResolve) { var r = askResolve; askResolve = null; r(null); } });

  function anyDialogOpen() { return Array.prototype.some.call(document.querySelectorAll("dialog"), function (d) { return d.open; }); }
  function closeDialogs() { document.querySelectorAll("dialog").forEach(function (d) { if (d.open) d.close(); }); if (askResolve) { var r = askResolve; askResolve = null; r(null); } }
})();
