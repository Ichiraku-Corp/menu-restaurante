// Cobro y verificación de pagos
"use strict";
// ---------------------------------------------------------------- Cobro
var pays = [], changeCur = "REF", payPerson = 0;
$("pay").addEventListener("click", function () {
  refreshState().then(function () {
    if (!ST.session) { toast("La caja está cerrada: ábrela en «Caja»", true); return; }
    pays = []; changeCur = "REF"; $("payErr").textContent = "";
    var sn = splitN(cur.data), rows = sn ? (cur.data.split_totals || []) : [];
    payPerson = 0;
    if (sn) { var firstDue = rows.find(function (r) { return r.person > 0 && num(r.total) - num(r.paid) > 0.02; }); payPerson = firstDue ? firstDue.person : 0; }
    show("payPersonsBox", !!sn); show("paySplit", !sn);
    var t = cur.data.totals;
    $("payTitle").textContent = "Cobrar · " + cur.data.label;
    var dueNow = num(t.total) - num(t.paid); splitEq = 0;
    $("payTotal").textContent = ref(dueNow) + (num(t.paid) ? " · ya abonó " + ref(num(t.paid)) + " de " + ref(num(t.total)) : "");
    $("payRateTxt").textContent = ST.rate ? "Tasa € BCV " + nf2.format(ST.rate) : "Sin tasa: solo divisas";
    $("payTotalBs").textContent = ST.rate ? bs(Math.round(dueNow * ST.rate * 100) / 100) : "";
    $("payMethods").innerHTML = METHODS.map(function (m) { return '<button type="button" class="mbtn" data-m="' + m[0] + '"' + (m[2] === "BS" && !ST.rate ? " disabled" : "") + ">" + logo(m[0]) + "<span>" + m[1] + "</span></button>"; }).join("") +
      '<button type="button" class="mbtn" data-m="cuenta">' + logo("cuenta") + "<span>A cuenta (empleado)</span></button>" +
      '<button type="button" class="mbtn" data-tip="1">' + logo("propina") + "<span>+ Propina</span></button>";
    TABS = []; q(sb.rpc("pos_tabs_list")).then(function (t) { TABS = t || []; if ($("payDlg").open) drawPays(); }).catch(function () {});
    drawPayPersons(); drawPays(); $("payDlg").showModal();
  }).catch(fail);
});
function payRef(p) { var m = minfo(p.method); return m[2] === "REF" ? num(p.amount) : (ST.rate ? num(p.amount) / ST.rate : 0); }
var splitEq = 0;
function personDue(p) { var r = (cur.data.split_totals || []).find(function (x) { return x.person === p; }); return r ? Math.max(0, Math.round((num(r.total) - num(r.paid)) * 100) / 100) : 0; }
function drawPayPersons() {
  var rows = splitN(cur.data) ? (cur.data.split_totals || []).filter(function (r) { return r.person > 0; }) : [];
  $("payPersons").innerHTML = rows.map(function (r) {
    var due = Math.max(0, num(r.total) - num(r.paid)), done = due <= 0.02 && num(r.total) > 0;
    return '<button type="button" data-pp="' + r.person + '" style="--pc:' + pcol(r.person) + '" class="' + (r.person === payPerson ? "on " : "") + (done ? "done" : "") + '"' + (done ? " disabled" : "") + ">" +
      '<b><i class="pdot' + (r.person ? "" : " none") + '"></i>' + esc(pname(r.person)) + "</b><small>" + (done ? "pagado ✓" : "debe " + ref(due)) + "</small></button>";
  }).join("") + '<button type="button" data-pp="0"' + (payPerson === 0 ? ' class="on"' : "") + '><b>Toda la mesa</b><small>' + ref(num(cur.data.totals.total) - num(cur.data.totals.paid)) + "</small></button>";
  var t = cur.data.totals, due0 = payPerson ? personDue(payPerson) : num(t.total) - num(t.paid);
  $("payTotal").textContent = ref(due0) + (payPerson ? " · " + pname(payPerson) : num(t.paid) ? " · ya abonó " + ref(num(t.paid)) + " de " + ref(num(t.total)) : "");
  $("payTotalBs").textContent = ST.rate ? bs(Math.round(due0 * ST.rate * 100) / 100) : "";
  $("payOk").textContent = payPerson ? "Cobrar a " + pname(payPerson) : "Confirmar cobro";
}
$("payPersons").addEventListener("click", function (e) {
  var b = e.target.closest("[data-pp]"); if (!b || b.disabled) return;
  payPerson = Number(b.dataset.pp) || 0;
  pays = []; drawPayPersons(); drawPays();
});
$("payByPerson").addEventListener("click", function () { $("payDlg").close(); openSplit(true); });
var TABS = [];
function tipSum() { return pays.reduce(function (s, p) { return s + (p.tip ? payRef(p) : 0); }, 0); }
function paySums() { if (!cur.data) return { total: 0, paid: 0, rest: 0 }; var total = payPerson ? personDue(payPerson) : num(cur.data.totals.total) - num(cur.data.totals.paid), paid = pays.reduce(function (s, p) { return s + (p.tip ? 0 : payRef(p)); }, 0); return { total: total, paid: paid, rest: Math.round((total - paid) * 100) / 100 }; }
$("payMethods").addEventListener("click", function (e) {
  var t = e.target.closest("[data-tip]");
  if (t) { pays.push({ method: "efectivo_usd", amount: "", reference: "", tip: true }); drawPays(); var ins = document.querySelectorAll("#payLines .amt"); if (ins.length) ins[ins.length - 1].focus(); return; }
  var b = e.target.closest("[data-m]"); if (!b || b.disabled) return;
  var m = minfo(b.dataset.m), s = paySums(), rest = Math.max(0, s.rest);
  if (splitEq > 1) rest = Math.min(rest, Math.ceil(s.total / splitEq * 100) / 100);
  pays.push({ method: m[0], amount: splitEq > 1 ? (m[2] === "REF" ? rest.toFixed(2) : (Math.round(rest * ST.rate * 100) / 100).toFixed(2)) : suggest(m[0]), reference: "" });
  drawPays();
  var inputs = document.querySelectorAll("#payLines .amt"); if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
});
function drawPays() {
  $("payLines").innerHTML = pays.map(function (p, i) {
    var m = minfo(p.method), needRef = ["pago_movil", "zelle", "binance", "paypal", "punto_debito", "punto_credito"].indexOf(p.method) >= 0;
    var isRef = m[2] === "REF";
    var head = p.tip ? '<b class="mname">' + logo("propina") + 'Propina <select class="tipm" aria-label="Cómo dejó la propina">' + METHODS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === p.method ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></b>"
      : '<b class="mname">' + logo(m[0]) + m[1] + "</b>";
    var extra = p.method === "cuenta"
      ? '<select class="tabsel" aria-label="Empleado"><option value="">¿A quién se carga?</option>' + TABS.filter(function (x) { return x.id; }).map(function (x) {
          var left = num(x.limit) - num(x.balance);
          return '<option value="' + x.id + '"' + (Number(p.tab_employee_id) === x.id ? " selected" : "") + (left <= 0 ? " disabled" : "") + ">" + esc(x.name) + " · debe " + ref(x.balance) + (left <= 0 ? " (tope)" : " · le quedan " + ref(left)) + "</option>"; }).join("") + "</select>"
      : null;
    return '<div class="pay' + (p.tip ? " tip" : "") + '" data-i="' + i + '">' + head +
      '<label class="money"><span>' + (isRef ? "$ / Ref" : "Bs") + '</span><input class="amt n" inputmode="decimal" value="' + esc(p.amount) + '" aria-label="Monto en ' + (isRef ? "divisas" : "bolívares") + '"></label>' +
      '<label class="money eqm"><span>' + (isRef ? "= Bs" : "= Ref") + '</span><input class="eq n" inputmode="decimal" value="' + esc(eqOf(p)) + '" aria-label="Equivalente en ' + (isRef ? "bolívares" : "Ref") + '"' + (ST.rate ? "" : " disabled") + "></label>" +
      (extra !== null ? extra : VERIFY[p.method] ? (p.incoming_id
        ? '<button type="button" class="vbtn ver" data-ver>✓ ' + esc(p.verified.payer || "Verificado") + " · " + nf2.format(p.verified.amount) + " " + esc(p.verified.currency) + "</button>"
        : '<span class="refbox"><input class="refin" placeholder="Referencia" value="' + esc(p.reference) + '" aria-label="Referencia del pago"><button type="button" class="vbtn" data-ver title="Buscar el pago entre los recibidos">Buscar</button></span>')
      : '<input class="refin" placeholder="' + (needRef ? "Referencia (opcional)" : "—") + '" value="' + esc(p.reference) + '"' + (needRef ? "" : " disabled") + '>') +
      '<button type="button" class="danger del" aria-label="Quitar">✕</button>' +
      (p.tip ? "" : '<div class="after"><span data-after></span><button type="button" class="again" data-again title="Añadir otro pago igual con lo que falta">+ Otro pase</button></div>') +
      (p.method === "efectivo_usd" && !p.tip ? '<span class="bills" aria-label="Billetes que entregó el cliente">' + [1, 5, 10, 20, 50, 100].map(function (b) { return '<button type="button" data-bill="' + b + '">$' + b + "</button>"; }).join("") +
        '<button type="button" class="bclr" data-bill="0" title="Borrar el monto">Borrar</button></span>' : "") + "</div>";
  }).join("");
  updatePaySums();
}
// Equivalente de cada pago en la otra moneda (para responder «¿cuánto son 13 $ en bolívares?»)
function isRefMethod(k) { var m = minfo(k); return m && m[2] === "REF"; }
function eqOf(p) { if (!ST || !ST.rate || String(p.amount).trim() === "") return ""; return (isRefMethod(p.method) ? num(p.amount) * ST.rate : num(p.amount) / ST.rate).toFixed(2); }
// Vuelto en $, en Bs o mixto (dólares enteros + el resto en bolívares), igual que lo registra el servidor
function changeText(ch) {
  if (changeCur === "MIX" && ST.rate && Math.floor(ch) >= 1 && ch - Math.floor(ch) > 0.009) return "$ " + Math.floor(ch) + " + " + bs(Math.round((ch - Math.floor(ch)) * ST.rate * 100) / 100);
  if (changeCur === "MIX" && ST.rate && Math.floor(ch) >= 1) return "$ " + nf2.format(ch);
  return (changeCur === "BS" || changeCur === "MIX") && ST.rate ? bs(Math.round(ch * ST.rate * 100) / 100) : "$ " + nf2.format(ch);
}
function chgTxt(c) { return c.currency === "MIX" ? "$ " + nf2.format(c.usd) + " + " + bs(c.bs) : c.currency === "BS" ? bs(c.amount) : "$ " + nf2.format(c.amount); }
function bsOf(r) { return ST && ST.rate ? bs(Math.round(r * ST.rate * 100) / 100) : ""; }
// Bolívares que faltan, contados en bolívares: total en Bs menos lo escrito (así dos pases de punto cuadran al céntimo)
function paidBsOf(list) { return list.reduce(function (t, p) { return t + (p.tip ? 0 : isRefMethod(p.method) ? num(p.amount) * (ST.rate || 0) : num(p.amount)); }, 0); }
function restBs(list) { return Math.round((Math.round(paySums().total * (ST.rate || 0) * 100) / 100 - paidBsOf(list)) * 100) / 100; }
function suggest(method) {
  var rest = Math.max(0, paySums().rest);
  if (isRefMethod(method)) return rest.toFixed(2);
  return Math.max(0, restBs(pays)).toFixed(2);
}
function updatePaySums() {
  var s = paySums();
  // Lo que queda después de cada pago, en Ref y en Bs (para ir abonando: «pasa 5.000 aquí y 5.000 en la otra»)
  var left = s.total;
  pays.forEach(function (p, i) {
    if (p.tip) return; left = Math.round((left - payRef(p)) * 100) / 100;
    var el = document.querySelector('#payLines [data-i="' + i + '"] [data-after]'); if (!el) return;
    var lb = restBs(pays.slice(0, i + 1));
    var full = left <= 0.009 || (ST.rate && Math.abs(lb) < 0.005);
    el.textContent = left < -0.009 && lb < -0.009 ? "Sobran " + ref(-left) + " (vuelto)" : full ? "Cubre todo ✓" : "Quedan " + (ST.rate ? bs(lb) + " · " : "") + ref(left);
    el.parentNode.classList.toggle("done", !!full);
  });
  // Pagado en Bs: los bolívares tal como se escribieron (sin ida y vuelta por la tasa, que redondea)
  var paidBs = paidBsOf(pays);
  $("payPaid").textContent = ref(s.paid) + (ST.rate && s.paid ? " · " + bs(Math.round(paidBs * 100) / 100) : "") + (tipSum() > 0 ? " + propina " + ref(tipSum()) : "");
  if (s.rest > 0.009 && !(ST.rate && Math.abs(restBs(pays)) < 0.005)) { $("payRestLbl").textContent = "Falta"; $("payRest").innerHTML = (ST.rate ? "<b>" + esc(bs(Math.max(0, restBs(pays)))) + "</b> · " : "") + esc(ref(s.rest)); show("changeBox", false); }
  else if (s.rest < -0.009) {
    $("payRestLbl").textContent = "Vuelto"; var ch = -s.rest;
    $("payRest").textContent = changeText(ch);
    show("changeBox", true);
  } else { $("payRestLbl").textContent = "Completo"; $("payRest").textContent = "✓"; show("changeBox", false); }
  document.querySelectorAll("#changeCur button").forEach(function (b) { b.classList.toggle("on", b.dataset.cur === changeCur); b.disabled = b.dataset.cur !== "REF" && !ST.rate; });
  $("payOk").disabled = !pays.length || s.rest > 0.02;
  show("payPartial", pays.length > 0 && s.rest > 0.02 && s.paid > 0 && !payPerson);
  $("payPartial").textContent = "Cobrar solo " + ref(s.paid) + " (abono)";
}
$("paySplit").addEventListener("click", function () {
  ask({ title: "Dividir la cuenta", help: "¿Entre cuántas personas? Cada método que toques pondrá la parte de una persona.", value: "2", type: "number" }).then(function (v) {
    if (v === null) return; splitEq = Math.max(1, Math.round(num(v)));
    toast(splitEq > 1 ? "Cada parte: " + ref(Math.ceil(paySums().total / splitEq * 100) / 100) : "Sin dividir");
  });
});
$("payPartial").addEventListener("click", function () { doPay(true); });
$("payLines").addEventListener("input", function (e) {
  var row = e.target.closest("[data-i]"); if (!row) return; var p = pays[Number(row.dataset.i)];
  if (e.target.classList.contains("amt")) { p.amount = e.target.value; p.billed = true; row.querySelector(".eq").value = eqOf(p); }
  else if (e.target.classList.contains("eq")) {
    var v = e.target.value.trim();
    p.amount = v === "" || !ST.rate ? "" : (isRefMethod(p.method) ? num(v) / ST.rate : num(v) * ST.rate).toFixed(2);
    row.querySelector(".amt").value = p.amount;
  }
  else if (e.target.classList.contains("refin")) p.reference = e.target.value;
  else if (e.target.classList.contains("tabsel")) p.tab_employee_id = Number(e.target.value) || null;
  else if (e.target.classList.contains("tipm")) { p.method = e.target.value; drawPays(); return; }
  updatePaySums();
});
// ---- Verificación: elegir el pago que de verdad llegó a Binance / PayPal (lo lee la laptop de caja)
var VERIFY = { binance: "Binance", paypal: "PayPal" }, incFor = null, incRows = [];
function ago(ts) { var m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000)); return m < 1 ? "ahora" : m < 60 ? "hace " + m + " min" : "hace " + Math.floor(m / 60) + " h " + (m % 60) + " min"; }
function openIncoming(ix) {
  incFor = ix; var p = pays[ix], name = VERIFY[p.method];
  $("incTitle").textContent = "Pagos recibidos en " + name; $("incHelp").textContent = "Buscando…"; $("incBody").innerHTML = ""; $("incDlg").showModal();
  q(sb.rpc("pos_incoming_list", { p_source: p.method })).then(function (r) {
    var used = pays.map(function (x, j) { return j !== ix && x.incoming_id; }).filter(Boolean);
    incRows = (r.rows || []).filter(function (x) { return used.indexOf(x.id) < 0; });
    var help = !r.checked_at ? "La laptop de caja todavía no está revisando " + name + " (faltan las claves en el puente)."
      : r.error ? "⚠ La laptop no pudo revisar " + name + ": " + r.error
      : "Revisado " + ago(r.checked_at) + ". Toca el pago de este cliente." + (p.method === "paypal" ? " PayPal puede tardar hasta 3 horas en mostrar un pago." : "");
    $("incHelp").textContent = help;
    $("incBody").innerHTML = incRows.map(function (x, k) {
      return '<div class="incrow"><button type="button" data-k="' + k + '"><span><b>' + esc(x.payer || "Sin nombre") + "</b><small>" + ago(x.received_at) + (x.note ? " · " + esc(x.note) : "") + " · Ref. " + esc(String(x.tx_id).slice(-8)) + "</small></span>" +
        '<b class="n">' + nf2.format(x.amount) + " " + esc(x.currency) + '</b></button><button type="button" class="ext" data-ext="' + k + '" title="Ocultar: llegó a la cuenta pero no es un pago del restaurante">No es del restaurante</button></div>';
    }).join("") || '<p class="muted">No hay pagos nuevos sin usar en las últimas 36 horas.</p>';
  }).catch(function (e) { $("incHelp").textContent = errMsg(e); });
}
$("incBody").addEventListener("click", function (e) {
  var x0 = e.target.closest("[data-ext]");
  if (x0) {
    var r0 = incRows[Number(x0.dataset.ext)];
    if (!confirm("¿Ocultar el pago de " + (r0.payer || "sin nombre") + " por " + nf2.format(r0.amount) + " " + r0.currency + "? Solo si NO es un pago del restaurante.")) return;
    rpc("pos_incoming_ignore", { p_id: r0.id }).then(function () { toast("Pago externo ocultado"); openIncoming(incFor); }).catch(fail);
    return;
  }
  var b = e.target.closest("[data-k]"); if (!b || incFor === null) return; var x = incRows[Number(b.dataset.k)], p = pays[incFor];
  p.incoming_id = x.id; p.reference = x.tx_id; p.amount = num(x.amount).toFixed(2); p.verified = { payer: x.payer, amount: num(x.amount), currency: x.currency };
  $("incDlg").close(); drawPays();
});
$("incClose").addEventListener("click", function () { $("incDlg").close(); });
$("payLines").addEventListener("click", function (e) {
  var v = e.target.closest("[data-ver]"); if (v) { var ix = Number(v.closest("[data-i]").dataset.i);
    if (pays[ix].incoming_id) { pays[ix].incoming_id = null; pays[ix].verified = null; pays[ix].reference = ""; drawPays(); } else openIncoming(ix); return; } });
