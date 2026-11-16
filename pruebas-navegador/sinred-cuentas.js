// Cobrar sin internet: con qué total se cobra una cuenta (pos-sinred.js en una máquina virtual, sin navegador).
// Uso: node pruebas-navegador/sinred-cuentas.js
"use strict";
const vm = require("vm"), fs = require("fs"), path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "pos-sinred.js"), "utf8");
let fallos = 0;
function ok(cond, msg) { if (cond) console.log("ok: " + msg); else { fallos++; console.log("FALLÓ: " + msg); } }

// Una tablet que se quedó sin internet, con lo que tenía guardado
function tablet(guardado) {
  const store = {}, enviados = [];
  Object.keys(guardado).forEach((k) => { store["sr-" + k] = JSON.stringify(guardado[k]); });
  const ctx = {
    console, Promise, JSON, Math, Date, Object, Array, String, Number, Error,
    location: { port: "8080", hostname: "192.168.0.10" },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    crypto: { getRandomValues: (a) => a }, setInterval: () => 0, setTimeout: () => 0,
    document: { body: { classList: { contains: () => false, toggle() {} }, insertBefore() {} }, createElement: () => ({ classList: { toggle() {} }, setAttribute() {} }) },
    $: () => null, esc: (s) => s, toast: () => {}, refreshState: () => Promise.resolve(), goTables() {}, tableById: (id) => ({ area: "Feria", number: id }),
    devName: () => "Caja", minfo: (k) => [k, k, ["efectivo_usd", "zelle", "binance", "paypal"].includes(k) ? "REF" : "BS"],
    ref: (n) => "Ref " + n.toFixed(2), chgTxt: () => "", priceOf: (d) => d.price, num: (x) => Number(x) || 0, q: (p) => p, fail() {}, drawMenu() {},
    MENU: { dishes: [{ id: 7, name: "Ramen", price: 10 }] }, cur: {},
    sb: { rpc: () => Promise.resolve({ data: null, error: null }), from: () => ({}) },
    fetch: (url, opts) => { enviados.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext("var U = { id: 1, name: 'Cajera', pin: '1111', charge: true }; var ST = JSON.parse(localStorage.getItem('sr-st') || 'null');", ctx);
  vm.runInContext(SRC, ctx);
  vm.runInContext("SR.on = true; SR.token = 't';", ctx);
  return { run: (code) => vm.runInContext(code, ctx), enviados };
}
const lista = (total, paid, saved) => ({ rate: 100, service_pct: 10, session: { id: 1 }, tables: [{ id: 42, area: "Feria", number: 42 }], _saved: saved,
  orders: [{ id: 42, kind: "mesa", table_id: 42, label: "Feria 42", total: total, paid: paid, items: 2 }] });
const copia = (saved) => ({ 42: { id: 42, kind: "mesa", status: "abierta", service_pct: 10, _saved: saved,
  totals: { subtotal: 20, discount: 0, service: 2, delivery: 0, total: 22, paid: 0 }, items: [{ id: 1, name: "Ramen", qty: 2, unit_price: 10, status: "enviado" }] } });

(async () => {
  // 1) Otra tablet le agregó platos después de que esta abrió la cuenta: la lista (más nueva) dice Ref 55, la copia Ref 22
  let t = tablet({ st: lista(55, 0, 2000), ords: copia(1000) });
  let d = t.run("SRH.pos_order({ p_order: 42 })");
  ok(d.totals.total === 55 && d.items.some((i) => /Consumo anterior/.test(i.name)), "si la lista de cuentas es más nueva y no cuadra, se cobra su total (Ref 55, no los Ref 22 de la copia vieja)");
  let err = null; try { await t.run("SRH.pos_pay({ p_order: 42, p_payments: [{ method: 'efectivo_usd', amount: 22 }] })"); } catch (e) { err = e.message; }
  ok(/Falta por cobrar/.test(err || ""), "no deja cobrar Ref 22 de una cuenta de Ref 55");
  // 2) Un abono hecho en otra tablet: la lista dice que ya pagaron Ref 10
  t = tablet({ st: lista(22, 10, 2000), ords: copia(1000) });
  d = t.run("SRH.pos_order({ p_order: 42 })");
  ok(d.totals.total - d.totals.paid === 12, "un abono hecho en otra tablet se descuenta (quedan Ref 12, no Ref 22)");
  // 3) Nada cambió: se cobra con la copia, plato por plato
  t = tablet({ st: lista(22, 0, 2000), ords: copia(1000) });
  d = t.run("SRH.pos_order({ p_order: 42 })");
  ok(d.totals.total === 22 && d.items.length === 1 && d.items[0].name === "Ramen", "si la copia cuadra con la lista, el recibo lleva sus platos");
  // 4) La copia es más nueva que la lista (esta tablet acaba de agregar algo con internet): vale la copia
  t = tablet({ st: lista(11, 0, 1000), ords: copia(2000) });
  d = t.run("SRH.pos_order({ p_order: 42 })");
  ok(d.totals.total === 22 && d.items[0].name === "Ramen", "si la copia es más nueva que la lista, vale la copia");
  // 5) Delivery abierto sin internet: lo que cobra el delivery entra en la cuenta y sube con el pedido
  t = tablet({ st: lista(22, 0, 2000), ords: {} });
  const id = t.run("SRH.pos_open_delivery({ p_name: 'Ana', p_phone: '0414', p_address: 'Centro', p_fee: 3 })");
  t.run("SRH.pos_add({ p_order: " + id + ", p_items: [{ dish_id: 7, qty: 1 }] })");
  await t.run("SRH.pos_send({ p_order: " + id + " })");
  d = t.run("SRH.pos_order({ p_order: " + id + " })");
  const env = t.enviados.find((x) => /enviar/.test(x.url));
  ok(d.totals.delivery === 3 && d.totals.total === 13, "un delivery abierto sin internet cobra el delivery (Ref 10 + Ref 3)");
  ok(env && env.body.order.delivery_fee === 3, "y se lo pasa a la laptop para que quede en el pedido");
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DE CUENTAS SIN INTERNET PASARON");
})().catch((e) => { console.log("FALLÓ: " + e.message); process.exit(1); });
