// Puente de la laptop sin internet: recibe pedidos de las tablets, los guarda, imprime la comanda y no repite.
// Uso: node pruebas-navegador/puente-sinred.js   (no necesita internet ni impresora: se simula una)
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), net = require("net"), http = require("http");
let fallos = 0;
function ok(c, m) { if (c) console.log("ok: " + m); else { fallos++; console.log("FALLÓ: " + m); } }

(async () => {
  // Impresora simulada (puerto 9100 de otra máquina)
  const impreso = [];
  const printer = net.createServer((s) => { const ch = []; s.on("data", (d) => ch.push(d)); s.on("end", () => impreso.push(Buffer.concat(ch).toString("latin1"))); });
  await new Promise((r) => printer.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puente-prueba-"));
  fs.copyFileSync(path.join(__dirname, "..", "puente", "puente.js"), path.join(dir, "puente.js"));
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ supabase_url: "http://127.0.0.1:9", anon_key: "x", email: "x", password: "x",
    printers: { cocina: { ip: "127.0.0.1", port: printer.address().port }, caja: { ip: "127.0.0.1", port: printer.address().port } } }));
  fs.writeFileSync(path.join(dir, "llave-red-local.txt"), "llave-prueba");
  process.env.PUENTE_CONFIG = path.join(dir, "config.json");
  const P = require(path.join(dir, "puente.js"));
  const srv = http.createServer((req, res) => P.srApi(req, res, req.url));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  const call = (p, o = {}) => fetch(base + p, Object.assign({ headers: { "x-sinred": "llave-prueba", "Content-Type": "application/json" } }, o)).then(async (r) => ({ status: r.status, body: await r.json() }));
  const entry = { uuid: "srprueba0001", device: "Tablet Feria", emp: 1, emp_name: "Sasha", pin: "1111", added: false,
    order: { tmp: "sr-123456", kind: "mesa", table_id: 7, label: "Feria 4" }, items: [{ dish_id: 4, name: "Gyozas", qty: 2, notes: "sin salsa", unit_price: 5 }] };

  try {
    ok((await call("/api/sinred/hola", { headers: {} })).body.ok, "la tablet ve que la laptop está (sin llave)");
    ok((await call("/api/sinred/estado", { headers: { "x-sinred": "otra" } })).status === 403, "sin la llave correcta no se aceptan pedidos");
    ok((await call("/api/sinred/enviar", { method: "POST", body: JSON.stringify(Object.assign({}, entry, { items: [] })) })).status === 400, "rechaza un envío sin platos");
    const r1 = await call("/api/sinred/enviar", { method: "POST", body: JSON.stringify(entry) });
    ok(r1.status === 200 && r1.body.impreso, "recibe el pedido y lo imprime");
    await new Promise((r) => setTimeout(r, 300));
    const coc = impreso.find((t) => t.includes("SIN INTERNET")) || "";
    ok(/Feria 4/.test(coc) && /2 Gyozas/.test(coc) && />> sin salsa/.test(coc), "la comanda de cocina lleva mesa, plato y nota, marcada SIN INTERNET");
    ok(impreso.some((t) => /ORDEN SIN INTERNET/.test(t)), "también sale la copia de caja");
    const r2 = await call("/api/sinred/enviar", { method: "POST", body: JSON.stringify(entry) });
    ok(r2.body.repetido && impreso.length === 2, "si la tablet reintenta el mismo envío, no se imprime dos veces");
    const saved = fs.readFileSync(path.join(dir, "sin-internet.jsonl"), "utf8").trim().split("\n");
    ok(saved.length === 1 && JSON.parse(saved[0]).items[0].notes === "sin salsa", "queda guardado en la laptop para subirlo después");
    const list = await call("/api/sinred/pedidos");
    ok(list.body.pedidos.length === 1 && !("pin" in list.body.pedidos[0]), "lista lo pendiente por subir sin mostrar el PIN");
    ok(P.srPending().length === 1, "queda pendiente hasta que vuelva el internet");
  } catch (e) { fallos++; console.log("FALLÓ: " + e.message); }
  srv.close(); printer.close();
  fs.rmSync(dir, { recursive: true, force: true });
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DEL PUENTE SIN INTERNET PASARON");
  process.exit(0);
})();
