// Recibo «Pop dulce»: cabecera con el nombre, líneas punteadas, total entre reglas y gracias en burbuja (solo en los tickets del cliente).
// La comanda de cocina y las impresoras de 58 mm siguen como antes. Uso: node pruebas-navegador/recibo-pop.js
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
let fallos = 0;
function ok(cond, msg) { if (cond) console.log("ok: " + msg); else { fallos++; console.log("FALLÓ: " + msg); } }
// El puente lee su config.json al arrancar: se le da una de prueba en una carpeta temporal, con el logo que toque
function puente(ancho, logo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puente-pop-"));
  fs.copyFileSync(path.join(__dirname, "..", "puente", "puente.js"), path.join(dir, "puente.js"));
  if (logo) fs.writeFileSync(path.join(dir, "logo.pbm"), logo);
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ supabase_url: "http://127.0.0.1:9", anon_key: "x", email: "x", password: "x", printers: {}, width: ancho }));
  process.env.PUENTE_CONFIG = path.join(dir, "config.json");
  return require(path.join(dir, "puente.js"));
}
const IMG = Buffer.from([0x1d, 0x76, 0x30, 0x00]);
const imagenes = (b) => { let n = 0, i = -1; while ((i = b.indexOf(IMG, i + 1)) >= 0) n++; return n; };
const pbm = (w, h) => Buffer.concat([Buffer.from("P4\n" + w + " " + h + "\n"), Buffer.alloc(Math.ceil(w / 8) * h, 0x55)]);
const recibo = ["@logo", "~^ICHIRAKU RAMEN", "~RECIBO - no es factura fiscal", "Feria 1   21/11 08:45 pm", "=", "2 Ramen Teuchi            19,00", "=",
  "~^TOTAL  Ref 26,40", "~^Bs 13.852,34", "~(tasa 524,71)", "=", "~Precios con IVA incluido.", "", "~Gracias por tu visita!", "", "~Como te fue? Cuentanos en 1 minuto"].join("\n");

const P = puente(48, fs.readFileSync(path.join(__dirname, "..", "puente", "logo.pbm")));
const t = P.render(recibo);
ok(t.indexOf(Buffer.from("ICHIRAKU RAMEN")) < 0, "la cabecera nueva ya trae el nombre: no se repite en letras");
ok(t.indexOf(Buffer.from("RECIBO - no es factura fiscal")) > 0 && t.indexOf(Buffer.from("TOTAL  Ref 26,40")) > 0 && t.indexOf(Buffer.from("Bs 13.852,34")) > 0,
  "el título, el total y los bolívares siguen en letras (se imprimen rápido y nítidos)");
ok(t.indexOf(Buffer.from("-----")) < 0, "las líneas separadoras ya no son guiones");
ok(t.indexOf(Buffer.from("Gracias por tu visita")) < 0 && t.indexOf(Buffer.from("Como te fue")) < 0, "las gracias y el texto del QR salen como imagen (con tildes)");
ok(imagenes(t) >= 1 + 1 + 2 + 1 + 1, "imágenes: cabecera, línea de puntos, dos reglas del total, burbuja y texto del QR (" + imagenes(t) + ")");
const anchos = []; let i = -1; while ((i = t.indexOf(IMG, i + 1)) >= 0) anchos.push((t[i + 4] | (t[i + 5] << 8)) * 8);
ok(anchos.every((w) => w <= 512), "nada pasa de 512 puntos: cabe en cualquier impresora de 80 mm (" + Math.max.apply(null, anchos) + ")");
const comanda = P.render("~^MESA 4\n=\n2 Ramen Teuchi\n=\n~Gracias por tu visita!");
ok(comanda.indexOf(Buffer.from("-".repeat(48))) > 0 && imagenes(comanda) === 0 && comanda.indexOf(Buffer.from("Gracias por tu visita")) > 0,
  "la comanda de cocina (sin logo) sigue igual: guiones y solo letras");

const Pv = puente(48, pbm(288, 40));
ok(Pv.render(recibo).indexOf(Buffer.from("ICHIRAKU RAMEN")) > 0, "con el logo viejo (sin nombre), el nombre sí sale en letras");
const P58 = puente(32, fs.readFileSync(path.join(__dirname, "..", "puente", "logo.pbm")));
const t58 = P58.render(recibo);
ok(t58.indexOf(Buffer.from("-".repeat(32))) > 0 && t58.indexOf(Buffer.from("Gracias por tu visita")) > 0, "en papel de 58 mm el recibo sale como antes (el arte no cabe)");
ok(imagenes(t58) === 0 && t58.indexOf(Buffer.from("ICHIRAKU RAMEN")) > 0, "y sin la cabecera de 512 puntos (no cabe en 384): el nombre va en letras");

if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
console.log("TODAS LAS PRUEBAS DEL RECIBO POP PASARON");
