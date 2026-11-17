// Código QR del recibo (opinión del cliente): el codificador de puente.js contra valores de la norma ISO 18004
// y leyendo de vuelta cada código (formato, máscara, corrección Reed-Solomon y datos). Uso: node pruebas-navegador/qr-recibo.js
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
// El puente lee su config.json al arrancar: se le da una de prueba en una carpeta temporal
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puente-qr-"));
fs.copyFileSync(path.join(__dirname, "..", "puente", "puente.js"), path.join(dir, "puente.js"));
fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ supabase_url: "http://127.0.0.1:9", anon_key: "x", email: "x", password: "x", printers: {} }));
process.env.PUENTE_CONFIG = path.join(dir, "config.json");
const P = require(path.join(dir, "puente.js"));
let fallos = 0;
function ok(cond, msg) { if (cond) console.log("ok: " + msg); else { fallos++; console.log("FALLÓ: " + msg); } }

// 1) Reed-Solomon: el ejemplo clásico «HELLO WORLD» 1-M (16 datos → 10 de corrección)
const hello = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
ok(JSON.stringify(P.qrRS(hello, 10)) === JSON.stringify([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]), "Reed-Solomon da la corrección del ejemplo de la norma (HELLO WORLD 1-M)");
// 2) Bits de formato del nivel M para las 8 máscaras (tabla de la norma)
const tablaM = ["101010000010010", "101000100100101", "101111001111100", "101101101001011", "100010111111001", "100000011001110", "100111110010111", "100101010100000"];
ok(tablaM.every((t, m) => P.qrFormatBits(m).toString(2).padStart(15, "0") === t), "los bits de formato coinciden con la tabla de la norma (nivel M, 8 máscaras)");

// Lector: formato → máscara → datos en zigzag → bloques → síndromes en cero → modo byte
const GF = (() => { const e = new Array(512), l = new Array(256); let x = 1; for (let i = 0; i < 255; i++) { e[i] = x; l[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) e[i] = e[i - 255]; return { e, l }; })();
const mul = (a, b) => (a && b ? GF.e[GF.l[a] + GF.l[b]] : 0);
const BLOQUES = [null, [1, 16, 10], [1, 28, 16], [1, 44, 26], [2, 32, 18], [2, 43, 24], [4, 27, 16]];
const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0];
function leer(q) {
  const M = q.modules, n = q.size, F = q.fn;
  let f1 = 0; const b1 = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
  b1.forEach(([r, c], i) => { if (M[r][c]) f1 |= 1 << i; });
  let f2 = 0; for (let i = 0; i < 8; i++) if (M[8][n - 1 - i]) f2 |= 1 << i; for (let i = 8; i < 15; i++) if (M[n - 15 + i][8]) f2 |= 1 << i;
  const mask = tablaM.findIndex((t) => parseInt(t, 2) === f1);
  if (mask < 0 || f1 !== f2 || !M[n - 8][8]) return { error: "formato" };
  const bits = []; let up = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c = 5;
    for (let i = 0; i < n; i++) { const r = up ? n - 1 - i : i; for (let j = 0; j < 2; j++) { const cc = c - j; if (!F[r][cc]) bits.push(M[r][cc] !== MASKS[mask](r, cc) ? 1 : 0); } }
    up = !up;
  }
  const ver = (n - 17) / 4, [nb, nd, ne] = BLOQUES[ver], total = nb * (nd + ne), cw = [];
  for (let i = 0; i < total; i++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j]; cw.push(v); }
  const blocks = []; for (let b = 0; b < nb; b++) blocks.push([]);
  for (let i = 0; i < nd; i++) for (let b = 0; b < nb; b++) blocks[b].push(cw[i * nb + b]);
  for (let i = 0; i < ne; i++) for (let b = 0; b < nb; b++) blocks[b].push(cw[nb * nd + i * nb + b]);
  // Síndromes: el bloque completo evaluado en α^0..α^(ne-1) debe dar cero
  const sindromesCero = blocks.every((blk) => { for (let i = 0; i < ne; i++) { let s = 0; for (const x of blk) s = mul(s, GF.e[i]) ^ x; if (s) return false; } return true; });
  const data = [].concat(...blocks.map((blk) => blk.slice(0, nd))), db = []; data.forEach((v) => { for (let j = 7; j >= 0; j--) db.push((v >> j) & 1); });
  const num = (a, len) => db.slice(a, a + len).reduce((v, x) => (v << 1) | x, 0);
  const modo = num(0, 4), largo = num(4, 8), out = [];
  for (let i = 0; i < largo; i++) out.push(num(12 + i * 8, 8));
  return { mask, version: ver, sindromesCero, modo, texto: Buffer.from(out).toString("utf8"), sobrantes: bits.length - total * 8 };
}

