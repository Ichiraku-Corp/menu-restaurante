#!/usr/bin/env node
// Puente de impresión de Ichiraku (corre en la laptop de caja, Windows).
//
//  · Cada 2 segundos pide a Supabase los trabajos de impresión pendientes (comandas,
//    precuentas, recibos, cierres) y los manda a la impresora que toca por la red
//    (ESC/POS, puerto 9100).
//  · Cada 30 minutos lee la tasa del euro del BCV y la guarda para la caja.
//
// Usa la cuenta «impresora», que solo puede leer la cola de impresión y guardar la tasa.
// Configuración: config.json en esta misma carpeta (copia de config.example.json).
// Sin dependencias: solo Node.js 22 o más nuevo.
"use strict";
const fs = require("fs");
const net = require("net");
const path = require("path");

const DIR = __dirname;
const LOG = path.join(DIR, "puente.log");
const cfg = JSON.parse(fs.readFileSync(process.env.PUENTE_CONFIG || path.join(DIR, "config.json"), "utf8"));
const URL_ = String(cfg.supabase_url).replace(/\/$/, "");
const WIDTH = cfg.width || 48;
const POLL_MS = cfg.poll_ms || 2000;

function log(...a) {
  const line = new Date().toLocaleString("es-VE", { hour12: false }) + "  " + a.join(" ");
  console.log(line);
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2e6) fs.renameSync(LOG, LOG + ".1");
    fs.appendFileSync(LOG, line + "\n");
  } catch (e) { /* sin log en disco */ }
}

// ---------------------------------------------------------------- Sesión
let token = null, refresh = null, expires = 0;
async function auth() {
  const body = refresh && Date.now() < expires + 6 * 3600e3
    ? { grant_type: "refresh_token", data: { refresh_token: refresh } }
    : { grant_type: "password", data: { email: cfg.email, password: cfg.password } };
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=${body.grant_type}`, {
    method: "POST", headers: { apikey: cfg.anon_key, "Content-Type": "application/json" }, body: JSON.stringify(body.data),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { refresh = null; throw new Error("No se pudo entrar con la cuenta impresora: " + (j.error_description || j.msg || r.status)); }
  token = j.access_token; refresh = j.refresh_token; expires = Date.now() + (j.expires_in || 3600) * 1000;
}
async function rpc(name, args) {
  if (!token || Date.now() > expires - 120e3) await auth();
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: cfg.anon_key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args || {}),
  });
  if (r.status === 401) { token = null; throw new Error("Sesión vencida, se renovará"); }
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------- ESC/POS
const ESC = 0x1b, GS = 0x1d;
// Las impresoras vienen en la página de códigos 0 (EE. UU.): se quitan acentos y se dejan solo caracteres ASCII.
function ascii(s) {
  return String(s).replace(/ñ/g, "n").replace(/Ñ/g, "N").replace(/[¿¡]/g, "").replace(/€/g, "EUR")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "");
}
function wrap(text, width) {
  const out = [];
  for (let line of text.split("\n")) {
    while (line.length > width) {
      let cut = line.lastIndexOf(" ", width);
      if (cut < width / 2) cut = width;
      out.push(line.slice(0, cut)); line = line.slice(cut).replace(/^ /, "  ");
    }
    out.push(line);
  }
  return out;
}
// Marcas del texto que llega de la base de datos:  «^texto» = grande y en negrita · «=» = línea separadora.
function render(body) {
  const parts = [Buffer.from([ESC, 0x40])]; // reiniciar
  for (const raw of String(body).split("\n")) {
    if (raw === "=") { parts.push(Buffer.from("-".repeat(WIDTH) + "\n", "ascii")); continue; }
    const big = raw.startsWith("^");
    const text = ascii(big ? raw.slice(1) : raw);
    if (big) parts.push(Buffer.from([ESC, 0x21, 0x38])); // doble alto y ancho, negrita
    for (const l of wrap(text, big ? Math.floor(WIDTH / 2) : WIDTH)) parts.push(Buffer.from(l + "\n", "ascii"));
    if (big) parts.push(Buffer.from([ESC, 0x21, 0x00]));
  }
  parts.push(Buffer.from([ESC, 0x64, 0x04]));       // avanzar 4 líneas
  parts.push(Buffer.from([GS, 0x56, 0x42, 0x00]));   // cortar el papel
  return Buffer.concat(parts);
}
function send(ip, port, data) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: ip, port: port || 9100 });
    const t = setTimeout(() => { s.destroy(); reject(new Error(`La impresora ${ip} no responde`)); }, 8000);
    s.on("connect", () => s.end(data));
    s.on("close", (hadErr) => { clearTimeout(t); if (!hadErr) resolve(); });
    s.on("error", (e) => { clearTimeout(t); reject(new Error(`Impresora ${ip}: ${e.code || e.message}`)); });
  });
}

// ---------------------------------------------------------------- Cola de impresión
let busy = false, lastErr = "";
async function tick() {
  if (busy) return; busy = true;
  try {
    const jobs = await rpc("pos_print_next", { p_limit: 10 });
    for (const j of jobs || []) {
      const p = (cfg.printers || {})[j.printer];
      if (!p) { await rpc("pos_print_done", { p_id: j.id, p_ok: false, p_error: `No hay impresora «${j.printer}» en config.json` }); continue; }
      try {
        await send(p.ip, p.port, render(j.body));
        await rpc("pos_print_done", { p_id: j.id, p_ok: true });
        log(`Impreso #${j.id} en ${j.printer}`);
      } catch (e) {
        await rpc("pos_print_done", { p_id: j.id, p_ok: false, p_error: e.message }).catch(() => {});
        log(`ERROR #${j.id} (${j.printer}): ${e.message}`);
        break; // reintenta en la próxima vuelta, en orden
      }
    }
    if (lastErr) { log("Conexión recuperada"); lastErr = ""; }
  } catch (e) {
    if (e.message !== lastErr) log("ERROR: " + e.message);
    lastErr = e.message;
  } finally { busy = false; }
}

