// Recibo «Pop dulce»: cabecera con el nombre, líneas punteadas, total entre reglas y el bloque de reseña (solo en los tickets del cliente).
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
  "~^TOTAL  Ref 26,40", "~^Bs 13.852,34", "~(tasa 524,71)", "=", "~Precios con IVA incluido.", "", "~Como te fue? Cuentanos en 1 minuto"].join("\n");

const P = puente(48, fs.readFileSync(path.join(__dirname, "..", "puente", "logo.pbm")));
const t = P.render(recibo);
ok(t.indexOf(Buffer.from("ICHIRAKU RAMEN")) < 0, "la cabecera nueva ya trae el nombre: no se repite en letras");
ok(t.indexOf(Buffer.from("RECIBO - no es factura fiscal")) > 0 && t.indexOf(Buffer.from("TOTAL  Ref 26,40")) > 0 && t.indexOf(Buffer.from("Bs 13.852,34")) > 0,
  "el título, el total y los bolívares siguen en letras (se imprimen rápido y nítidos)");
ok(t.indexOf(Buffer.from("-----")) < 0, "las líneas separadoras ya no son guiones");
ok(t.indexOf(Buffer.from("Como te fue")) < 0, "el texto del QR de antes sale como imagen (con tildes)");
ok(imagenes(t) >= 1 + 1 + 2 + 1, "imágenes: cabecera, línea de puntos, dos reglas del total y texto del QR (" + imagenes(t) + ")");
const anchos = []; let i = -1; while ((i = t.indexOf(IMG, i + 1)) >= 0) anchos.push((t[i + 4] | (t[i + 5] << 8)) * 8);
ok(anchos.every((w) => w <= 512), "nada pasa de 512 puntos: cabe en cualquier impresora de 80 mm (" + Math.max.apply(null, anchos) + ")");
const comanda = P.render("~^MESA 4\n=\n2 Ramen Teuchi\n=\n~Sin cebollin");
ok(comanda.indexOf(Buffer.from("-".repeat(48))) > 0 && imagenes(comanda) === 0 && comanda.indexOf(Buffer.from("Sin cebollin")) > 0,
  "la comanda de cocina (sin logo) sigue igual: guiones y solo letras");

const Pv = puente(48, pbm(288, 40));
ok(Pv.render(recibo).indexOf(Buffer.from("ICHIRAKU RAMEN")) > 0, "con el logo viejo (sin nombre), el nombre sí sale en letras");
const P58 = puente(32, fs.readFileSync(path.join(__dirname, "..", "puente", "logo.pbm")));
const t58 = P58.render(recibo);
ok(t58.indexOf(Buffer.from("-".repeat(32))) > 0 && t58.indexOf(Buffer.from("Como te fue")) > 0, "en papel de 58 mm el recibo sale como antes (el arte no cabe)");
ok(imagenes(t58) === 0 && t58.indexOf(Buffer.from("ICHIRAKU RAMEN")) > 0, "y sin la cabecera de 512 puntos (no cabe en 384): el nombre va en letras");

// Bloque de reseña (25/11): «@resena enlace nombres» = una imagen de 512 puntos con el QR, quién atendió y 5 estrellas
const ENLACE = "https://ichiraku-corp.github.io/menu-restaurante/opinion.html?t=AbCdEfGh12_-";
const anchosDe = (b) => { const a = []; let k = -1; while ((k = b.indexOf(IMG, k + 1)) >= 0) a.push((b[k + 4] | (b[k + 5] << 8)) * 8); return a; };
const r1 = P.render("@logo\n~RECIBO - no es factura fiscal\n=\nPunto debito   Bs 1\n\n@resena " + ENLACE + " Mei");
ok(r1.indexOf(Buffer.from("@resena")) < 0 && r1.indexOf(Buffer.from("Mei")) < 0 && r1.indexOf(Buffer.from("opinion.html")) < 0,
  "el bloque de reseña sale como imagen: ni la marca, ni el enlace, ni el nombre en letras");
ok(anchosDe(r1).slice(-5).every((w) => w === 512) && anchosDe(r1).every((w) => w <= 512), "el bloque mide 512 puntos de ancho, como el resto del arte (" + imagenes(r1) + " franjas)");
const sinNombre = P.render("@logo\n\n@resena " + ENLACE), dos = P.render("@logo\n\n@resena " + ENLACE + " Mei|Nami");
ok(Buffer.compare(r1, sinNombre) !== 0 && Buffer.compare(r1, dos) !== 0 && Buffer.compare(r1, P.render("@logo\n~RECIBO - no es factura fiscal\n=\nPunto debito   Bs 1\n\n@resena " + ENLACE + " Nami")) !== 0,
  "con otro nombre, con dos o sin nombre, el bloque cambia");
ok(P.resenaLineas(["Mei"], 196).length === 1 && P.medir("Mei") <= 196, "un nombre cabe en una línea de la columna");
const l2 = P.resenaLineas(["Mei", "Nami"], 196), l3 = P.resenaLineas(["Mei", "Nami", "Luz"], 196);
ok(l2.join("|") === (P.medir("Mei y Nami") <= 196 ? "Mei y Nami" : "Mei|y Nami") && l3.join(" ") === "Mei, Nami y Luz" && l3.every((l) => P.medir(l) <= 196),
  "dos o tres nombres se parten antes de la última «y» o por palabras, sin pasarse de la columna");
ok(P.medir("Mariángel Ñ") > P.medir("Mariangel N") - 1 && P.medir("€") === P.medir("?"), "las tildes y la ñ tienen su letra; lo que no existe sale como «?» (no rompe el recibo)");
let roto = null; try { roto = P.render("@logo\n\n@resena " + "x".repeat(300) + " Ana"); } catch (e) { roto = null; }
ok(roto && roto.indexOf(Buffer.from("xxxx")) < 0, "si el enlace no cabe en el QR, el recibo sale igual, sin el código");
const P58b = puente(32, fs.readFileSync(path.join(__dirname, "..", "puente", "logo.pbm")));
const r58 = P58b.render("@logo\n~RECIBO\n\n@resena " + ENLACE + " Mei|Nami");
ok(r58.indexOf(Buffer.from("Te gusta Ichiraku?")) > 0 && r58.indexOf(Buffer.from("Deja tu resena")) > 0 && r58.indexOf(Buffer.from("Te atendio: Mei y Nami")) > 0 && r58.indexOf(Buffer.from("@resena")) < 0
   && imagenes(r58) >= 1 && anchosDe(r58).every((w) => w <= 384), "en papel de 58 mm, el bloque sale en letras con el QR suelto (el arte no cabe): " + anchosDe(r58).join(","));

if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
console.log("TODAS LAS PRUEBAS DEL RECIBO POP PASARON");
