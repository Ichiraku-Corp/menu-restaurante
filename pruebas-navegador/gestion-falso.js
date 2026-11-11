// Supabase falso para recorrer Gestión en el navegador sin red (lo usa recorrido-gestion.js).
// window.__MENU trae la carta; las tablas viven en window.__G y las llamadas quedan en window.__G.calls.
(function () {
  var M = window.__MENU || { categories: [], dishes: [] };
  var G = window.__G = {
    calls: [],
    tables: {
      categories: M.categories, dishes: M.dishes, cost_areas: [], employees: [], expenses: [], suppliers: [], gestion_settings: [{ id: 1, iva_pct: 16 }],
      ingredients: [{ id: 1, name: "Harina de trigo", buy_unit: "kg", buy_qty: 1, buy_price: 1.5, waste_pct: 0, stock_qty: 0, min_qty: 0 },
                    { id: 2, name: "Cerdo molido", buy_unit: "kg", buy_qty: 1, buy_price: 6, waste_pct: 0, stock_qty: 0, min_qty: 0 }],
      recipe_items: [], price_updates: [], price_history: [], attendance_events: [], inventory_movements: [], customers: [], daily_sales: [], historic_product_sales: []
    }
  };
  var gy = M.dishes.find(function (d) { return d.name === "Gyozas"; });
  if (gy) G.tables.recipe_items = [{ id: 1, dish_id: gy.id, variant: "", ingredient_id: 1, qty: 80, unit: "g", position: 1 }, { id: 2, dish_id: gy.id, variant: "", ingredient_id: 2, qty: 60, unit: "g", position: 2 }];
  function res(data) { return Promise.resolve({ data: data, error: null }); }
  function builder(t) {
    var rows = (G.tables[t] || []).slice(), b = {};
    ["select", "order", "eq", "neq", "gte", "lte", "lt", "gt", "in", "limit", "is", "not", "single", "maybeSingle"].forEach(function (m) { b[m] = function () { return b; }; });
    b.range = function (a, z) { rows = rows.slice(a, z + 1); return b; };
    ["insert", "update", "delete", "upsert"].forEach(function (m) { b[m] = function (v) { G.calls.push({ table: t, op: m, value: v }); rows = []; return b; }; });
    b.then = function (ok, ko) { return res(rows).then(ok, ko); };
    return b;
  }
  var R = {
    can_manage: function () { return true; },
    svc_monthly: function () { return []; }, svc_tabs: function () { return []; },
    svc_month: function (a) { return { month: a.p_month, info: { status: "borrador", rate: 100, max_from_bonus: 40 }, service_pos: 0, tips_pos: 0, service_hist: 0, lines: [], employees: [] }; },
    perf_month: function () { return { no_data: true, people: [], rules: {} }; },
    announcements_admin: function () { return []; },
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
    rpc: function (n, a) {
      return Promise.resolve().then(function () {
        if (!R[n]) return { data: null, error: { message: "función falsa no definida: " + n } };
        try { return { data: R[n](a || {}), error: null }; } catch (e) { return { data: null, error: e }; }
      });
    }
  };
  window.supabase = { createClient: function () { return client; } };
})();
