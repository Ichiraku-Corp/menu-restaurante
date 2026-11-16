// Supabase falso para recorrer Gestión en el navegador sin red (lo usa recorrido-gestion.js).
// window.__MENU trae la carta; las tablas viven en window.__G y las llamadas quedan en window.__G.calls.
(function () {
  var M = window.__MENU || { categories: [], dishes: [] };
  var G = window.__G = {
    calls: [],
    tables: {
      categories: M.categories, dishes: M.dishes, cost_areas: [], expenses: [], suppliers: [],
      employees: [{ id: 11, name: "Ana Pérez", job_title: "Mesonera", area_id: null, pay_quincena: 150, monthly_extra: 40, active: true },
                  { id: 12, name: "Luis Gómez", job_title: "Cocinero", area_id: null, pay_quincena: 180, monthly_extra: 40, active: true },
                  { id: 13, name: "Rosa Díaz", job_title: "Cajera", area_id: null, pay_quincena: 160, monthly_extra: 0, active: false },
                  { id: 14, name: "Marta Socia", job_title: "Socia", area_id: null, pay_quincena: 0, monthly_extra: 0, active: true }],
      payroll_adjustments: [], payroll_payments: [], kitchen_stations: [], gestion_settings: [{ id: 1, iva_pct: 16, report_emails: "", alert_emails: "", alert_cash_diff: 5, meta_pct: 0 }],
      ingredients: [{ id: 1, name: "Harina de trigo", buy_unit: "kg", buy_qty: 1, buy_price: 1.5, waste_pct: 0, stock_qty: 0, min_qty: 0 },
                    { id: 2, name: "Cerdo molido", buy_unit: "kg", buy_qty: 1, buy_price: 6, waste_pct: 0, stock_qty: 0, min_qty: 0 }],
      recipe_items: [], price_updates: [], price_history: [], attendance_events: [], inventory_movements: [], customers: [], daily_sales: [], historic_product_sales: [],
      promos: [{ id: 1, name: "Happy hour", percent: 20, days: [1, 2, 3, 4], start_time: "15:00:00", end_time: "18:00:00", date_from: null, date_to: null, dish_ids: [], category_ids: [3], active: true }]
    }
  };
  var gy = M.dishes.find(function (d) { return d.name === "Gyozas"; });
  if (gy) G.tables.recipe_items = [{ id: 1, dish_id: gy.id, variant: "", ingredient_id: 1, qty: 80, unit: "g", position: 1 }, { id: 2, dish_id: gy.id, variant: "", ingredient_id: 2, qty: 60, unit: "g", position: 2 }];
  function res(data) { return Promise.resolve({ data: data, error: null }); }
  // Tablas «vivas»: lo que se inserta o borra queda (para recorrer la nómina como en la base real)
  var LIVE = { payroll_adjustments: 1, payroll_payments: 1, kitchen_stations: 1 }, nextId = 100;
  function builder(t) {
    var rows = (G.tables[t] || []).slice(), b = {}, filt = [], del = false;
    ["select", "order", "neq", "gte", "lte", "lt", "gt", "in", "limit", "is", "not", "single", "maybeSingle"].forEach(function (m) { b[m] = function () { return b; }; });
    b.eq = function (k, v) { filt.push([k, v]); return b; };
    b.range = function (a, z) { rows = rows.slice(a, z + 1); return b; };
    ["insert", "update", "delete", "upsert"].forEach(function (m) { b[m] = function (v) {
      G.calls.push({ table: t, op: m, value: v });
      if (LIVE[t] && m === "insert") [].concat(v).forEach(function (r) { G.tables[t].push(Object.assign({ id: ++nextId, created_at: new Date().toISOString() }, r)); });
      if (LIVE[t] && m === "delete") del = true;
      rows = []; return b; }; });
    b.then = function (ok, ko) {
      if (del) { del = false; G.tables[t] = G.tables[t].filter(function (r) { return !filt.every(function (f) { return String(r[f[0]]) === String(f[1]); }); }); }
      return res(rows).then(ok, ko);
    };
    return b;
  }
  var R = {
    can_manage: function () { return true; },
    svc_monthly: function () { return []; }, svc_tabs: function () { return []; },
    svc_month: function (a) { return { month: a.p_month, info: { status: "borrador", rate: 100, max_from_bonus: 40 }, service_pos: 0, tips_pos: 0, service_hist: 0, lines: [], employees: [] }; },
    perf_month: function () { return { no_data: true, people: [], rules: {} }; },
    announcements_admin: function () { return []; },
    gestion_promo_guardar: function (a) { G.calls.push({ rpc: "gestion_promo_guardar", args: a }); return 2; },
    gestion_promo_borrar: function (a) { G.calls.push({ rpc: "gestion_promo_borrar", args: a }); },
    gestion_facturas: function (a) { G.calls.push({ rpc: "gestion_facturas", args: a }); var t = new Date().toISOString();
      return [{ id: 2, kind: "compra", path: "2026-11/fedcba9876543210fedcba9876543210.jpg", at: t, por: "Cajera", detalle: { insumos: [{ nombre: "Agua (botella)", cantidad: 12, unidad: "unidad" }] } },
              { id: 1, kind: "salida", path: "2026-11/0123456789abcdef0123456789abcdef.jpg", at: t, por: "Cajera", detalle: { motivo: "Compra de hielo", monto: 5, metodo: "efectivo_usd" } }]; },
    gestion_ventas_hora: function (a) { G.calls.push({ rpc: "gestion_ventas_hora", args: a });
      var c = [], d = new Date(Date.now() - 56 * 864e5).toISOString().slice(0, 10);
      [5, 6, 7].forEach(function (dow) { for (var h = 12; h <= 21; h++) c.push({ dow: dow, hora: h, ventas: dow === 6 && h === 13 ? 85.2 : 10 + h + dow, pedidos: dow === 6 && h === 13 ? 6.5 : 2 }); });
      c.push({ dow: 2, hora: 19, ventas: 12, pedidos: 1 });
      return { desde: d, hasta: new Date().toISOString().slice(0, 10), semanas: a.p_weeks, primera: d, dias: { 2: 3, 5: 8, 6: 8, 7: 8 }, celdas: c }; },
    gestion_nomina: function (a) {
      G.calls.push({ rpc: "gestion_nomina", args: a });
      var d = String(a.p_desde), hoy = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10), man = new Date(Date.parse(hoy) + 864e5).toISOString().slice(0, 10);
      var hasta = d.slice(8) === "01" ? d.slice(0, 8) + "15" : d.slice(0, 8) + new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate();
      return { desde: d, hasta: hasta, tasa: { fecha: hoy, eur: 1009.3413 }, proxima: { fecha: man, eur: 1010.5608 },
        ajustes: G.tables.payroll_adjustments.filter(function (x) { return x.period === d; }).map(function (x) {
          return { id: x.id, employee_id: x.employee_id, kind: x.kind, days: x.days, amount: x.amount_ref, reason: x.reason, source: "manual", por: "dueno@ejemplo.test", at: x.created_at }; }),
        cuentas: [{ employee_id: 12, amount: 7, note: "Pasa a la quincena (excede Ref 40)", at: new Date().toISOString() }],
        pagos: G.tables.payroll_payments.filter(function (x) { return x.period === d; }).map(function (x) {
          return { employee_id: x.employee_id, amount: x.amount_ref, rate: x.rate, bs: x.amount_bs, por: "dueno@ejemplo.test", at: x.created_at }; }) };
    },
    gestion_contador: function (a) {
      G.calls.push({ rpc: "gestion_contador", args: a }); var m = String(a.p_mes), d = function (n) { return m.slice(0, 8) + n; };
      return { mes: m, hasta: d("30"), iva_pct: 16,
        dias: [{ fecha: d("06"), tasa: 990.5, fuente: "syth", tickets: 30, ventas: 325.39, servicio: 17.38, delivery: 0, metodos: {} },
               { fecha: d("14"), tasa: 1009.3413, fuente: "pos", tickets: 61, ventas: 1210.4, servicio: 111.81, delivery: 16.7,
                 metodos: { efectivo_usd: { ref: 420, monto: 420 }, pago_movil: { ref: 350.5, monto: 353774.13 }, punto_debito: { ref: 400.41, monto: 404156.29 }, zelle: { ref: 168, monto: 168 } } }],
        gastos: [{ fecha: m, concepto: "Alquiler", tipo: "Fijo del mes", monto: 900, factura: false }, { fecha: d("14"), concepto: "Compra de hielo & agua <2>", tipo: "Salida de caja (Efectivo $)", monto: 5, factura: true }],
        nomina: [{ quincena: m, empleado: "Ana Pérez", ref: 120, tasa: 1009.3413, bs: 121120.96, fecha: d("15") }] };
    },
    gestion_meta: function () { return { dia: new Date().toISOString().slice(0, 10), meta: 620, vendido: 320.45, pedidos: 21, promedio: 617.94, dias: 8, pct: 0 }; },
    gestion_inicio: function () { return { hoy: new Date().toISOString().slice(0, 10), ventas: 352.5, pedidos: 21, ventas_semana_pasada: 300, pedidos_semana_pasada: 18, abiertas: 3, abiertas_monto: 41.8,
      caja: { abierta_desde: new Date(Date.now() - 5 * 3600e3).toISOString(), por: "Cajera" }, ultimo_cierre: { at: new Date(Date.now() - 20 * 3600e3).toISOString(), por: "Stefan", notas: "", correo: "enviado" },
      laptop: new Date().toISOString(), impresion_atrasada: 0, poco_afuera: ["Agua (botella)"], precios_por_aprobar: 2, pagos_por_comprobar: 0,
      top_hoy: [{ name: "Gyozas", qty: 9 }, { name: "Ramen Naruto", qty: 7 }, { name: "Limonada rosa", qty: 5 }] }; },
    menu_sales: function () { return gy ? [{ dish_id: gy.id, variant: "", units: 40, revenue: 40 * gy.price }] : []; },
    import_data: function (a) {
      var rows = a.p_rows.map(function (r, i) {
        var bad = a.p_kind === "insumos" && !/^(kg|g|l|ml|unidad|kilos|litros)$/i.test(r.unidad || "");
        return { n: i + 1, st: bad ? "error" : "nuevo", msg: bad ? "Unidad no reconocida: «" + (r.unidad || "") + "»" : r.nombre };
      });
      G.calls.push({ rpc: "import_data", args: a });
      var c = function (s) { return rows.filter(function (x) { return x.st === s; }).length; };
      return { dry: a.p_dry, rows: rows, nuevo: c("nuevo"), actualiza: 0, error: c("error") };
    }
  };
  var session = { user: { id: "u1", email: "dueno@ejemplo.test" } };
  var client = {
    auth: {
      onAuthStateChange: function (cb) { setTimeout(function () { cb("SIGNED_IN", session); }, 0); return { data: { subscription: { unsubscribe: function () {} } } }; },
      getSession: function () { return res({ session: session }); },
      signOut: function () { return res(null); }, signInWithPassword: function () { return res({ session: session }); },
      mfa: { getAuthenticatorAssuranceLevel: function () { return res({ currentLevel: "aal2" }); }, listFactors: function () { return res({ totp: [] }); } }
    },
    from: builder,
    storage: { from: function (b) { return { createSignedUrl: function (path, s) { G.calls.push({ storage: b, path: path, secs: s });
      return res({ signedUrl: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#eee"/><text x="20" y="200" font-size="22">Factura</text></svg>') }); } }; } },
    rpc: function (n, a) {
      return Promise.resolve().then(function () {
        if (!R[n]) return { data: null, error: { message: "función falsa no definida: " + n } };
        try { return { data: R[n](a || {}), error: null }; } catch (e) { return { data: null, error: e }; }
      });
    }
  };
  window.supabase = { createClient: function () { return client; } };
})();