// Billetes: el primer toque reemplaza el monto sugerido; los siguientes suman (ej.: $20 + $5 = 25)
$("payLines").addEventListener("click", function (e) {
  var b = e.target.closest("[data-bill]"); if (!b) return; var p = pays[Number(b.closest("[data-i]").dataset.i)], v = Number(b.dataset.bill);
  if (!v) { p.amount = ""; p.billed = false; } else { p.amount = ((p.billed ? num(p.amount) : 0) + v).toFixed(2); p.billed = true; }
  drawPays();
});
$("payLines").addEventListener("click", function (e) { var b = e.target.closest(".del"); if (!b) return; pays.splice(Number(b.closest("[data-i]").dataset.i), 1); drawPays(); });
// «+ Otro pase»: otro pago con el mismo método por lo que falta (ej.: la tarjeta no pasa completa, se divide en dos)
$("payLines").addEventListener("click", function (e) {
  var b = e.target.closest("[data-again]"); if (!b) return;
  var p = pays[Number(b.closest("[data-i]").dataset.i)], rest = Math.max(0, paySums().rest);
  if (rest <= 0.009) { toast("Ya está cubierto todo"); return; }
  pays.push({ method: p.method, amount: suggest(p.method), reference: "" });
  drawPays();
  var ins = document.querySelectorAll("#payLines .amt"); if (ins.length) { ins[ins.length - 1].focus(); ins[ins.length - 1].select(); }
});
$("changeCur").addEventListener("click", function (e) { var b = e.target.closest("[data-cur]"); if (!b || b.disabled) return; changeCur = b.dataset.cur; updatePaySums(); });
$("payCancel").addEventListener("click", function () { $("payDlg").close(); });
var paying = false;
$("payOk").addEventListener("click", function () { doPay(false); });
function doPay(partial) {
  if (paying) return; paying = true; $("payOk").disabled = true; $("payErr").textContent = "";
  var list = pays.map(function (p) { return { method: p.method, amount: num(p.amount), reference: p.reference, person: payPerson || null, incoming_id: p.incoming_id || null, device: devName() || "Sin nombre", tip: !!p.tip, tab_employee_id: p.tab_employee_id || null }; }).filter(function (p) { return p.amount > 0; });
  // Al cobrarle a una persona, el resto de la mesa sigue abierto (abono), salvo que sea lo último que falta.
  if (list.some(function (p) { return p.method === "cuenta" && !p.tab_employee_id; })) { $("payErr").textContent = "Elige a qué empleado se carga la cuenta."; paying = false; updatePaySums(); return; }
  if (payPerson) { var restAll = num(cur.data.totals.total) - num(cur.data.totals.paid) - list.reduce(function (a, p) { return a + (p.tip ? 0 : payRef(p)); }, 0); partial = restAll > 0.02; }
  rpc("pos_pay", { p_order: cur.order, p_payments: list, p_change_currency: changeCur, p_partial: partial }).then(function (r) {
    $("payDlg").close();
    if (r && r.closed === false) {
      var chp = r.change; if (chp) alert("Entrega de vuelto: " + chgTxt(chp));
      toast((payPerson ? pname(payPerson) + " pagó " : "Abono de ") + ref(r.paid) + " · falta " + ref(r.rest)); return loadOrder();
    }
    var ch = r && r.change;
    toast("Cobrado " + ref(r.total) + (ch ? " · Vuelto " + chgTxt(ch) : ""));
    if (ch) alert("Entrega de vuelto: " + chgTxt(ch));
    goTables();
  }).catch(function (e) { $("payErr").textContent = errMsg(e); if (/PIN incorrecto/.test(errMsg(e))) lock(); })
    .then(function () { paying = false; if (cur.data) updatePaySums(); });
}
