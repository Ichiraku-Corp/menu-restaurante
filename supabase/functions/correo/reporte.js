// GENERADO por scripts/reporte-correo.js desde reporte-cierre.js: no editar a mano.
// deno-lint-ignore-file
// @ts-nocheck
const module = { exports: {} };
/* Reporte de cierre de caja de Ichiraku: el mismo HTML se ve en la pantalla de la cajera
   (vista previa antes de cerrar) y llega por correo (lo envía el puente de la laptop). */
(function (root) {
const MNAMES = { efectivo_usd: "Efectivo $", efectivo_bs: "Efectivo Bs", pago_movil: "Pago móvil", punto_debito: "Punto débito",
  punto_credito: "Punto crédito", zelle: "Zelle", binance: "Binance", paypal: "PayPal", cuenta: "A cuenta (empleado)", yummy: "Yummy (por cobrar)" };
const FUERA = new Set(["cuenta", "yummy"]);   // no entran a la gaveta: no se cuentan en el arqueo
const BS = new Set(["efectivo_bs", "pago_movil", "punto_debito", "punto_credito"]);
const fm = (n) => Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fq = (n) => Number(n || 0).toLocaleString("es-VE", { maximumFractionDigits: 2 });
const hh = (t) => (t ? new Date(t).toLocaleString("es-VE", { timeZone: "America/Caracas", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const he = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function table(head, rows, right) {
  const th = head.map((h, i) => `<th style="text-align:${right.includes(i) ? "right" : "left"};padding:6px 8px;border-bottom:2px solid #333;font-size:12px;text-transform:uppercase;color:#555">${h}</th>`).join("");
  const tr = rows.map((r) => "<tr>" + r.map((c, i) => `<td style="text-align:${right.includes(i) ? "right" : "left"};padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top">${c}</td>`).join("") + "</tr>").join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:6px 0 18px">${th ? "<thead><tr>" + th + "</tr></thead>" : ""}<tbody>${tr || `<tr><td style="padding:6px 8px;color:#777">Ninguno</td></tr>`}</tbody></table>`;
}
function reportHtml(d) {
  if (d && d.kind === "semanal") return weekHtml(d);
  if (d && d.kind === "alerta") return alertHtml(d);
  const prev = d.preview ? `<p style="background:#fff4d6;border:1px solid #e9b949;border-radius:8px;padding:8px 10px;margin:0 0 12px"><b>Vista previa</b> · todavía no se ha cerrado la caja. Se enviará a: ${he(d.recipients || "(sin correos configurados)")}</p>` : "";
  const s = d.session || {}, t = d.totals || {}, exp = s.expected || {}, cnt = s.counted || {};
  const H = (x) => `<h2 style="font-size:17px;margin:22px 0 4px;color:#e5206b">${x}</h2>`;
  const methods = Object.keys(MNAMES).filter((k) => Number(exp[k] || 0) !== 0 || k in cnt).map((k) => {
    const cur = BS.has(k) ? "Bs " : "$ ", m = (d.methods || []).find((x) => x.method === k) || {};
    const diff = k in cnt ? Number(cnt[k]) - Number(exp[k] || 0) : null;
    if (FUERA.has(k)) return [MNAMES[k], m.count || 0, cur + fm(m.amount), "Ref " + fm(m.amount_ref), "no va en la caja", "", ""];
    return [MNAMES[k], m.count || 0, cur + fm(m.amount), "Ref " + fm(m.amount_ref), cur + fm(exp[k]), k in cnt ? cur + fm(cnt[k]) : "sin contar",
      diff === null ? "" : `<b style="color:${Math.abs(diff) < 0.01 ? "#2f7d4f" : "#b3261e"}">${cur + fm(diff)}</b>`];
  });
  return `<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:900px;color:#1f1a17">
${prev}<h1 style="font-size:22px;margin:0">Cierre de caja · Ichiraku Ramen</h1>
<p style="color:#555;margin:4px 0 0">Apertura ${hh(s.opened_at)} (${he(s.opened_by)}) · Cierre ${hh(s.closed_at)} (${he(s.closed_by)}) · Tasa € BCV ${fm(d.rate)}</p>
${H("Resumen")}${table([], [["Pedidos cobrados", fq(t.orders)], ["Pedidos anulados", fq(t.cancelled)], ["Ventas con IVA (sin servicio)", "Ref " + fm(t.sales)],
    ["Descuentos", "Ref " + fm(t.discounts)], ["Servicio 10 %", "Ref " + fm(t.service)], ["Delivery", "Ref " + fm(t.delivery)], ["<b>Total cobrado</b>", "<b>Ref " + fm(t.total) + "</b>"],
    ["Fondo inicial", "$ " + fm(s.opening_usd) + " · Bs " + fm(s.opening_bs)]], [1])}
${H("Métodos de pago y arqueo")}${table(["Método", "Pagos", "Monto", "En Ref", "Esperado en caja", "Contado", "Diferencia"], methods, [1, 2, 3, 4, 5, 6])}
${d.yummy_mes && Number(d.yummy_mes.ref) > 0 ? `<p style="margin:8px 0 0">Yummy en lo que va de mes: <b>Ref ${fm(d.yummy_mes.ref)}</b> (${fq(d.yummy_mes.pedidos)} ${Number(d.yummy_mes.pedidos) === 1 ? "pedido" : "pedidos"}), por cobrarle a Yummy.</p>` : ""}
${cnt._billetes ? `<p style="margin:-10px 0 16px;color:#555">Efectivo $ contado por billetes: ${Object.keys(cnt._billetes).map((k) => he(k === "otros" ? "monedas y otros $ " + fm(cnt._billetes[k]) : k + " × " + fq(cnt._billetes[k]))).join(" · ")}</p>` : ""}
${H("Cobros por persona")}${table(["Quién cobró", "Método", "Pagos", "Monto", "En Ref"], (d.cashiers || []).map((x) => [he(x.name), MNAMES[x.method] || he(x.method), x.count, (BS.has(x.method) ? "Bs " : "$ ") + fm(x.amount), "Ref " + fm(x.amount_ref)]), [2, 3, 4])}
${(d.outs || []).length ? H("Salidas de caja") + table(["Hora", "Motivo", "Monto", "Quién"], d.outs.map((x) => [hh(x.at), he(x.reason), (x.method === "efectivo_bs" ? "Bs " : "$ ") + fm(x.amount), he(x.by)]), [2]) : ""}
${H("Conteo de afuera")}${table(["Producto", "Según sistema", "Contado", "Diferencia"], (Array.isArray(cnt._inv) ? cnt._inv : []).map((x) => {
    const diff = x.counted == null || x.expected == null ? null : Number(x.counted) - Number(x.expected);
    return [he(x.name), x.expected == null ? "primer conteo" : fq(x.expected) + " " + he(x.unit), x.counted == null ? "<i>sin contar</i>" : fq(x.counted) + " " + he(x.unit),
      diff === null ? "" : `<b style="color:${Math.abs(diff) < 0.001 ? "#2f7d4f" : "#b3261e"}">${diff > 0 ? "+" : ""}${fq(diff)}</b>`];
  }), [1, 2, 3])}
${H("Propinas y cuentas del personal")}<p style="margin:4px 0 8px">Propinas recibidas: <b>Ref ${fm(d.tips)}</b> (se reparten el día 5 con el servicio).</p>
${table(["Persona", "Movimiento", "Monto", "Detalle", "Saldo actual"], (d.tabs || []).map((x) => [he(x.name), x.kind === "consumo" ? "Consumo a cuenta" : "Abono en caja", "Ref " + fm(Math.abs(x.amount)), he(x.note), "Ref " + fm(x.balance)]), [2, 4])}
${(d.unverified || []).length ? H("⚠ Pagos de PayPal/Binance sin confirmar") + "<p style=\"margin:0 0 6px\">No aparecieron todavía en la plataforma al cerrar. Si no llegan, hay que reclamarlos.</p>" +
  table(["Hora", "Pedido", "Método", "Monto", "Referencia", "Quién cobró"], d.unverified.map((x) => [hh(x.at), he(x.label), MNAMES[x.method] || he(x.method), "$ " + fm(x.amount), he(x.reference || "—"), he(x.by)]), [3]) : ""}
${H("Cobros hechos fuera de la caja")}${(d.off_caja || []).length ? table(["Hora", "Pedido", "Quién", "Equipo", "Método", "Monto"], d.off_caja.map((x) => [hh(x.at), he(x.order), he(x.by), he(x.device), MNAMES[x.method] || he(x.method), (BS.has(x.method) ? "Bs " : "$ ") + fm(x.amount)]), [5]) : "<p style=\"color:#2f7d4f\">Ninguno: todos los cobros se hicieron en la caja.</p>"}
${H("Por área")}${table(["Área", "Pedidos", "Total"], (d.by_kind || []).map((x) => [he(x.kind), x.orders, "Ref " + fm(x.total)]), [1, 2])}
${H("Mejores vendedores (incentivos)")}${["day", "week", "month"].map((k) => {
    const rows = (d.tops && d.tops[k]) || [], t = { day: "Hoy", week: "Esta semana", month: "Este mes" }[k];
    return `<p style="margin:8px 0 2px;font-weight:700">${t}${rows[0] ? " · ganador: " + he(rows[0].name) : ""}</p>` +
      table(["#", "Vendedor", "Platos", "Pedidos", "Ventas"], rows.map((r, i) => [i + 1, he(r.name), fq(r.items), r.orders, "Ref " + fm(r.sales)]), [2, 3, 4]);
  }).join("")}
${H("Por mesera (quien abrió la mesa)")}${table(["Persona", "Pedidos", "Total"], (d.staff || []).map((x) => [he(x.name), x.orders, "Ref " + fm(x.total)]), [1, 2])}
${H("Por hora")}${table(["Hora", "Pedidos", "Total"], (d.hours || []).map((x) => [String(x.hour).padStart(2, "0") + ":00", x.orders, "Ref " + fm(x.total)]), [1, 2])}
${H("Platos vendidos")}${table(["Plato", "Cantidad", "Ventas"], (d.dishes || []).map((x) => [he(x.name + (x.variant ? " " + x.variant : "")), fq(x.qty), "Ref " + fm(x.amount)]), [1, 2])}
${H("Anulaciones de platos")}${table(["Pedido", "Plato", "Monto", "Quién", "Motivo"], (d.voids || []).map((x) => [he(x.order), fq(x.qty) + " " + he(x.item), "Ref " + fm(x.amount), he(x.by), he(x.reason)]), [2])}
${H("Descuentos")}${table(["Pedido", "Monto", "Quién", "Motivo"], (d.discounts || []).map((x) => [he(x.order), "Ref " + fm(x.amount), he(x.by), he(x.reason)]), [1])}
${H("Pedidos anulados")}${table(["Pedido", "Quién", "Motivo"], (d.cancelled || []).map((x) => [he(x.order), he(x.by), he(x.reason)]), [])}
${H("Detalle de cada pedido")}${table(["Pedido", "Hora", "Mesera / Caja", "Platos", "Pagos", "Total"], (d.orders || []).map((x) => [he(x.label) + (x.status === "anulada" ? " <i>(anulado)</i>" : ""),
    hh(x.opened_at) + " → " + hh(x.closed_at), he(x.waiter) + " / " + he(x.cashier), he(x.items), he(x.payments), "Ref " + fm(x.total)]), [5])}
${s.notes ? H("Notas de la cajera") + "<p>" + he(s.notes) + "</p>" : ""}
<p style="color:#777;font-size:12px;margin-top:24px">Enviado automáticamente por el sistema de ventas de Ichiraku. Precios con IVA incluido.</p></div>`;
}


const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const KINDS = { mesa: "Mesas", delivery: "Delivery propio", yummy: "Yummy", llevar: "Para llevar" };
const dd = (ymd) => { const d = new Date(ymd + "T12:00:00Z"); return DIAS[d.getUTCDay()] + " " + String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0"); };
// Indicadores (KPI) de la semana contra la anterior: los mismos de Gestión › Inicio (inicio.sql, kpi_semana).
// El cambio va con flecha y texto; verde si mejora y rojo si empeora (el tiempo por mesa no se pinta).
function kpiHtml(k) {
  if (!k || !k.actual) return "";
  const A = k.actual, B = k.anterior || {}, f1 = (n) => Number(n).toLocaleString("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const g = (o, a, b) => ((o || {})[a] || {})[b], pc = (n) => (n == null ? "—" : Math.round(Number(n)) + " %"), mn = (n) => (n == null ? "—" : f1(n) + " min");
  const cmp = (a, b, modo, mejor) => {
    if (a == null || b == null || (modo === "%" && !Number(b))) return '<span style="color:#777">—</span>';
    const d = modo === "%" ? (Number(a) - Number(b)) / Math.abs(Number(b)) * 100 : Number(a) - Number(b), x = Math.abs(d);
    if (x < (modo === "%" ? 0.5 : modo === "n" ? 1 : 0.05)) return '<span style="color:#777">igual</span>';
    const up = d > 0, color = !mejor ? "#555" : up === (mejor === "sube") ? "#2f7d4f" : "#b3261e";
    const txt = modo === "%" ? Math.round(x) + " %" : modo === "pts" ? f1(x) + " pts" : modo === "min" ? f1(x) + " min" : modo === "ref" ? "Ref " + fm(x) : modo === "n1" ? f1(x) : Math.round(x);
    return `<b style="color:${color}">${up ? "▲" : "▼"} ${txt}</b>`;
  };
  const can = g(A, "ventas", "canales") || {}, tot = ["mesa", "llevar", "delivery"].reduce((s, c) => s + Number((can[c] || {}).ventas || 0), 0);
  const parte = (c) => (tot ? Math.round(Number((can[c] || {}).ventas || 0) / tot * 100) : 0);
  const cierres = (o) => (g(o, "control", "cierres") ? `${fq(g(o, "control", "cierres_fuera"))} de ${fq(g(o, "control", "cierres"))}` : "—");
  const grupo = (t) => [`<b style="color:#e5206b">${t}</b>`, "", "", ""];
  const rows = [
    grupo("Ventas"),
    ["Ventas (con IVA, sin servicio)", "Ref " + fm(g(A, "ventas", "total")), "Ref " + fm(g(B, "ventas", "total")), cmp(g(A, "ventas", "total"), g(B, "ventas", "total"), "%", "sube")],
    ["Ticket promedio", g(A, "ventas", "ticket") == null ? "—" : "Ref " + fm(g(A, "ventas", "ticket")), g(B, "ventas", "ticket") == null ? "—" : "Ref " + fm(g(B, "ventas", "ticket")),
      cmp(g(A, "ventas", "ticket"), g(B, "ventas", "ticket"), "%", "sube")],
    ["Mesa · para llevar · delivery", tot ? `${parte("mesa")} % · ${parte("llevar")} % · ${parte("delivery")} %` : "—", "", ""],
    grupo("Costos y margen"),
    ["Insumos (según las recetas)", pc(g(A, "costos", "insumos_pct")), pc(g(B, "costos", "insumos_pct")), cmp(g(A, "costos", "insumos_pct"), g(B, "costos", "insumos_pct"), "pts", "baja")],
    ["Nómina", pc(g(A, "costos", "nomina_pct")), pc(g(B, "costos", "nomina_pct")), cmp(g(A, "costos", "nomina_pct"), g(B, "costos", "nomina_pct"), "pts", "baja")],
    ["Gastos (fijos por día + variables)", "Ref " + fm(g(A, "costos", "gastos")), "Ref " + fm(g(B, "costos", "gastos")), cmp(g(A, "costos", "gastos"), g(B, "costos", "gastos"), "ref", "baja")],
    ["Lo que queda", `Ref ${fm(g(A, "costos", "queda"))} (${pc(g(A, "costos", "queda_pct"))})`, `Ref ${fm(g(B, "costos", "queda"))} (${pc(g(B, "costos", "queda_pct"))})`,
      cmp(g(A, "costos", "queda_pct"), g(B, "costos", "queda_pct"), "pts", "sube")],
    grupo("Servicio"),
    ["Tiempo de cocina (enviado a listo)", mn(g(A, "servicio", "cocina_min")), mn(g(B, "servicio", "cocina_min")), cmp(g(A, "servicio", "cocina_min"), g(B, "servicio", "cocina_min"), "min", "baja")],
    ["Tiempo por mesa (abrir a cobrar)", mn(g(A, "servicio", "mesa_min")), mn(g(B, "servicio", "mesa_min")), cmp(g(A, "servicio", "mesa_min"), g(B, "servicio", "mesa_min"), "min", "")],
    ["Calificación de clientes", g(A, "servicio", "calificacion") == null ? "—" : f1(g(A, "servicio", "calificacion")) + " de 5 (" + fq(g(A, "servicio", "calificaron")) + ")",
      g(B, "servicio", "calificacion") == null ? "—" : f1(g(B, "servicio", "calificacion")) + " de 5", cmp(g(A, "servicio", "calificacion"), g(B, "servicio", "calificacion"), "n1", "sube")],
    grupo("Control"),
    ["Descuentos", "Ref " + fm(g(A, "control", "descuentos")), "Ref " + fm(g(B, "control", "descuentos")), cmp(g(A, "control", "descuentos"), g(B, "control", "descuentos"), "ref", "baja")],
    ["Platos anulados en cocina", fq(g(A, "control", "anulados")), fq(g(B, "control", "anulados")), cmp(g(A, "control", "anulados"), g(B, "control", "anulados"), "n", "baja")],
    ["Cierres de caja que no cuadran", cierres(A), cierres(B), cmp(g(A, "control", "cierres_fuera"), g(B, "control", "cierres_fuera"), "n", "baja")],
  ];
  const cob = g(A, "costos", "cobertura_pct");
  return table(["Indicador", "Esta semana", "Semana anterior", "Cambio"], rows, [1, 2, 3]) +
    (cob != null && cob < 100 ? `<p style="margin:-10px 0 8px;color:#777;font-size:12px">Insumos con recetas para el ${Math.round(cob)} % de lo vendido; el resto se estima igual.</p>` : "");
}
function weekSubject(d) { return `Resumen semanal ${dd(d.from)} al ${dd(d.to)} · Ref ${fm(d.totals && d.totals.total)}`; }
function weekHtml(d) {
  const t = d.totals || {}, H = (x) => `<h2 style="font-size:17px;margin:22px 0 4px;color:#e5206b">${x}</h2>`;
  const prev = Number(d.prev_total || 0), chg = prev > 0 ? Math.round((Number(t.total) / prev - 1) * 100) : null;
  const dl = d.delivery || {}, outs = d.outs || [];
  const paidDl = outs.filter((x) => /deliver/i.test(x.reason)).reduce((a, x) => a + Number(x.amount_ref || 0), 0);
  const big = (lbl, val, sub) => `<td style="padding:10px 12px;border:1px solid #eee;border-radius:8px;vertical-align:top"><div style="font-size:12px;color:#666;text-transform:uppercase">${lbl}</div><div style="font-size:22px;font-weight:700">${val}</div>${sub ? `<div style="font-size:12px;color:#666">${sub}</div>` : ""}</td>`;
  const diffCell = (n) => `<b style="color:${Math.abs(n) < 0.01 ? "#2f7d4f" : "#b3261e"}">${n > 0 ? "+" : ""}${fm(n)}</b>`;
  return `<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:900px;color:#1f1a17">
<h1 style="font-size:22px;margin:0">Resumen semanal · Ichiraku Ramen</h1>
<p style="color:#555;margin:4px 0 12px">Del ${dd(d.from)} al ${dd(d.to)} · Tasa € BCV actual ${fm(d.rate)}</p>
<table style="border-collapse:separate;border-spacing:8px;width:100%"><tr>
${big("Ventas", "Ref " + fm(t.total), chg === null ? "primera semana" : (chg >= 0 ? "▲ " : "▼ ") + Math.abs(chg) + " % vs. semana anterior")}
${big("Pedidos", fq(t.orders), "ticket promedio Ref " + fm(t.avg))}
${big("Servicio acumulado", "Ref " + fm(t.service), "propinas Ref " + fm(d.tips))}
</tr></table>
${d.kpis ? H("Indicadores de la semana") + kpiHtml(d.kpis) : ""}
${H("🛵 Pago a la empresa de delivery")}
<p style="margin:4px 0 8px;font-size:15px">Cobrado a los clientes por delivery: <b>Ref ${fm(dl.fees)}</b> en ${fq(dl.orders)} envíos.${paidDl ? ` Ya salió de caja esta semana: Ref ${fm(paidDl)}.` : ""}</p>
<p style="margin:0 0 8px;color:#555;font-size:13px">Al pagarle, registra en caja una <b>Salida de caja</b> con el motivo «Pago delivery semanal».</p>
${H("Ventas por día")}${table(["Día", "Pedidos", "Total"], (d.days || []).map((x) => [dd(x.day), x.orders, "Ref " + fm(x.total)]), [1, 2])}
${H("Por tipo de pedido")}${table(["Tipo", "Pedidos", "Total"], (d.by_kind || []).map((x) => [KINDS[x.kind] || he(x.kind), x.orders, "Ref " + fm(x.total)]), [1, 2])}
${H("Cuadre de caja de cada día")}${table(["Cierre", "Cajera", "Diferencias por método", "Total en Ref", "Notas"], (d.sessions || []).map((x) => [hh(x.closed_at), he(x.by),
    Object.keys(x.diffs || {}).filter((k) => Math.abs(x.diffs[k]) >= 0.01).map((k) => (MNAMES[k] || he(k)) + ": " + (BS.has(k) ? "Bs " : "$ ") + fm(x.diffs[k])).join("<br>") || "Todo cuadró",
    diffCell(Number(x.diff_ref || 0)), he(x.notes)]), [3])}
${H("Métodos de pago")}${table(["Método", "Pagos", "Monto", "En Ref"], (d.methods || []).map((x) => [MNAMES[x.method] || he(x.method), x.count, (BS.has(x.method) ? "Bs " : "$ ") + fm(x.amount), "Ref " + fm(x.amount_ref)]), [1, 2, 3])}
${H("Platos más vendidos")}${table(["Plato", "Cantidad", "Ventas"], (d.dishes || []).map((x) => [he(x.name), fq(x.qty), "Ref " + fm(x.amount)]), [1, 2])}
${(d.kitchen || []).length ? H("Tiempos de cocina (de enviado a listo)") + table(["Plato", "Veces", "Promedio", "M\u00e1s lento"], d.kitchen.map((x) => [he(x.name), x.count, fq(x.avg) + " min", fq(x.max) + " min"]), [1, 2, 3]) : ""}
${H("Mejores vendedores")}${table(["#", "Vendedor", "Platos", "Pedidos", "Ventas"], (d.sellers || []).map((r, i) => [i + 1, he(r.name), fq(r.items), r.orders, "Ref " + fm(r.sales)]), [2, 3, 4])}
${H("Salidas de caja")}${table(["Fecha", "Motivo", "Monto", "Quién"], outs.map((x) => [hh(x.at), he(x.reason), (x.method === "efectivo_bs" ? "Bs " : "$ ") + fm(x.amount), he(x.by)]), [2])}
${H("Control")}${table([], [["Platos anulados", fq((d.voids || {}).count) + " · Ref " + fm((d.voids || {}).amount)], ["Pedidos anulados", fq(d.cancelled)], ["Descuentos", "Ref " + fm(t.discounts)]], [1])}
<p style="color:#777;font-size:12px;margin-top:24px">Enviado automáticamente cada lunes por el sistema de ventas de Ichiraku. Precios con IVA incluido.</p></div>`;
}

// Alertas al correo del dueño (cierre que no cuadra, anulados, descuentos grandes, laptop sin conexión)
function alertSubject(d) { return "⚠ " + String((d && d.titulo) || "Alerta de la caja"); }
function alertHtml(d) {
  const lines = (d.lineas || []).map((x) => `<li style="margin:4px 0">${he(x)}</li>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#222">
<h1 style="font-size:20px;margin:0 0 6px;color:#b3261e">⚠ ${he(d.titulo)}</h1>
<p style="margin:0 0 12px;color:#555">${hh(d.at)} · Ichiraku Ramen</p>
${lines ? `<ul style="padding-left:20px;margin:0 0 16px;font-size:15px">${lines}</ul>` : ""}
<p style="color:#777;font-size:12px;margin-top:20px">Alerta automática del sistema de ventas. A quién le llega y desde cuánto avisa un cierre que no cuadra se cambia en Gestión → Dinero → Ventas (Ajustes).</p></div>`;
}

  const api = { reportHtml: reportHtml, weekHtml: weekHtml, weekSubject: weekSubject, alertHtml: alertHtml, alertSubject: alertSubject };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.IchirakuReporte = api;
})(typeof window !== "undefined" ? window : this);

export const reportHtml = module.exports.reportHtml;
export const weekSubject = module.exports.weekSubject;
export const alertSubject = module.exports.alertSubject;