// ---------------------------------------------------------------- Tasa euro BCV
const MES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
function parseBcv(html) {
  const m = html.match(/id="euro"[\s\S]*?<strong>\s*([\d.,]+)\s*<\/strong>/i);
  if (!m) throw new Error("No encontré la tasa del euro en la página del BCV");
  const rate = Number(m[1].replace(/\./g, "").replace(",", "."));
  if (!(rate > 0)) throw new Error("Tasa del BCV no válida: " + m[1]);
  let date = null;
  const d1 = html.match(/Fecha Valor[\s\S]{0,300}?content="(\d{4}-\d{2}-\d{2})/i);
  if (d1) date = d1[1];
  else {
    const d2 = html.match(/Fecha Valor:?[\s\S]{0,200}?(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (d2 && MES[d2[2].toLowerCase()]) date = `${d2[3]}-${String(MES[d2[2].toLowerCase()]).padStart(2, "0")}-${d2[1].padStart(2, "0")}`;
  }
  return { rate, date };
}
let lastRate = "";
async function updateRate() {
  if (cfg.bcv === false) return;
  try {
    const r = await fetch("https://www.bcv.org.ve/", { headers: { "User-Agent": "Ichiraku-puente/1.0" } });
    if (!r.ok) throw new Error("BCV respondió " + r.status);
    const { rate, date } = parseBcv(await r.text());
    await rpc("pos_set_rate", { p_rate: rate, p_source: "bcv", p_date: date });
    const key = rate + "|" + date;
    if (key !== lastRate) log(`Tasa euro BCV: ${rate} Bs (fecha valor ${date || "hoy"})`);
    lastRate = key;
  } catch (e) {
    log("No se pudo leer la tasa del BCV (la caja puede escribirla a mano): " + (e.cause ? e.cause.code || e.cause.message : e.message));
  }
}

// ---------------------------------------------------------------- Inicio
if (require.main === module) {
  if (process.argv.includes("--prueba")) {
    const which = process.argv[process.argv.indexOf("--prueba") + 1] || "cocina";
    const p = cfg.printers[which];
    send(p.ip, p.port, render(`^PRUEBA ${which.toUpperCase()}\nPuente de impresion Ichiraku\n${new Date().toLocaleString("es-VE")}\n=\nSi lees esto, la impresora funciona.`))
      .then(() => { console.log("Enviado a " + which + " (" + p.ip + ")"); process.exit(0); })
      .catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    log(`Puente iniciado. Cocina ${cfg.printers.cocina && cfg.printers.cocina.ip} · Caja ${cfg.printers.caja && cfg.printers.caja.ip}`);
    tick(); setInterval(tick, POLL_MS);
    updateRate(); setInterval(updateRate, (cfg.bcv_minutes || 30) * 60e3);
  }
}
module.exports = { render, parseBcv, ascii, wrap };
