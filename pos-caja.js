// Caja, avisos, uniformes, arqueo, agotados y diálogos
"use strict";
// ---------------------------------------------------------------- Caja
$("btnCaja").addEventListener("click", function () { openCash(); });
$("cashClose").addEventListener("click", function () { $("cashDlg").close(); });
function openCash() {
  refreshState().then(function () { return Promise.all([q(sb.rpc("pos_cash_summary")), q(sb.rpc("pos_outside")).catch(function () { return []; })]); }).then(function (rr) {
    var sm = rr[0]; OUTS = rr[1] || [];
    var h = '<div class="card" style="margin:10px 0"><div class="row between"><div><b>Tasa euro BCV de hoy</b><div class="muted">' +
      (ST.rate ? nf2.format(ST.rate) + " Bs/€" + (ST.rate_date !== today() ? " (es de otro día)" : "") : "Sin tasa") +
      '</div></div>' + (U.charge ? '<button type="button" id="setRate">Escribir tasa</button>' : "") + '</div><p class="muted" style="margin-bottom:0">Se actualiza sola desde el BCV a través de la laptop de caja; aquí puedes corregirla.</p></div>';
    if (!U.charge) {
      h += '<div class="card"><p class="muted" style="margin:0">Abrir, cerrar y cobrar lo hace una cajera autorizada.</p></div>';
    } else if (!sm) {
      h += '<div class="card"><h3 style="margin-top:0">Abrir caja</h3><div class="row"><label class="grow">Fondo en efectivo $<input id="fUsd" inputmode="decimal" value="0"></label>' +
        '<label class="grow">Fondo en efectivo Bs<input id="fBs" inputmode="decimal" value="0"></label></div><p><button type="button" class="primary big" id="openCash" style="width:100%">Abrir caja</button></p></div>';
    } else {
      CASH = sm; EXPECTED = {};
      var rows = METHODS.map(function (m) {
        var st = ' data-s="' + CSTEP_OF[m[0]] + '"';
        var v = sm.methods[m[0]] ? num(sm.methods[m[0]].amount) : 0, exp = v + (m[0] === "efectivo_usd" ? num(sm.opening_usd) : m[0] === "efectivo_bs" ? num(sm.opening_bs) : 0);
        EXPECTED[m[0]] = Math.round(exp * 100) / 100;
        var list = (sm.payments || []).filter(function (p) { return p.method === m[0]; });
        return '<tr data-row="' + m[0] + '"' + st + '><td><span class="mname">' + logo(m[0]) + m[1] + "</span>" + (list.length ? '<button type="button" class="seepay' + (CSTEP_OF[m[0]] === 1 ? " cashsee" : "") + '" data-see="' + m[0] + '">ver ' + list.length + " pago" + (list.length === 1 ? "" : "s") + "</button>" : "") +
          '</td><td class="r exp"><span class="ev">' + (m[2] === "REF" ? "$ " : "Bs ") + nf2.format(exp) + '</span><span class="eb">se ve al revisar</span></td><td><input class="cnt n" data-m="' + m[0] + '" inputmode="decimal" placeholder="Contado en ' + (m[2] === "REF" ? "$" : "Bs") + '" style="padding:6px 8px">' +
          (m[0] === "efectivo_usd" ? '<button type="button" class="seepay" data-bills="1">contar billetes</button>' : "") + '<div class="cdiff" data-diff="' + m[0] + '"></div></td></tr>' +
          (m[0] === "efectivo_usd" ? '<tr class="paylist hidden" data-billrow' + st + '><td colspan="3"><div class="billgrid">' + BILLS.map(function (d) {
            return '<label>' + (d ? "$" + d : "Monedas y otros $") + '<input class="bcnt n" data-den="' + d + '" inputmode="' + (d ? "numeric" : "decimal") + '" placeholder="' + (d ? "cuántos" : "$") + '"></label>'; }).join("") +
            '</div><p class="muted" style="margin:4px 0 0">Escribe cuántos billetes hay de cada uno; el total se pone solo.</p></td></tr>' : "") +
          '<tr class="paylist hidden" data-list="' + m[0] + '"' + st + '><td colspan="3">' + list.map(function (p) {
            return '<div class="pl"><span>' + new Date(p.at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) + " · " + esc(p.label || "") + (p.ref ? " · ref. " + esc(p.ref) : "") + " · " + esc(p.by || "") + '</span><b class="n">' + (m[2] === "REF" ? "$ " : "Bs ") + nf2.format(num(p.amount)) + "</b></div>";
          }).join("") + "</td></tr>";
      }).join("");
      var outs = (sm.outs || []).length ? '<p class="muted" style="margin:6px 0">Salidas: ' + sm.outs.map(function (o) { return esc(o.reason) + " " + (o.method === "efectivo_usd" ? "$ " : "Bs ") + nf2.format(num(o.amount)) + " (" + esc(o.by || "") + ")"; }).join(" · ") + " — ya restadas del esperado.</p>" : "";
      // Pestaña 1: Resumen del turno
      var res = '<div class="card"><div class="row between"><b>Caja abierta</b><span class="muted">desde ' + new Date(sm.opened_at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) + " por " + esc(sm.opened_by || "") + "</span></div>" +
        '<div class="tot"><span>Pedidos cobrados</span><b>' + sm.orders + '</b></div><div class="tot"><span>Ventas (con IVA)</span><b>' + ref(num(sm.sales)) + '</b></div><div class="tot"><span>Servicio</span><b>' + ref(num(sm.service)) + "</b></div>" +
        (sm.open_orders ? '<div class="banner warn">' + (sm.open_orders === 1 ? "Hay 1 pedido abierto: cóbralo o anúlalo" : "Hay " + sm.open_orders + " pedidos abiertos: cóbralos o anúlalos") + " antes de cerrar.</div>" : "") + bsReminder() + outs +
        "<h3>Anulaciones (" + sm.voids.length + ")</h3>" + (sm.voids.length ? sm.voids.map(function (v) { return '<div class="muted">' + esc(v.order) + " · " + fmtQ(v.qty) + " " + esc(v.item) + " · " + ref(num(v.amount)) + " · " + esc(v.by || "") + "<br>Motivo: " + esc(v.reason) + "</div>"; }).join("<hr>") : '<p class="muted">Ninguna</p>') +
        "<h3>Descuentos (" + sm.discounts.length + ")</h3>" + (sm.discounts.length ? sm.discounts.map(function (v) { return '<div class="muted">' + esc(v.order) + " · " + ref(num(v.amount)) + " · " + esc(v.by || "") + " · " + esc(v.reason) + "</div>"; }).join("") : '<p class="muted">Ninguno</p>') +
        "</div>";
      // Pestaña 2: Cerrar caja, por pasos (efectivo → bolívares en banco → divisas digitales → afuera → revisar)
      var steps = CSTEPS.filter(function (x) { return x.k !== 4 || OUTS.length; });
      var cie = '<div class="card cierre">' +
        (sm.open_orders ? '<div class="banner warn">' + (sm.open_orders === 1 ? "Hay 1 pedido abierto: cóbralo o anúlalo" : "Hay " + sm.open_orders + " pedidos abiertos: cóbralos o anúlalos") + " antes de cerrar.</div>" : "") +
        '<div class="csteps" role="tablist">' + steps.map(function (x, i) { return '<button type="button" data-cstep="' + x.k + '"><b>' + (i + 1) + "</b><span>" + x.t + "</span></button>"; }).join("") + "</div>" +
        '<p class="muted cstephelp" id="cstepHelp"></p>' +
        '<table class="tbl arqueo"><thead><tr><th>Método</th><th class="r">Esperado</th><th>Contado</th></tr></thead><tbody>' + rows + "</tbody></table>" +
        (OUTS.length ? '<div data-s="4"><table class="tbl"><thead><tr><th>Producto</th><th class="r">Según sistema</th><th>Contado</th></tr></thead><tbody>' +
          OUTS.map(function (r) { return "<tr><td>" + esc(r.name) + '</td><td class="r">' + (r.active ? fmtQ(r.stock) + " " + esc(r.unit) : '<span class="muted">primer conteo</span>') +
            '</td><td><input class="icnt n" data-ing="' + r.id + '" inputmode="decimal" placeholder="' + esc(r.unit) + '" style="padding:6px 8px"></td></tr>'; }).join("") + "</tbody></table></div>" : "") +
        '<div data-s="5"><textarea id="cashNotes" placeholder="Notas del cierre (obligatorias si la diferencia pasa de Ref 5)" style="margin-top:10px"></textarea>' +
        '<div id="closeErr" class="banner warn hidden" role="alert"></div></div>' +
        // Pie fijo: la diferencia siempre a la vista y los botones para avanzar
        '<div class="cashfoot"><div id="cashTotalDiff" class="tot big"></div><div class="row between">' +
        '<button type="button" id="cstepBack">Atrás</button><button type="button" class="primary" id="cstepNext">Siguiente</button>' +
        '<button type="button" class="primary big hidden" id="doClose"' + (sm.open_orders ? " disabled" : "") + ">Revisar el cierre y enviarlo</button></div></div></div>";
      // Pestaña 3: Herramientas del turno
      var tools = '<div class="card"><div class="toolgrid">' +
        '<button type="button" id="cashOutBtn">Salida de caja</button>' +
        (U.charge ? '<button type="button" id="buyBtn">Llegó mercancía</button>' : "") + '<button type="button" id="soldOut">Platos agotados</button><button type="button" id="invCount">Conteo de inventario</button>' +
        (U.charge ? '<button type="button" id="tabsBtn">Cuentas del personal</button><button type="button" id="uniBtn">Uniformes de hoy</button><button type="button" id="annBtn">Publicar aviso</button>' : "") + "</div></div>";
      h = '<div class="ctabs" role="tablist"><button type="button" data-ctab="res">Resumen</button><button type="button" data-ctab="cierre">Cerrar caja</button><button type="button" data-ctab="tools">Herramientas</button></div>' +
        '<div data-cpanel="res">' + h + res + '</div><div data-cpanel="cierre">' + cie + '</div><div data-cpanel="tools">' + tools + "</div>";
      $("cashBody").innerHTML = h;
      // Caja nueva (otro día, sin recargar la página): el cierre vuelve a empezar ciego, desde el efectivo
      if (BLIND.session !== sm.id) { BLIND = { session: sm.id, revealed: false, first: null }; CSTEP = 1; CASHTAB = "res"; }
      cashTab(CASHTAB || "res"); cashStep(CSTEP || 1); cashDiff();
      if (!$("cashDlg").open) $("cashDlg").showModal();
      return;
    }
    h += '<div class="card"><div class="row">' + (U.charge ? '<button type="button" id="buyBtn" class="grow">Llegó mercancía</button>' : "") + '<button type="button" id="soldOut" class="grow">Platos agotados</button><button type="button" id="invCount" class="grow">Conteo de inventario</button>' +
      (U.charge ? '<button type="button" id="tabsBtn" class="grow">Cuentas del personal</button><button type="button" id="uniBtn" class="grow">Uniformes de hoy</button><button type="button" id="annBtn" class="grow">Publicar aviso</button>' : "") + "</div></div>";
    $("cashBody").innerHTML = h;
    if (!$("cashDlg").open) $("cashDlg").showModal();
  }).catch(fail);
}
// ---- Pestañas de la caja y pasos del cierre
var CASHTAB = "res", CSTEP = 1;
var CSTEP_OF = { efectivo_usd: 1, efectivo_bs: 1, pago_movil: 2, punto_debito: 2, punto_credito: 2, zelle: 3, binance: 3, paypal: 3 };
var CSTEPS = [
  { k: 1, t: "Efectivo", help: "Cuenta la gaveta <b>sin mirar el sistema</b>: lo esperado y la diferencia se ven al final, en «Revisar y enviar». En dólares toca «contar billetes» y escribe cuántos hay de cada uno." },
  { k: 2, t: "Bolívares en banco", help: "Pago móvil: lo que llegó hoy a la cuenta. Punto: el total del <b>cierre de lote</b>. Todo en <b>bolívares</b>." },
  { k: 3, t: "Divisas digitales", help: "Zelle, Binance y PayPal: lo que llegó hoy." },
  { k: 4, t: "Afuera", help: "Cuenta lo que queda de los productos de afuera." },
  { k: 5, t: "Revisar y enviar", help: "Revisa la diferencia total. Si pasa de Ref 5, explica en la nota qué pasó." }];