// 3) Cada versión lleva los módulos de datos que dice la norma, y se lee de vuelta exactamente
const MODULOS = [null, 208, 359, 567, 807, 1079, 1383], BASE = "https://ichiraku-corp.github.io/menu-restaurante/opinion.html?t=";
const textos = ["HELLO WORLD", "https://ichiraku.test/x", "https://ichiraku.test/abcdefghij12", "https://ichiraku-corp.github.io/menu-restaurante/", BASE + "AbCdEfGh12_-", BASE + "AbCdEfGh12_-" + "x".repeat(20), "Ñandú 🍜 " + "z".repeat(80)];
const vistas = new Set();
for (const t of textos) {
  const q = P.qrMatrix(t), r = leer(q); vistas.add(q.version);
  ok(q.dataModules === MODULOS[q.version] && r.sobrantes === q.dataModules - q.codewords * 8, "versión " + q.version + ": " + q.dataModules + " módulos de datos, como en la norma");
  ok(!r.error && r.sindromesCero && r.modo === 4 && r.texto === t && r.mask === q.mask, "versión " + q.version + " se lee de vuelta: formato, máscara " + q.mask + ", corrección y texto");
}
ok(vistas.size === 6, "se probaron las " + vistas.size + " versiones que puede hacer (1 a 6)");
const lasOcho = [0, 1, 2, 3, 4, 5, 6, 7].filter((m) => { const r = leer(P.qrMatrix(BASE + "AbCdEfGh12_-", m)); return r.mask === m && r.sindromesCero && r.texto === BASE + "AbCdEfGh12_-"; });
ok(lasOcho.length === 8, "el enlace se lee de vuelta con cualquiera de las 8 máscaras (" + lasOcho.join(",") + ")");
ok(P.qrMatrix(BASE + "AbCdEfGh12_-").version === 5, "el enlace de opinión (78 letras) cabe en un código de versión 5");
let err = ""; try { P.qrMatrix("x".repeat(107)); } catch (e) { err = e.message; }
ok(/muy largo/.test(err), "un texto que no cabe da un error claro (no imprime algo ilegible)");

// 4) Para la impresora: imagen centrada (GS v 0) y la marca «@qr» dentro del ticket
const b = P.qrBytes(BASE + "AbCdEfGh12_-");
ok(b[0] === 0x1b && b[1] === 0x61 && b[2] === 1 && b.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00])) > 0, "el QR sale como imagen centrada, igual que el logo");
const lado = (37 + 8) * 6, bw = Math.ceil(lado / 8);
ok(b[b.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00])) + 4] === bw, "mide " + lado + " puntos de ancho (unos 3,4 cm en una impresora de 80 mm)");
const t = P.render("~Cuentanos como te fue\n@qr " + BASE + "AbCdEfGh12_-\n~Gracias");
ok(t.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00])) > 0 && t.indexOf(Buffer.from("@qr")) < 0, "en el ticket, «@qr enlace» se imprime como código, no como texto");
const t2 = P.render("@qr " + "x".repeat(300));
ok(t2.indexOf(Buffer.from("xxxx")) < 0, "si el enlace no cabe, el ticket sale igual sin el código");

if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
console.log("TODAS LAS PRUEBAS DEL CÓDIGO QR PASARON");
