// Cobro y verificación de pagos
"use strict";
// ---------------------------------------------------------------- Cobro
var pays = [], changeCur = null, payPerson = 0;  // changeCur: cómo se da el vuelto (se elige cada vez, no hay uno por defecto)
// Para cobrar hacen falta los datos del cliente (nombre y teléfono). Sin internet no se piden (no se pueden guardar).
// Si es consumo de un empleado se puede seguir sin cliente, pero solo cargándolo a su cuenta.
var sinCliente = false;
$("pay").addEventListener("click", function () {
  var off = typeof SR !== "undefined" && SR.on;
  if (!off && cur.data && !clienteListo(cur.data) && !esYummy(cur.data)) { clientForm(true); return; }
  abrirCobro(esYummy(cur.data) ? "yummy" : false);
});
// modo: true = consumo de un empleado (solo a su cuenta); "yummy" = pedido de Yummy (sin datos del cliente)
function abrirCobro(modo) {
  sinCliente = modo === true;
  var yummy = modo === "yummy";
  refreshState().then(function () {
    if (!ST.session) { toast("La caja está cerrada: ábrela en «Caja»", true); return; }
    pays = []; changeCur = null; $("payErr").textContent = "";
    var sn = splitN(cur.data), rows = sn ? (cur.data.split_totals || []) : [];
    payPerson = 0;
    if (sn) { var firstDue = rows.find(function (r) { return r.person > 0 && num(r.total) - num(r.paid) > 0.02; }); payPerson = firstDue ? firstDue.person : 0; }
    // Sin internet: la cuenta completa (sin partes, abonos ni cargos a cuenta de empleado)
    var off = typeof SR !== "undefined" && SR.on;
    show("payPersonsBox", !!sn && !off); show("paySplit", !sn && !off); show("payByPerson", !off);
    var t = cur.data.totals;
    $("payTitle").textContent = "Cobrar · " + cur.data.label;
    var dueNow = num(t.total) - num(t.paid); splitEq = 0;
    $("payTotal").textContent = ref(dueNow) + (num(t.paid) ? " · ya abonó " + ref(num(t.paid)) + " de " + ref(num(t.total)) : "");
    $("payRateTxt").textContent = ST.rate ? "Tasa € BCV " + nf2.format(ST.rate) : "Sin tasa: solo divisas";
    $("payTotalBs").textContent = ST.rate ? bs(Math.round(dueNow * ST.rate * 100) / 100) : "";
    // Primero lo que más se usa (21/11: punto débito 58 % de los cobros, pago móvil 23 %): los dos primeros, más grandes
    $("payMethods").innerHTML = METHODS.slice().sort(function (a, b) { return cobroOrden(a[0]) - cobroOrden(b[0]); }).map(function (m, i) {
      return '<button type="button" class="mbtn' + (i < 2 ? " top" : "") + '" data-m="' + m[0] + '"' + (m[2] === "BS" && !ST.rate ? " disabled" : "") + ">" + logo(m[0]) + "<span>" + m[1] + "</span></button>"; }).join("") +
      (off ? "" : '<button type="button" class="mbtn" data-m="cuenta">' + logo("cuenta") + "<span>A cuenta (empleado)</span></button>") +
      '<button type="button" class="mbtn" data-m="yummy">' + logo("yummy") + "<span>Yummy</span></button>" +
      '<button type="button" class="mbtn" data-tip="1">' + logo("propina") + "<span>+ Propina</span></button>";
    TABS = []; if (!off) q(sb.rpc("pos_tabs_list")).then(function (t) { TABS = t || []; if ($("payDlg").open) drawPays(); }).catch(function () {});
    $("payErr").textContent = off ? "Sin internet: el recibo sale en la laptop y el cobro se sube cuando vuelva la conexión."
      : sinCliente ? "Sin datos del cliente: solo se puede cargar a la cuenta de un empleado."
      : yummy ? "Pedido de Yummy: queda anotado como Yummy (por cobrar). No pide datos del cliente." : "";
    // La nota de Yummy es informativa (azul); los errores siguen en rojo
    $("payErr").style.color = yummy && !off ? "var(--info)" : "var(--danger)";
    // Un pedido de Yummy llega con el pago de Yummy ya puesto por lo que falta: solo queda confirmar
    if (yummy && dueNow > 0.009) pays = [{ method: "yummy", amount: (Math.round(dueNow * 100) / 100).toFixed(2), reference: "" }];
    $("selloChk").checked = !!cur.data.sello; show("canjeBtn", !off); drawSello();
    drawPayPersons(); drawPays(); $("payDlg").showModal();
  }).catch(fail);
}
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
  if (t) { pays.push({ method: "efectivo_usd", amount: "", reference: "", tip: true }); drawPays(); var ins = document.querySelectorAll("#payLines .amt"); if (ins.length) ins[ins.length - 1].focus(); payReveal(); return; }
  var b = e.target.closest("[data-m]"); if (!b || b.disabled) return;
  var m = minfo(b.dataset.m), s = paySums(), rest = Math.max(0, s.rest);
  if (splitEq > 1) rest = Math.min(rest, Math.ceil(s.total / splitEq * 100) / 100);
  pays.push({ method: m[0], amount: splitEq > 1 ? (m[2] === "REF" ? rest.toFixed(2) : (Math.round(rest * ST.rate * 100) / 100).toFixed(2)) : suggest(m[0]), reference: "" });
  drawPays();
  // Si este pago cubre todo (lo más común: «todo con punto»), no se abre el teclado: queda listo para «Confirmar cobro».
  // Si es una parte (o ya había otro pago), se pone el cursor en el monto para escribirlo.
  if (pays.length > 1 || paySums().rest > 0.009) { var inputs = document.querySelectorAll("#payLines .amt"); if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); } }
  payReveal();
});
var COBRO_ORDEN = ["punto_debito", "pago_movil", "efectivo_usd", "efectivo_bs", "binance", "punto_credito", "zelle", "paypal"];
function cobroOrden(k) { var i = COBRO_ORDEN.indexOf(k); return i < 0 ? 99 : i; }
// El pie fijo (pagado, vuelto y «Confirmar») no debe tapar el pago que se acaba de añadir ni el que se está
// escribiendo, aunque el pie crezca (al aparecer «¿Cómo le das el vuelto?»)
var payFootH = 0;
function payReveal(row) {
  var dlg = $("payDlg"), foot = dlg.querySelector(".payfoot"), rows = document.querySelectorAll("#payLines .pay");
  if (!foot) return;
  payFootH = foot.offsetHeight;
  if (!rows.length) return;
  dlg.style.scrollPaddingBottom = (payFootH + 8) + "px";
  (row || rows[rows.length - 1]).scrollIntoView({ block: "nearest" });
}
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
  drawSello();  // un pago de Yummy apaga la casilla del sello; si se quita, vuelve
}
// Equivalente de cada pago en la otra moneda (para responder «¿cuánto son 13 $ en bolívares?»)
function isRefMethod(k) { var m = minfo(k); return m && m[2] === "REF"; }
function eqOf(p) { if (!ST || !ST.rate || String(p.amount).trim() === "") return ""; return (isRefMethod(p.method) ? num(p.amount) * ST.rate : num(p.amount) / ST.rate).toFixed(2); }
// Vuelto en $, en Bs o mixto (dólares enteros + el resto en bolívares), igual que lo registra el servidor
function changeText(ch) {
  var both = "$ " + nf2.format(ch) + (ST.rate ? " · " + bs(Math.round(ch * ST.rate * 100) / 100) : "");
  if (!changeCur) return both;
  if (changeCur === "PROPINA") return "$ " + nf2.format(ch) + " de propina";
  if (changeCur === "MOVIL") return ST.rate ? bs(Math.round(ch * ST.rate * 100) / 100) + " por pago móvil" : both;
  if (changeCur === "MIX" && ST.rate && Math.floor(ch) >= 1 && ch - Math.floor(ch) > 0.009) return "$ " + Math.floor(ch) + " + " + bs(Math.round((ch - Math.floor(ch)) * ST.rate * 100) / 100);
  if (changeCur === "MIX" && ST.rate && Math.floor(ch) >= 1) return "$ " + nf2.format(ch);
  return (changeCur === "BS" || changeCur === "MIX") && ST.rate ? bs(Math.round(ch * ST.rate * 100) / 100) : "$ " + nf2.format(ch);
}
function chgTxt(c) { return c.currency === "MIX" ? "$ " + nf2.format(c.usd) + " + " + bs(c.bs) : c.currency === "BS" ? bs(c.amount) : c.currency === "MOVIL" ? bs(c.amount) + " por pago móvil" : c.currency === "PROPINA" ? "Ref " + nf2.format(c.amount) + " quedan de propina" : "$ " + nf2.format(c.amount); }
// ¿Hay que entregar algo? (si quedó de propina, no se entrega nada)
function chgAlert(c) { if (!c || c.currency === "PROPINA") return; alert("Entrega de vuelto: " + chgTxt(c)); }
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
  document.querySelectorAll("#changeCur button").forEach(function (b) { b.classList.toggle("on", b.dataset.cur === changeCur); b.disabled = ["REF", "PROPINA"].indexOf(b.dataset.cur) < 0 && !ST.rate; });
  // Con vuelto hay que decir cómo se entrega: así el cierre de caja cuadra con lo que de verdad salió
  var needChg = s.rest < -0.02 && !changeCur;
  $("changeAsk").classList.toggle("need", needChg);
  // Cuenta en Ref 0 (canje de la tarjeta de puntos o cortesía con todo descontado): se cierra sin pago
  var cero = !payPerson && !pays.length && s.total <= 0.009;
  $("payOk").disabled = (!pays.length && !cero) || s.rest > 0.02 || needChg;
  if (!payPerson) $("payOk").textContent = cero ? "Cerrar cuenta (Ref 0)" : "Confirmar cobro";
  show("payPartial", pays.length > 0 && s.rest > 0.02 && s.paid > 0 && !payPerson && !(typeof SR !== "undefined" && SR.on));
  $("payPartial").textContent = "Cobrar solo " + ref(s.paid) + " (abono)";
  var foot = $("payDlg").querySelector(".payfoot");
  if (foot && $("payDlg").open && foot.offsetHeight > payFootH + 4) {
    var a = document.activeElement; payReveal(a && a.closest ? a.closest("#payLines .pay") : null);
  } else if (foot) payFootH = foot.offsetHeight;
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
  payReveal();
});
$("changeCur").addEventListener("click", function (e) { var b = e.target.closest("[data-cur]"); if (!b || b.disabled) return; changeCur = b.dataset.cur; updatePaySums(); });
$("payCancel").addEventListener("click", function () { $("payDlg").close(); });
var paying = false;
$("payOk").addEventListener("click", function () { doPay(false); });
function doPay(partial) {
  if (paying) return; paying = true; $("payOk").disabled = true; $("payErr").textContent = ""; $("payErr").style.color = "var(--danger)";
  var list = pays.map(function (p) { return { method: p.method, amount: num(p.amount), reference: p.reference, person: payPerson || null, incoming_id: p.incoming_id || null, device: devName() || "Sin nombre", tip: !!p.tip, tab_employee_id: p.tab_employee_id || null }; }).filter(function (p) { return p.amount > 0; });
  // Al cobrarle a una persona, el resto de la mesa sigue abierto (abono), salvo que sea lo último que falta.
  if (!(typeof SR !== "undefined" && SR.on) && !clienteListo(cur.data) && list.some(function (p) { return !p.tip && p.method !== "cuenta" && p.method !== "yummy"; })) {
    $("payErr").textContent = "Faltan los datos del cliente: sin ellos solo se puede cobrar con Yummy o cargar a la cuenta de un empleado."; paying = false; updatePaySums(); return;
  }
  if (list.some(function (p) { return p.method === "cuenta" && !p.tab_employee_id; })) { $("payErr").textContent = "Elige a qué empleado se carga la cuenta."; paying = false; updatePaySums(); return; }
  if (payPerson) { var restAll = num(cur.data.totals.total) - num(cur.data.totals.paid) - list.reduce(function (a, p) { return a + (p.tip ? 0 : payRef(p)); }, 0); partial = restAll > 0.02; }
  rpc("pos_pay", { p_order: cur.order, p_payments: list, p_change_currency: changeCur, p_partial: partial, p_sello: $("selloChk").checked }).then(function (r) {
    $("payDlg").close();
    if (r && r.closed === false) {
      chgAlert(r.change);
      toast((payPerson ? pname(payPerson) + " pagó " : "Abono de ") + ref(r.paid) + " · falta " + ref(r.rest)); return loadOrder();
    }
    var ch = r && r.change;
    toast(num(r.total) > 0.009 ? "Cobrado " + ref(r.total) + (ch ? (ch.currency === "PROPINA" ? " · " : " · Vuelto ") + chgTxt(ch) : "") : "Cuenta cerrada en Ref 0");
    chgAlert(ch);
    goTables();
  }).catch(function (e) { $("payErr").textContent = errMsg(e); if (/PIN incorrecto/.test(errMsg(e))) lock(); })
    .then(function () { paying = false; if (cur.data) updatePaySums(); });
}