function cashTab(t) {
  CASHTAB = t;
  document.querySelectorAll("#cashBody [data-ctab]").forEach(function (b) { b.classList.toggle("on", b.dataset.ctab === t); b.setAttribute("aria-selected", b.dataset.ctab === t ? "true" : "false"); });
  document.querySelectorAll("#cashBody [data-cpanel]").forEach(function (p) { p.classList.toggle("hidden", p.dataset.cpanel !== t); });
}
function cashSteps() { return Array.prototype.map.call(document.querySelectorAll("#cashBody [data-cstep]"), function (b) { return Number(b.dataset.cstep); }); }
function cashStep(n) {
  var list = cashSteps(); if (!list.length) return;
  if (list.indexOf(n) < 0) n = list[0];
  CSTEP = n;
  document.querySelectorAll("#cashBody [data-s]").forEach(function (el) { el.classList.toggle("offstep", n !== 5 ? Number(el.dataset.s) !== n : el.dataset.s === "4"); });
  document.querySelectorAll("#cashBody [data-cstep]").forEach(function (b) { b.classList.toggle("on", Number(b.dataset.cstep) === n); });
  var st = CSTEPS.find(function (x) { return x.k === n; }); $("cstepHelp").innerHTML = st ? st.help : "";
  var last = n === list[list.length - 1];
  if (last && !BLIND.revealed) { BLIND.revealed = true; BLIND.first = blindCash(); }
  var card = document.querySelector("#cashBody .cierre"); if (card) card.classList.toggle("blind", !BLIND.revealed);
  if (typeof cashDiff === "function" && $("cashTotalDiff")) cashDiff();
  $("cstepBack").classList.toggle("invisible", n === list[0]); $("cstepNext").classList.toggle("hidden", last); $("doClose").classList.toggle("hidden", !last);
  cashDoneMarks();
}
// Cierre ciego: el efectivo se cuenta sin ver lo esperado ni la diferencia; todo se ve al llegar a «Revisar y enviar».
// Si después de verlo se cambia lo contado, el primer conteo queda en la nota del cierre (y en el correo).
var BLIND = { session: null, revealed: false, first: null };
function blindCash() {
  var o = {}; ["efectivo_usd", "efectivo_bs"].forEach(function (k) { var i = document.querySelector('#cashBody .cnt[data-m="' + k + '"]'); if (i) o[k] = i.value.trim(); });
  return o;
}
function blindFirstNote(counted) {
  if (!BLIND.first) return "";
  var now = blindCash(), keys = Object.keys(BLIND.first);
  if (!keys.some(function (k) { return BLIND.first[k] !== now[k] && !(BLIND.first[k] !== "" && now[k] !== "" && num(BLIND.first[k]) === num(now[k])); })) return "";
  counted._primer_conteo = {}; keys.forEach(function (k) { counted._primer_conteo[k] = BLIND.first[k] === "" ? null : num(BLIND.first[k]); });
  return "Conteo antes de ver lo esperado: " + keys.map(function (k) { var v = BLIND.first[k]; return (k === "efectivo_usd" ? "efectivo $ " : "efectivo Bs ") + (v === "" ? "sin contar" : nf2.format(num(v))); }).join(" · ") + ".";
}
// Un paso queda con ✓ cuando todo lo que tenía dinero esperado ya está contado
function cashDoneMarks() {
  document.querySelectorAll("#cashBody [data-cstep]").forEach(function (b) {
    var k = Number(b.dataset.cstep), ok;
    if (k <= 3) ok = METHODS.filter(function (m) { return CSTEP_OF[m[0]] === k; }).every(function (m) { var i = document.querySelector('#cashBody .cnt[data-m="' + m[0] + '"]'); return !i || i.value.trim() !== "" || Math.abs(EXPECTED[m[0]] || 0) < 0.01; });
    else if (k === 4) ok = Array.prototype.every.call(document.querySelectorAll("#cashBody .icnt"), function (i) { return i.value.trim() !== ""; });
    else ok = false;
    b.classList.toggle("done", !!ok);
  });
}
$("cashBody").addEventListener("click", function (e) {
  var tb = e.target.closest("[data-ctab]"); if (tb) { cashTab(tb.dataset.ctab); return; }
  var sb2 = e.target.closest("[data-cstep]"); if (sb2) { cashStep(Number(sb2.dataset.cstep)); return; }
  if (e.target.closest("#cstepNext")) { var l = cashSteps(); cashStep(l[Math.min(l.length - 1, l.indexOf(CSTEP) + 1)]); $("cashDlg").scrollTop = 0; return; }
  if (e.target.closest("#cstepBack")) { var l2 = cashSteps(); cashStep(l2[Math.max(0, l2.indexOf(CSTEP) - 1)]); $("cashDlg").scrollTop = 0; return; }
  var id = e.target.id;
  if (id === "setRate") {
    ask({ title: "Tasa del euro BCV (Bs por 1 €)", help: "Escribe la tasa oficial de hoy.", value: ST.rate || "", type: "number" }).then(function (v) {
      if (v === null) return; return rpc("pos_set_rate", { p_rate: num(v), p_source: "manual" }).then(function () { toast("Tasa guardada"); openCash(); });
    }).catch(fail);
  } else if (id === "openCash") {
    rpc("pos_cash_open", { p_usd: num($("fUsd").value), p_bs: num($("fBs").value) }).then(function () { toast("Caja abierta"); openCash(); }).catch(fail);
  } else if (id === "uniBtn") { openUniforms();
  } else if (id === "annBtn") { publishAnnouncement();
  } else if (id === "tabsBtn") { openTabs();
  } else if (id === "buyBtn") { openPurchase();
  } else if (id === "cashOutBtn") { cashOut();
  } else if (e.target.dataset.bills) { var br = document.querySelector("#cashBody [data-billrow]"); if (br) { br.classList.toggle("hidden"); var f = br.querySelector(".bcnt"); if (f && !br.classList.contains("hidden")) f.focus(); }
  } else if (e.target.dataset.see) { var lt = document.querySelector('#cashBody [data-list="' + e.target.dataset.see + '"]'); if (lt) lt.classList.toggle("hidden");
  } else if (id === "soldOut") { openSoldOut();
  } else if (id === "invCount") { openCount();
  } else if (id === "doClose") {
    var counted = {}; document.querySelectorAll("#cashBody .cnt").forEach(function (i) { if (i.value.trim() !== "") counted[i.dataset.m] = num(i.value); });
    var inv = {}, missing = 0; document.querySelectorAll("#cashBody .icnt").forEach(function (i) { if (i.value.trim() !== "") inv[i.dataset.ing] = num(i.value); else missing++; });
    if (missing && !confirm("Faltan " + missing + " productos de afuera por contar. ¿Seguir sin contarlos?")) return;
    var td = cashDiff();
    if (td.uncounted && !confirm("No escribiste lo contado en " + td.uncounted + " métodos que tienen dinero esperado. ¿Seguir así?")) return;
    if (Math.abs(td.total) > 5 && $("cashNotes").value.trim().length < 5) {
      // Antes era un aviso de 2 segundos y parecía que el botón no hacía nada: ahora queda escrito junto al botón
      var ce = $("closeErr");
      ce.innerHTML = "<b>Falta la nota para cerrar.</b> La caja no cuadra por " + esc(ref(Math.abs(td.total))) + " (" + (td.total > 0 ? "sobra" : "falta") + "). Escribe en «Notas del cierre» qué pasó (ej.: vuelto dado por pago móvil, propina, error al cobrar) y vuelve a tocar el botón.";
      ce.classList.remove("hidden"); $("cashNotes").classList.add("need");
      $("cashNotes").scrollIntoView({ block: "center" }); $("cashNotes").focus(); return;
    }
    $("closeErr").classList.add("hidden");
    counted._inv = inv; var bb = billBreakdown(); if (bb) counted._billetes = bb.detail;
    var first = blindFirstNote(counted), typed = $("cashNotes").value.trim();
    closing = { counted: counted, notes: first ? (typed ? typed + " · " : "") + first : typed };
    rpc("pos_cash_preview", { p_counted: counted, p_notes: closing.notes }).then(function (d) {
      closing.recipients = d.recipients || "";
      $("repBody").innerHTML = window.IchirakuReporte ? window.IchirakuReporte.reportHtml(d) : "<pre>" + esc(JSON.stringify(d, null, 2)) + "</pre>";
      $("repSend").textContent = closing.recipients ? "Cerrar caja y enviar por correo" : "Cerrar caja e imprimir (no hay correos configurados)";
      $("repErr").textContent = ""; $("repDlg").showModal(); $("repBody").scrollTop = 0;
    }).catch(fail);
  }
});
// ---- Avisos del restaurante: se muestran al entrar o al llegar, y cada uno se confirma con «Entendido»
var annWho = null;
function showAnnouncements(who) {
  q(sb.rpc("pos_announcements", { p_emp: who.id, p_pin: who.pin })).then(function (list) {
    if (!list || !list.length) return;
    annWho = who; drawAnn(list); $("annDlg").showModal();
  }).catch(function () { /* sin avisos: no bloquea el trabajo */ });
}
function drawAnn(list) {
  $("annBody").innerHTML = list.map(function (a) {
    return '<div class="ann" data-ann="' + a.id + '"><h3>' + esc(a.title) + "</h3>" + (a.body ? "<p>" + esc(a.body) + "</p>" : "") +
      "<small>" + esc(a.by || "") + " · " + new Date(a.at).toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit" }) + '</small><button type="button" class="primary" data-annok="' + a.id + '">Entendido ✓</button></div>';
  }).join("");
  $("annLeft").textContent = list.length + (list.length === 1 ? " aviso" : " avisos");
}
$("annBody").addEventListener("click", function (e) {
  var b = e.target.closest("[data-annok]"); if (!b || !annWho) return; b.disabled = true;
  q(sb.rpc("pos_announcement_read", { p_emp: annWho.id, p_pin: annWho.pin, p_id: Number(b.dataset.annok) })).then(function () {
    var card = b.closest(".ann"); card.remove(); var left = document.querySelectorAll("#annBody .ann").length;
    $("annLeft").textContent = left ? left + (left === 1 ? " aviso" : " avisos") : "";
    if (!left) { $("annDlg").close(); toast("Avisos leídos ✓"); }
  }).catch(function (err) { b.disabled = false; toast(errMsg(err), true); });
});
$("annLater").addEventListener("click", function () { $("annDlg").close(); });
function publishAnnouncement() {
  ask({ title: "Nuevo aviso: título", help: "Lo verá cada persona al entrar con su PIN o al marcar su llegada, y debe tocar «Entendido».", value: "" }).then(function (t) {
    if (t === null || t.trim().length < 2) return;
    ask({ title: "Detalle del aviso (opcional)", help: "Qué cambia, desde cuándo y qué hay que hacer.", value: "" }).then(function (body) {
      if (body === null) return;
      ask({ title: "¿Para quién?", help: "Escribe: todos, sala o cocina.", value: "todos" }).then(function (aud) {
        if (aud === null) return; aud = String(aud).trim().toLowerCase(); if (["todos", "sala", "cocina"].indexOf(aud) < 0) aud = "todos";
        rpc("pos_announcement_create", { p_title: t.trim(), p_body: body.trim(), p_audience: aud, p_days: 7 }).then(function () { toast("Aviso publicado para " + aud); }).catch(fail);
      });
    });
  });
}
// ---- Uniformes de hoy (cuentan para el servicio por rendimiento)
function openUniforms() {
  rpc("pos_uniform_list", {}).then(function (list) {
    $("uniBody").innerHTML = (list || []).length ? list.map(function (p) {
      return '<div class="unirow" data-uni="' + p.id + '"><b>' + esc(p.name) + '</b><button type="button" class="yes' + (p.ok === true ? " on" : "") + '" data-ok="1">✓ Con uniforme</button>' +
        '<button type="button" class="no' + (p.ok === false ? " on" : "") + '" data-ok="0">✗ Sin uniforme</button></div>';
    }).join("") : '<p class="muted">Nadie ha marcado llegada hoy todavía (botón «Marcar llegada o salida» en la pantalla de PIN).</p>';
    $("uniDlg").showModal();
  }).catch(fail);
}
$("uniBody").addEventListener("click", function (e) {
  var b = e.target.closest("[data-ok]"); if (!b) return; var row = b.closest("[data-uni]"), ok = b.dataset.ok === "1";
  var go = function (note) {
    rpc("pos_uniform_set", { p_target: Number(row.dataset.uni), p_ok: ok, p_note: note || "" }).then(function () {
      row.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
    }).catch(fail);
  };
  if (ok) go(""); else ask({ title: "¿Qué faltó del uniforme?", help: "Ej.: delantal, gorro, camisa.", value: "" }).then(function (n) { if (n !== null) go(n); });
});
$("uniClose").addEventListener("click", function () { $("uniDlg").close(); });
// Bolívares sin dormir: cuánto entró hoy en Bs, para cambiarlo o usarlo en compras antes de que pierda valor
function bsReminder() {
  var bsTot = ["efectivo_bs", "pago_movil", "punto_debito", "punto_credito"].reduce(function (a, k) { return a + (EXPECTED[k] || 0); }, 0);
  if (bsTot < 1 || !ST.rate) return "";
  return '<div class="banner warn" style="margin-top:10px"><span><b>Bolívares de hoy: ' + bs(Math.round(bsTot * 100) / 100) + "</b> (≈ " + ref(bsTot / ST.rate) + " a la tasa de hoy). " +
    "Conviene cambiarlos a divisas o usarlos en compras hoy mismo para que no pierdan valor.</span></div>";
}
// ---- Arqueo inteligente: diferencia en vivo, moneda equivocada y total en Ref
var CASH = null, EXPECTED = {};
function cashDiff() {
  var rate = ST && ST.rate, total = 0, uncounted = 0;
  METHODS.forEach(function (m) {
    var inp = document.querySelector('#cashBody .cnt[data-m="' + m[0] + '"]'), cell = document.querySelector('#cashBody [data-diff="' + m[0] + '"]');
    if (!inp || !cell) return;
    var exp = EXPECTED[m[0]] || 0, raw = inp.value.trim(), isBs = m[2] === "BS";
    if (raw === "") { cell.innerHTML = ""; if (Math.abs(exp) > 0.009) uncounted++; return; }
    var c = num(raw), d = Math.round((c - exp) * 100) / 100, dRef = isBs ? (rate ? d / rate : 0) : d;
    total += dRef;
    var neg = exp < -0.009 ? '<div class="cwarn">⚠ El esperado es negativo: se registraron vueltos en efectivo ' + (isBs ? "en bolívares" : "en dólares") + ' que no salieron de esta gaveta. Si los diste por pago móvil o en otra moneda, explícalo en las notas.</div>' : "";
    var warn = neg + (isBs && exp > 1000 && c > 0 && c < exp / 50 ? '<div class="cwarn">⚠ ¿Lo escribiste en dólares? Este método se cuenta en <b>bolívares</b> (≈ Bs ' + nf2.format(rate ? c * rate : 0) + ").</div>" : "");
    cell.innerHTML = (Math.abs(d) < 0.01 ? '<span class="ok">✓ cuadra</span>' : '<span class="' + (d > 0 ? "plus" : "minus") + '">' + (d > 0 ? "sobra " : "falta ") + (isBs ? "Bs " : "$ ") + nf2.format(Math.abs(d)) +
      (isBs && rate ? " (≈ Ref " + nf2.format(Math.abs(dRef)) + ")" : "") + "</span>") + warn;
  });
  var box = $("cashTotalDiff");
  if (box) box.innerHTML = !BLIND.revealed ? '<span>Diferencia total</span><span class="muted" style="font-size:16px">se ve al revisar</span>'
    : '<span>Diferencia total</span><span class="' + (Math.abs(total) < 0.5 ? "ok" : total > 0 ? "plus" : "minus") + '">' + (Math.abs(total) < 0.005 ? "Ref 0,00 ✓" : (total > 0 ? "+" : "−") + ref(Math.abs(total))) + "</span>";
  return { total: Math.round(total * 100) / 100, uncounted: uncounted };
}
// Arqueo por billetes: cuántos de cada uno → total del efectivo $ (y el detalle queda en el cierre)
var BILLS = [100, 50, 20, 10, 5, 1, 0];
function billBreakdown() {
  var out = {}, total = 0, any = false;
  document.querySelectorAll("#cashBody .bcnt").forEach(function (i) { if (i.value.trim() === "") return; any = true; var d = Number(i.dataset.den), v = num(i.value); out[d ? "$" + d : "otros"] = v; total += d ? d * v : v; });
  return any ? { total: Math.round(total * 100) / 100, detail: out } : null;
}
$("cashBody").addEventListener("input", function (e) {
  if (e.target.id === "cashNotes" && e.target.value.trim().length >= 5) { e.target.classList.remove("need"); var ce = $("closeErr"); if (ce) ce.classList.add("hidden"); }
  if (e.target.classList.contains("bcnt")) { var b = billBreakdown(), c = document.querySelector('#cashBody .cnt[data-m="efectivo_usd"]'); if (c) c.value = b ? b.total.toFixed(2) : ""; cashDiff(); return; }
  if (e.target.classList.contains("cnt")) cashDiff();
  if (e.target.classList.contains("cnt") || e.target.classList.contains("icnt") || e.target.classList.contains("bcnt")) cashDoneMarks();
});
function cashOut() {
  ask({ title: "Salida de caja: monto", help: "Dinero que sale del cajón (pago delivery semanal, compra, adelanto). Escribe el monto; después eliges si es en $ o Bs.", value: "", type: "number" }).then(function (a) {
    if (a === null || !(num(a) > 0)) return;
    ask({ title: "¿Moneda?", help: "Escribe $ si salió en dólares o Bs si salió en bolívares.", value: "$" }).then(function (cur2) {
      if (cur2 === null) return; var method = /bs/i.test(cur2) ? "efectivo_bs" : "efectivo_usd";
      ask({ title: "Motivo de la salida", help: "Ej.: Pago delivery semanal, compra de hielo, adelanto a Héctor.", value: "" }).then(function (why) {
        if (why === null) return;
        askPhoto("Foto de la factura o recibo").then(function (ph) {
          if (ph === null) return; // canceló
          uploadFactura(ph).then(function (path) {
            if (path === null) return;
            var args = { p_method: method, p_amount: num(a), p_reason: why }; if (path) args.p_photo = path;
            rpc("pos_cash_out", args).then(function () { toast(path ? "Salida registrada con su foto" : "Salida registrada"); openCash(); }).catch(fail);
          });
        });
      });
    });
  });
}