// ---------------------------------------------------------------- Tarjeta de puntos
// Un sello por compra de Ref 20 o más (uno por compra): la caja marca «Tarjeta entregada». Desde Ref 20 la casilla se resalta.
// Con 3 sellos regalan 2 bebidas, 2 ramen pequeños o 6 taiyakis: el premio se agrega a la cuenta y «Canje» lo deja en Ref 0.
var SELLO_DESDE = 20;
function drawSello() {
  if (!cur.data) return;
  // Los pedidos de Yummy (abiertos como Yummy o con un pago de Yummy) no llevan sello
  var yum = esYummy(cur.data) || pays.some(function (p) { return p.method === "yummy"; });
  var lleva = !yum && num(cur.data.totals.total) >= SELLO_DESDE - 0.005;
  // Por debajo de Ref 20 no hay sello: la casilla no se puede marcar
  if (!lleva) $("selloChk").checked = false;
  $("selloChk").disabled = !lleva;
  var marcada = $("selloChk").checked;
  $("selloBox").classList.toggle("marcada", marcada);
  $("selloBox").classList.toggle("lleva", lleva && !marcada);
  $("selloHint").textContent = marcada ? "Se anota un sello en esta compra"
    : lleva ? "Esta compra lleva sello: márcala si entregaste la tarjeta o el sello"
    : yum ? "Los pedidos de Yummy no llevan sello" : "Un sello por compra de Ref " + SELLO_DESDE + " o más";
  var hay = (cur.data.items || []).some(function (i) { return i.canje && i.status !== "anulado"; });
  $("canjeBtn").classList.toggle("hay", hay);
  $("canjeBtn").textContent = hay ? "Canje ✓" : "Canje de tarjeta";
}
$("selloChk").addEventListener("change", drawSello);
var CJ_META = { bebida: { n: 2, t: "2 bebidas" }, ramen: { n: 2, t: "2 ramen pequeños" }, taiyaki: { n: 6, t: "6 taiyakis" } }, CJ = {};
function canjeTipo(i) {
  if (!i) return null;
  var d = MENU.dishes.find(function (x) { return x.id === i.dish_id; }), c = d && MENU.cats.find(function (x) { return x.id === d.category_id; });
  var cat = c ? String(c.name).toLowerCase() : "";
  if (cat === "bebidas") return "bebida";
  if (cat === "ramen" && i.variant === "Peq") return "ramen";
  if (String(i.name).toLowerCase() === "taiyaki") return "taiyaki";
  return null;
}
function itemOf(id) { return (cur.data.items || []).find(function (x) { return x.id === Number(id); }); }
function canjeElegido() { var tipo = null, n = 0; Object.keys(CJ).forEach(function (id) { if (CJ[id] > 0) { tipo = canjeTipo(itemOf(id)); n += CJ[id]; } }); return { tipo: tipo, n: n }; }
$("canjeBtn").addEventListener("click", function () {
  CJ = {}; $("canjeErr").textContent = "";
  var items = (cur.data.items || []).filter(function (i) { return i.status !== "anulado"; });
  var hay = items.filter(function (i) { return i.canje; }), elig = items.filter(function (i) { return !i.canje && canjeTipo(i); });
  show("canjeQuitar", hay.length > 0);
  var html = hay.length ? '<div class="cjya">Ya tiene canje: ' + hay.map(function (i) { return fmtQ(i.qty) + " " + esc(i.name + (i.variant ? " " + i.variant : "")); }).join(", ") + " en Ref 0</div>" : "";
  html += ["bebida", "ramen", "taiyaki"].map(function (k) {
    var list = elig.filter(function (i) { return canjeTipo(i) === k; }); if (!list.length) return "";
    return '<div class="cjg" data-k="' + k + '"><div class="cjh">' + CJ_META[k].t + ' <small data-cnt="' + k + '"></small></div>' + list.map(function (i) {
      return '<div class="cjrow" data-id="' + i.id + '"><span><b>' + esc(i.name) + (i.variant ? " " + esc(i.variant) : "") + "</b><small>" + fmtQ(i.qty) + " en la cuenta · " + ref(num(i.unit_price)) + " c/u</small></span>" +
        '<span class="stepper"><button type="button" data-cj="-1" aria-label="Uno menos">−</button><b class="n" data-q="' + i.id + '">0</b><button type="button" data-cj="1" aria-label="Uno más">+</button></span></div>';
    }).join("") + "</div>";
  }).join("");
  if (!elig.length && !hay.length) html = '<p class="muted">En la cuenta no hay bebidas, ramen pequeños ni taiyakis. Agrega primero el premio al pedido (va a cocina como siempre) y luego haz el canje aquí.</p>';
  $("canjeList").innerHTML = html; drawCanje(); $("canjeDlg").showModal();
});
function drawCanje() {
  var s = canjeElegido();
  document.querySelectorAll("#canjeList [data-q]").forEach(function (b) { b.textContent = CJ[b.dataset.q] || 0; });
  document.querySelectorAll("#canjeList .cjg").forEach(function (g) {
    var k = g.dataset.k; g.classList.toggle("off", !!s.tipo && s.tipo !== k);
    g.querySelector("[data-cnt]").textContent = s.tipo === k ? "· " + s.n + " de " + CJ_META[k].n + (s.n === CJ_META[k].n ? " ✓" : "") : "";
  });
  var ok = !!s.tipo && s.n === CJ_META[s.tipo].n;
  $("canjeOk").disabled = !ok; $("canjeOk").textContent = ok ? "Canjear " + CJ_META[s.tipo].t : "Canjear";
}
$("canjeList").addEventListener("click", function (e) {
  var b = e.target.closest("[data-cj]"); if (!b) return;
  var id = Number(b.closest("[data-id]").dataset.id), it = itemOf(id), k = canjeTipo(it), d = Number(b.dataset.cj), s = canjeElegido();
  if (d > 0 && s.tipo && s.tipo !== k) { $("canjeErr").textContent = "El canje es de un solo tipo: " + CJ_META[s.tipo].t + "."; return; }
  if (d > 0 && s.n >= CJ_META[k].n) { $("canjeErr").textContent = "El premio es de " + CJ_META[k].t + "."; return; }
  var qn = (CJ[id] || 0) + d; if (qn < 0 || qn > num(it.qty)) return;
  CJ[id] = qn; $("canjeErr").textContent = ""; drawCanje();
});
$("canjeCancel").addEventListener("click", function () { $("canjeDlg").close(); });
function reabrirCobro() { $("payDlg").close(); return loadOrder().then(function () { if (cur.data) $("pay").click(); }); }
$("canjeOk").addEventListener("click", function () {
  var list = Object.keys(CJ).filter(function (x) { return CJ[x] > 0; }).map(function (x) { return { id: Number(x), qty: CJ[x] }; });
  $("canjeOk").disabled = true;
  rpc("pos_canje", { p_order: cur.order, p_items: list }).then(function (r) {
    $("canjeDlg").close(); toast("Canje listo: " + CJ_META[r.premio].t + " en Ref 0 (valían " + ref(num(r.valor)) + ")");
    return reabrirCobro();
  }).catch(function (e) { $("canjeErr").textContent = errMsg(e); drawCanje(); if (/PIN incorrecto/.test(errMsg(e))) lock(); });
});
$("canjeQuitar").addEventListener("click", function () {
  if (!confirm("¿Quitar el canje? El premio vuelve a su precio.")) return;
  rpc("pos_canje_quitar", { p_order: cur.order }).then(function () { $("canjeDlg").close(); toast("Canje quitado: el premio vuelve a su precio"); return reabrirCobro(); })
    .catch(function (e) { $("canjeErr").textContent = errMsg(e); });
});