// Cierre: primero se revisa el reporte completo; al confirmar se cierra y se envía al correo (sin papel)
var closing = null;
function repBack() { $("repDlg").close(); }
$("repBack").addEventListener("click", repBack); $("repBack2").addEventListener("click", repBack);
$("repSend").addEventListener("click", function () {
  if (!closing) return; $("repSend").disabled = true;
  rpc("pos_cash_close", { p_counted: closing.counted, p_notes: closing.notes }).then(function () {
    $("repDlg").close(); $("cashDlg").close();
    toast(closing.recipients ? "Caja cerrada. El cierre llegará al correo: " + closing.recipients : "Caja cerrada. Cierre enviado a la impresora.");
    refreshState();
  }).catch(function (e) { $("repErr").textContent = errMsg(e); }).then(function () { $("repSend").disabled = false; });
});

// ---------------------------------------------------------------- Cuentas del personal
var tabSel = null;
function openTabs() {
  q(sb.rpc("pos_tabs_list")).then(function (t) {
    TABS = t || []; tabSel = null; show("tabPay", false);
    $("tabBody").innerHTML = TABS.map(function (x) {
      var over = num(x.balance) >= num(x.limit);
      return '<button type="button" data-tab="' + x.id + '"><span><b>' + esc(x.name) + "</b><small>" + esc(x.full_name) + " · tope " + ref(x.limit) + '</small></span><b class="n" style="color:' + (over ? "var(--danger)" : num(x.balance) > 0 ? "inherit" : "var(--ok)") + '">' + (num(x.balance) > 0 ? "debe " + ref(x.balance) : "al día") + "</b></button>";
    }).join("");
    $("tabMethod").innerHTML = METHODS.map(function (m) { return '<option value="' + m[0] + '"' + (m[2] === "BS" && !ST.rate ? " disabled" : "") + ">" + m[1] + "</option>"; }).join("");
    if (!$("tabDlg").open) $("tabDlg").showModal();
  }).catch(fail);
}
$("tabBody").addEventListener("click", function (e) {
  var b = e.target.closest("[data-tab]"); if (!b) return; tabSel = TABS.find(function (x) { return x.id === Number(b.dataset.tab); });
  $("tabWho").textContent = "Abono de " + tabSel.name + " · debe " + ref(tabSel.balance); $("tabAmt").value = ""; $("tabErr").textContent = "";
  show("tabPay", true); $("tabAmt").focus();
});
$("tabOk").addEventListener("click", function () {
  if (!tabSel) return; var amt = num($("tabAmt").value); if (!(amt > 0)) { $("tabErr").textContent = "Escribe el monto."; return; }
  rpc("pos_tab_pay", { p_tab: tabSel.id, p_payments: [{ method: $("tabMethod").value, amount: amt, reference: "" }], p_device: devName() || "Sin nombre" }).then(function (r) {
    toast("Abono registrado · " + tabSel.name + " ahora debe " + ref(r.balance)); openTabs();
  }).catch(function (e2) { $("tabErr").textContent = errMsg(e2); });
});
$("tabClose").addEventListener("click", function () { $("tabDlg").close(); });

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
var OUTS = [];
function openPurchase() {
  q(sb.rpc("pos_outside")).then(function (rows) {
    invRows = rows || []; listMode = "compra"; $("listTitle").textContent = "Llegó mercancía";
    $("listHelp").textContent = invRows.length ? "Escribe cuánto llegó de cada producto (en su unidad). Se suma al inventario y lo agotado vuelve solo a la carta." : "Todavía no hay productos de afuera. Se cargan en Gestión → Insumos (zona Afuera).";
    $("listSearch").value = ""; drawList();
    buyPhoto = null;
    $("listFoot").innerHTML = invRows.length ? '<button type="button" id="buyPhoto" style="width:100%;margin-bottom:8px">' + icon("camera") + "<span>Foto de la factura (opcional)</span></button>" +
      '<button type="button" class="primary big" id="savePurchase" style="width:100%">Registrar lo que llegó</button>' : "";
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
    $("listBody").innerHTML = '<table class="tbl"><thead><tr><th>' + (listMode === "compra" ? "Producto" : "Insumo") + '</th><th class="r">Hay</th><th>' + (listMode === "compra" ? "Llegó" : "Contado") + '</th></tr></thead><tbody>' + invRows.filter(function (r) { return !term || r.name.toLowerCase().indexOf(term) >= 0; }).map(function (r) {
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
var buyPhoto = null;
$("listFoot").addEventListener("click", function (e) {
  if (e.target.closest("#buyPhoto")) {
    askPhoto("Foto de la factura de la mercancía").then(function (ph) {
      if (!ph || ph.skip) return;
      buyPhoto = ph; $("buyPhoto").innerHTML = icon("camera") + "<span>Foto lista ✓ (tocar para cambiarla)</span>"; $("buyPhoto").classList.add("on");
    });
    return;
  }
  if (e.target.id === "savePurchase") {
    var items = invRows.filter(function (r) { return r._c != null && num(r._c) > 0; }).map(function (r) { return { id: r.id, qty: num(r._c) }; });
    if (!items.length) return toast("No escribiste ninguna cantidad", true);
    uploadFactura(buyPhoto).then(function (path) {
      if (path === null) return;
      var args = { p_items: items }; if (path) args.p_photo = path;
      rpc("pos_purchase", args).then(function (n) { buyPhoto = null; toast("Mercancía registrada (" + n + " productos)" + (path ? " con su foto" : "")); $("listDlg").close(); loadMenu(); refreshState(); }).catch(fail);
    });
    return;
  }
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

// ---- Foto de la factura: se achica a JPG (máx. 1600 px, ~200 KB) y se sube al bucket privado «facturas».
// askPhoto() devuelve { blob } si tomaron la foto, { skip: true } si siguen sin foto, o null si cancelan.
var photoResolve = null, photoBlob = null;
function askPhoto(title) {
  photoBlob = null; $("photoTitle").textContent = title || "Foto de la factura"; $("photoErr").textContent = "";
  var img = $("photoPrev"); img.hidden = true; img.removeAttribute("src"); $("photoOk").disabled = true; $("photoFile").value = "";
  $("photoPickTxt").innerHTML = icon("camera") + "<span>Tomar foto</span>";
  $("photoDlg").showModal();
  return new Promise(function (res) { photoResolve = res; });
}
function photoDone(v) { var r = photoResolve; photoResolve = null; if ($("photoDlg").open) $("photoDlg").close(); if (r) r(v); }
$("photoFile").addEventListener("change", function () {
  var f = this.files && this.files[0]; if (!f) return;
  $("photoErr").textContent = ""; $("photoPickTxt").textContent = "Preparando la foto…";
  shrinkPhoto(f).then(function (b) {
    photoBlob = b; var img = $("photoPrev"), u = URL.createObjectURL(b);
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = u; img.src = u; img.hidden = false;
    $("photoOk").disabled = false; $("photoPickTxt").innerHTML = icon("camera") + "<span>Tomar otra</span>";
  }).catch(function (e) { $("photoErr").textContent = errMsg(e); $("photoPickTxt").innerHTML = icon("camera") + "<span>Tomar foto</span>"; });
});
$("photoOk").addEventListener("click", function () { if (photoBlob) photoDone({ blob: photoBlob }); });
$("photoSkip").addEventListener("click", function () { photoDone({ skip: true }); });
$("photoDlg").addEventListener("cancel", function () { if (photoResolve) { var r = photoResolve; photoResolve = null; r(null); } });
function shrinkPhoto(file) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(function (b) { if (b) res(b); else rej(new Error("No se pudo preparar la foto")); }, "image/jpeg", 0.72);
    };
    img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("Esa imagen no se pudo abrir. Toma la foto otra vez.")); };
    img.src = url;
  });
}
// Ruta «AAAA-MM/32 letras.jpg» (mes de Venezuela); crypto.getRandomValues funciona también en la copia de la laptop
function newPhotoPath() {
  var a = new Uint8Array(16); crypto.getRandomValues(a);
  var hex = Array.prototype.map.call(a, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  return new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 7) + "/" + hex + ".jpg";
}
// Sube la foto. Devuelve la ruta, "" (sin foto) o null (canceló porque no se pudo subir)
function uploadFactura(ph) {
  if (!ph || ph.skip || !ph.blob) return Promise.resolve("");
  var path = newPhotoPath();
  return sb.storage.from("facturas").upload(path, ph.blob, { contentType: "image/jpeg", upsert: false }).then(function (r) {
    if (r.error) throw r.error;
    return path;
  }).catch(function (e) { return confirm("No se pudo subir la foto (" + errMsg(e) + "). ¿Registrar sin la foto?") ? "" : null; });
}
function anyDialogOpen() { return Array.prototype.some.call(document.querySelectorAll("dialog"), function (d) { return d.open; }); }
function closeDialogs() { document.querySelectorAll("dialog").forEach(function (d) { if (d.open) d.close(); }); if (askResolve) { var r = askResolve; askResolve = null; r(null); } }

// ---------------------------------------------------------------- Arranque (al final: todas las partes ya están cargadas)
// Supabase avisa «SIGNED_IN» cada vez que la pestaña vuelve a verse (pantalla que se enciende, volver de otra app)
// y «TOKEN_REFRESHED» cada hora. Eso no debe cerrar la sesión de quien usa la tablet: el equipo se activa una sola
// vez y solo vuelve a la pantalla de la cuenta de sala si de verdad se cerró la cuenta.
var deviceOn = false;
sb.auth.onAuthStateChange(function (_e, session) {
  setTimeout(function () {
    if (!session) { deviceOn = false; deviceLogin(); return; }
    if (deviceOn) return;
    deviceOn = true; startDevice();
  }, 0);
});
