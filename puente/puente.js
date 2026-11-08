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
const CFG_FILE = process.env.PUENTE_CONFIG || path.join(DIR, "config.json");
const cfg = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"));
// Si se edita config.json (correo, claves de Binance/PayPal…), se vuelve a leer solo, sin reiniciar el puente.
let cfgTime = 0; try { cfgTime = fs.statSync(CFG_FILE).mtimeMs; } catch (e) { /* nada */ }
function reloadConfig() {
  try {
    const t = fs.statSync(CFG_FILE).mtimeMs; if (t === cfgTime) return;
    const fresh = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"));
    cfgTime = t;
    for (const k of ["correo", "binance", "paypal", "bcv", "bcv_minutes", "actualizar"]) { if (k in fresh) cfg[k] = fresh[k]; else delete cfg[k]; }
    log("config.json cambió: se volvió a leer. " + keysInfo() + " · correo " + (cfg.correo && cfg.correo.host && cfg.correo.password ? "configurado (" + cfg.correo.user + ")" : "SIN configurar"));
  } catch (e) { log("config.json tiene un error de escritura, se sigue usando el anterior: " + e.message); }
}
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
// Logo del ticket (perro de Ichiraku) en blanco y negro: archivo PBM binario (P4) junto al puente.
// Se convierte una sola vez a la orden de imagen de las impresoras (GS v 0), en franjas de 64 líneas.
let LOGO = null;
function logoBytes() {
  if (LOGO !== null) return LOGO;
  LOGO = Buffer.alloc(0);
  try {
    const f = fs.readFileSync(path.join(DIR, "logo.pbm"));
    let pos = 0; const tok = [];
    while (tok.length < 3) { // cabecera: P4 ancho alto (con posibles comentarios)
      while (/\s/.test(String.fromCharCode(f[pos]))) pos++;
      if (f[pos] === 0x23) { while (f[pos] !== 0x0a) pos++; continue; }
      let t = ""; while (!/\s/.test(String.fromCharCode(f[pos]))) t += String.fromCharCode(f[pos++]);
      tok.push(t);
    }
    pos++;
    const w = +tok[1], h = +tok[2], bw = Math.ceil(w / 8);
    if (tok[0] !== "P4" || !w || !h) throw new Error("formato");
    const out = [Buffer.from([ESC, 0x61, 0x01])]; // centrado
    for (let y = 0; y < h; y += 64) {
      const rows = Math.min(64, h - y);
      out.push(Buffer.from([GS, 0x76, 0x30, 0x00, bw & 0xff, bw >> 8, rows & 0xff, rows >> 8]));
      out.push(f.subarray(pos + y * bw, pos + (y + rows) * bw));
    }
    out.push(Buffer.from([ESC, 0x61, 0x00]));
    LOGO = Buffer.concat(out);
  } catch (e) { log("Sin logo para los tickets: " + e.message); }
  return LOGO;
}

// Marcas en el texto de los tickets:  "=" línea  ·  "@logo" imagen  ·  "^" grande  ·  "~" centrado (se pueden combinar: "~^")
function render(body) {
  const parts = [Buffer.from([ESC, 0x40])]; // reiniciar
  for (const raw of String(body).split("\n")) {
    if (raw === "=") { parts.push(Buffer.from("-".repeat(WIDTH) + "\n", "ascii")); continue; }
    if (raw.trim() === "@logo") { parts.push(logoBytes()); continue; }
    let s = raw, big = false, center = false;
    while (s[0] === "^" || s[0] === "~") { if (s[0] === "^") big = true; else center = true; s = s.slice(1); }
    const text = ascii(s);
    if (center) parts.push(Buffer.from([ESC, 0x61, 0x01]));
    if (big) parts.push(Buffer.from([ESC, 0x21, 0x38])); // doble alto y ancho, negrita
    for (const l of wrap(text, big ? Math.floor(WIDTH / 2) : WIDTH)) parts.push(Buffer.from((center ? l.trim() : l) + "\n", "ascii"));
    if (big) parts.push(Buffer.from([ESC, 0x21, 0x00]));
    if (center) parts.push(Buffer.from([ESC, 0x61, 0x00]));
  }
  parts.push(Buffer.from([ESC, 0x64, 0x04]));       // avanzar 4 líneas
  parts.push(Buffer.from([GS, 0x56, 0x42, 0x00]));   // cortar el papel
  return Buffer.concat(parts);
}
// Impresora instalada en Windows (por USB): se manda el ticket tal cual con imprimir-usb.ps1.
const { execFile } = require("child_process");
const os = require("os");
function sendWindows(name, data) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `ichiraku-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    fs.writeFileSync(tmp, data);
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(DIR, "imprimir-usb.ps1"), "-Impresora", name, "-Archivo", tmp],
      { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmp); } catch (e) { /* nada */ }
        if (err) reject(new Error(`Impresora «${name}»: ${(stderr || err.message).toString().trim().split("\n").pop()}`)); else resolve();
      });
  });
}
function sendTo(p, data) { return p.windows ? sendWindows(p.windows, data) : send(p.ip, p.port, data); }
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
        await sendTo(p, render(j.body));
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
  const m = html.match(/id=["']euro["'][\s\S]{0,800}?<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/i)
    || html.match(/>\s*EUR\s*<[\s\S]{0,500}?<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/i)
    || html.match(/euro[\s\S]{0,500}?(\d{1,4},\d{4,8})/i);
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
// Fecha en Caracas (UTC-4) y siguiente día hábil (el BCV publica en la tarde la tasa del próximo día hábil)
function ccsDate(ms) { return new Date(ms - 4 * 3600e3).toISOString().slice(0, 10); }
function nextBusinessDay(ymd) { const d = new Date(ymd + "T12:00:00Z"); do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10); }
// Fuente 1: la página del BCV. Su certificado viene incompleto (le falta el intermedio), así que el puente
// descarga ese intermedio desde la dirección que trae el propio certificado (AIA) y lo guarda; la conexión sigue verificada.
const https = require("https"), httpMod = require("http");
const BCV_CA = path.join(DIR, "bcv-intermedio.pem");
function getUrl(url, opts) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : httpMod;
    const req = mod.get(url, Object.assign({ headers: { "User-Agent": "Mozilla/5.0 (Ichiraku-puente)" }, timeout: 40000 }, opts || {}), (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(getUrl(new URL(res.headers.location, url).href, opts)); }
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("no respondió a tiempo"), { name: "TimeoutError" })));
    req.on("error", reject);
  });
}
function toPem(der) {
  if (der.toString("latin1").includes("-----BEGIN CERTIFICATE-----")) return der.toString("latin1");
  return "-----BEGIN CERTIFICATE-----\n" + der.toString("base64").match(/.{1,64}/g).join("\n") + "\n-----END CERTIFICATE-----\n";
}
async function fetchBcvIntermediate() {
  const leaf = await new Promise((resolve, reject) => {
    const s = tls.connect({ host: "www.bcv.org.ve", port: 443, servername: "www.bcv.org.ve", rejectUnauthorized: false }, () => { const c = s.getPeerCertificate(); s.end(); resolve(c); });
    s.setTimeout(30000, () => s.destroy(new Error("no respondió a tiempo"))); s.on("error", reject);
  });
  const m = String(leaf.infoAccess && leaf.infoAccess["CA Issuers - URI"] || "").match(/https?:\/\/\S+/);
  if (!m) throw new Error("el certificado del BCV no indica dónde está su intermedio");
  const r = await getUrl(m[0]);
  if (r.status !== 200) throw new Error("no se pudo bajar el intermedio (" + r.status + ")");
  fs.writeFileSync(BCV_CA, toPem(r.body));
  log("Certificado intermedio del BCV descargado y guardado");
}
async function bcvGet() {
  const ca = () => tls.rootCertificates.concat(fs.existsSync(BCV_CA) ? [fs.readFileSync(BCV_CA, "utf8")] : []);
  try { return await getUrl("https://www.bcv.org.ve/", { ca: ca() }); }
  catch (e) {
    if (!/UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT/.test(e.code || e.message)) throw e;
    await fetchBcvIntermediate();
    return await getUrl("https://www.bcv.org.ve/", { ca: ca() });
  }
}
async function rateFromBcv() {
  const r = await bcvGet();
  if (r.status !== 200) throw new Error("respondió " + r.status);
  const html = r.body.toString("utf8");
  try { return parseBcv(html); }
  catch (e) { try { fs.writeFileSync(path.join(DIR, "bcv-pagina.html"), html); } catch (e2) { /* nada */ } throw new Error(e.message + " (copia guardada en bcv-pagina.html)"); }
}
// Fuente 2 (respaldo): DolarAPI, que copia el euro oficial del BCV
async function rateFromDolarApi() {
  const r = await fetch("https://ve.dolarapi.com/v1/euros/oficial", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("respondió " + r.status);
  const j = await r.json();
  const rate = Number(j.promedio || j.venta || j.compra);
  if (!(rate > 0)) throw new Error("sin tasa en la respuesta");
  // Si se actualizó después de las 3 p. m. (hora de Caracas) es la tasa publicada para el próximo día hábil
  let date = null;
  const t = Date.parse(j.fechaActualizacion);
  if (t) { const day = ccsDate(t), hour = new Date(t - 4 * 3600e3).getUTCHours(), dow = new Date(day + "T12:00:00Z").getUTCDay();
    date = hour >= 15 || dow === 0 || dow === 6 ? nextBusinessDay(day) : day; }
  return { rate: Math.round(rate * 10000) / 10000, date };
}
function errText(e) { return e.cause ? e.cause.code || e.cause.message : e.name === "TimeoutError" ? "no respondió a tiempo" : e.code || e.message; }
let rateTimer = null;
async function updateRate() {
  clearTimeout(rateTimer);
  if (cfg.bcv === false) return;
  let ok = false; const fails = [];
  for (const [name, fn] of [["BCV", rateFromBcv], ["DolarAPI", rateFromDolarApi]]) {
    try {
      const { rate, date } = await fn();
      await rpc("pos_set_rate", { p_rate: rate, p_source: name === "BCV" ? "bcv" : "bcv-dolarapi", p_date: date });
      const key = rate + "|" + date;
      if (key !== lastRate) log(`Tasa euro BCV: ${rate} Bs (fecha valor ${date || "hoy"}, leída de ${name})`);
      lastRate = key; ok = true; break;
    } catch (e) { fails.push(`${name}: ${errText(e)}`); }
  }
  if (!ok) log("No se pudo leer la tasa del BCV, se reintenta en 5 min (la caja puede escribirla a mano): " + fails.join(" · "));
  rateTimer = setTimeout(updateRate, ok ? (cfg.bcv_minutes || 30) * 60e3 : 5 * 60e3);
}

// ---------------------------------------------------------------- Correo del cierre de caja
// Envía por SMTP (por ejemplo Gmail con «contraseña de aplicación») el reporte detallado de cada cierre
// a los correos que define administración (Gestión → Ventas → Ajustes).
const tls = require("tls");
function smtpSend(o, to, subject, html) {
  return new Promise((resolve, reject) => {
    const sock = o.secure === false ? net.connect(o.port || 25, o.host) : tls.connect({ host: o.host, port: o.port || 465, servername: o.host });
    let buf = "", waiters = [];
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("El servidor de correo no responde")); }, 30000);
    sock.setEncoding("utf8");
    sock.on("data", (d) => {
      buf += d; let m;
      while ((m = buf.match(/^(\d{3})([ -])(.*)\r?\n/m)) && buf.indexOf(m[0]) === 0) {
        buf = buf.slice(m[0].length);
        if (m[2] === " " && waiters.length) waiters.shift()(Number(m[1]), m[3]);
      }
    });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
    const step = (cmd, ok) => new Promise((res, rej) => {
      waiters.push((code, text) => (ok.includes(code) ? res(code) : rej(new Error(`Correo: ${code} ${text}`))));
      if (cmd !== null) sock.write(cmd + "\r\n");
    });
    const b64 = (x) => Buffer.from(x, "utf8").toString("base64");
    const from = o.from || o.user;
    const msg = [
      `From: =?UTF-8?B?${b64(o.from_name || "Ichiraku Ramen")}?= <${from}>`, `To: ${to.join(", ")}`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      b64(html).replace(/.{76}/g, "$&\r\n"), "",
    ].join("\r\n");
    (async () => {
      await step(null, [220]);
      await step("EHLO ichiraku-caja", [250]);
      if (o.user) { await step("AUTH LOGIN", [334]); await step(b64(o.user), [334]); await step(b64(o.password), [235]); }
      await step(`MAIL FROM:<${from}>`, [250]);
      for (const r of to) await step(`RCPT TO:<${r}>`, [250, 251]);
      await step("DATA", [354]);
      await step(msg + "\r\n.", [250]);
      sock.write("QUIT\r\n"); sock.end(); clearTimeout(timer); resolve();
    })().catch((e) => { clearTimeout(timer); sock.destroy(); reject(e); });
  });
}

const fm = (n) => Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hh = (t) => (t ? new Date(t).toLocaleString("es-VE", { timeZone: "America/Caracas", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const he = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// El HTML del reporte vive en app/reporte-cierre.js (el mismo que usa la vista previa de la caja).
function reportHtml(d) {
  try {
    const f = path.join(DIR, "app", "reporte-cierre.js");
    delete require.cache[require.resolve(f)];
    return require(f).reportHtml(d);
  } catch (e) {
    log("Reporte simple (no se pudo cargar app/reporte-cierre.js): " + e.message);
    return "<h1>Cierre de caja · Ichiraku Ramen</h1><pre>" + he(JSON.stringify(d, null, 2)) + "</pre>";
  }
}
async function sendReports() {
  if (!cfg.correo || !cfg.correo.host) return;
  try {
    const list = await rpc("pos_report_next");
    for (const r of list || []) {
      const to = String(r.recipients).split(/[,;\s]+/).filter((x) => /@/.test(x));
      const s = (r.data && r.data.session) || {};
      try {
        if (!to.length) throw new Error("Sin destinatarios");
        await smtpSend(cfg.correo, to, `Cierre de caja ${hh(s.closed_at)} · Ref ${fm(r.data.totals && r.data.totals.total)}`, reportHtml(r.data));
        await rpc("pos_report_done", { p_id: r.id, p_ok: true });
        log(`Cierre enviado por correo a ${to.join(", ")}`);
      } catch (e) {
        await rpc("pos_report_done", { p_id: r.id, p_ok: false, p_error: e.message }).catch(() => {});
        log("ERROR al enviar el cierre por correo: " + e.message);
      }
    }
  } catch (e) { log("ERROR (correo): " + e.message); }
}

// ---------------------------------------------------------------- Inicio
if (require.main === module) {
  if (process.argv.includes("--pagos")) {
    // Diagnóstico: node puente.js --pagos
    console.log("Archivo de configuración: " + (process.env.PUENTE_CONFIG || path.join(DIR, "config.json")));
    console.log(keysInfo());
    setImmediate(async () => {
      await checkBinance(); await checkPaypal();
      for (const [n, fn] of [["BCV", rateFromBcv], ["DolarAPI", rateFromDolarApi]]) {
        try { const x = await fn(); console.log(`Tasa ${n}: ${x.rate} (fecha valor ${x.date || "hoy"})`); } catch (e) { console.log(`Tasa ${n}: ERROR ${errText(e)}`); }
      }
      console.log("Listo."); process.exit(0);
    });
  } else if (process.argv.includes("--prueba")) {
    const which = process.argv[process.argv.indexOf("--prueba") + 1] || "cocina";
    const p = cfg.printers[which];
    sendTo(p, render(`@logo\n~^PRUEBA ${which.toUpperCase()}\n~Puente de impresion Ichiraku\n${new Date().toLocaleString("es-VE")}\n=\nSi lees esto, la impresora funciona.`))
      .then(() => { console.log("Enviado a " + which + " (" + (p.windows || p.ip) + ")"); process.exit(0); })
      .catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    // Una sola copia a la vez: si ya hay un puente corriendo, esta termina sin hacer nada.
    const lock = net.createServer();
    lock.once("error", () => { console.log("El puente ya está funcionando."); process.exit(0); });
    lock.listen(47811, "127.0.0.1", () => { rollbackIfBroken(); startBridge(); });
  }
}
// ---------------------------------------------------------------- App de sala servida desde la laptop
// Para tablets cuya red no abre GitHub: http://IP-DE-LA-LAPTOP:8080/pos.html (archivos en la carpeta «app»).
const http = require("http");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
function serveApp() {
  const root = path.join(DIR, "app");
  if (cfg.app_port === false || !fs.existsSync(path.join(root, "pos.html"))) return;
  const port = cfg.app_port || 8080;
  http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || "/").split("?")[0]);
    if (rel === "/" || rel === "") rel = "/pos.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("No encontrado"); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
    if (ext === ".html") {
      // En la red local se sirve por http: se quita «upgrade-insecure-requests», que obligaría a pedir todo por https.
      res.end(fs.readFileSync(file, "utf8").replace(/;\s*upgrade-insecure-requests/g, ""));
      return;
    }
    fs.createReadStream(file).pipe(res);
  }).on("error", (e) => log("ERROR al servir la app: " + e.message))
    .listen(port, "0.0.0.0", () => {
      const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
      log("App de sala para las tablets: " + ips.map((ip) => `http://${ip}:${port}/pos.html`).join("  ·  "));
    });
}

// ---------------------------------------------------------------- Pagos recibidos: Binance Pay y PayPal
// Lee lo que entró a las cuentas y lo sube a Supabase para que caja lo elija al cobrar (verificado).
// Claves en config.json: "binance": {"api_key", "api_secret"} (solo lectura) y "paypal": {"client_id", "client_secret"}.
const crypto = require("crypto");
const lastErr2 = {};
const VERBOSE = process.argv.includes("--pagos");
function keysInfo() {
  const b = cfg.binance || {}, p = cfg.paypal || {}, m = (v) => (v ? `sí (${String(v).trim().length} letras)` : "NO");
  return `Claves de pago → Binance: api_key ${m(b.api_key)}, api_secret ${m(b.api_secret)} · PayPal: client_id ${m(p.client_id)}, client_secret ${m(p.client_secret)}`;
}
async function reportCheck(source, err) {
  const msg = err ? (String(err.message || err) + (err.cause ? " (" + (err.cause.code || err.cause.message) + ")" : "")).slice(0, 200) : "";
  if (msg !== lastErr2[source]) { log(msg ? `ERROR ${source}: ${msg}` : `${source}: conectado y revisando pagos`); lastErr2[source] = msg; }
  try { await rpc("pos_incoming_checked", { p_source: source, p_error: msg }); } catch (e) { /* se reintenta en la próxima vuelta */ }
}
// Binance exige que la hora de la consulta coincida con la suya: se usa su reloj, no el de la laptop.
let bnOffset = null;
async function binanceOffset() {
  const t0 = Date.now();
  const r = await fetch("https://api.binance.com/api/v3/time", { signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  bnOffset = Number(j.serverTime) - Math.round((t0 + Date.now()) / 2);
}
async function checkBinance(retry) {
  const b = cfg.binance; if (!b || !b.api_key || !b.api_secret) return;
  try {
    if (bnOffset === null) await binanceOffset();
    const now = Date.now() + bnOffset - 500;
    const qs = `startTime=${now - 36 * 3600e3}&endTime=${now}&limit=100&recvWindow=10000&timestamp=${now}`;
    const sig = crypto.createHmac("sha256", b.api_secret).update(qs).digest("hex");
    const r = await fetch(`https://api.binance.com/sapi/v1/pay/transactions?${qs}&signature=${sig}`, { headers: { "X-MBX-APIKEY": b.api_key }, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (VERBOSE) console.log(`Binance respondió ${r.status}: ${(j.data || []).length} movimientos en 36 h (${(j.data || []).filter((t) => Number(t.amount) > 0).length} recibidos)`, j.code && j.code !== "000000" ? j : "");
    if (j.code === -1021 && !retry) { bnOffset = null; return checkBinance(true); } // reloj desfasado: se recalcula y se reintenta
    if (!r.ok || (j.code && j.code !== "000000" && j.code !== 0)) throw new Error(`${r.status} ${j.msg || j.message || JSON.stringify(j).slice(0, 150)}`);
    const rows = (j.data || []).filter((t) => Number(t.amount) > 0).map((t) => ({
      source: "binance", tx_id: String(t.transactionId || t.orderId), amount: Number(t.amount), currency: t.currency || "",
      payer: (t.payerInfo && (t.payerInfo.name || t.payerInfo.binanceId)) ? String(t.payerInfo.name || t.payerInfo.binanceId) : "",
      note: t.note || t.remark || "", received_at: new Date(Number(t.transactionTime)).toISOString(),
    }));
    if (rows.length) { const n = await rpc("pos_incoming_push", { p_rows: rows }); if (n) log(`Binance: ${n} pago(s) nuevo(s) recibido(s)`); }
    await reportCheck("binance", null);
  } catch (e) { await reportCheck("binance", e); }
}
let ppToken = null, ppExp = 0, ppRetry = null;
async function checkPaypal() {
  const p = cfg.paypal; if (!p || !p.client_id || !p.client_secret) return;
  try {
    const base = p.sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    if (!ppToken || Date.now() > ppExp - 60e3) {
      const r = await fetch(`${base}/v1/oauth2/token`, { method: "POST", body: "grant_type=client_credentials", signal: AbortSignal.timeout(30000),
        headers: { Authorization: "Basic " + Buffer.from(`${p.client_id}:${p.client_secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`clave rechazada (${r.status} ${j.error_description || j.error || ""})`);
      ppToken = j.access_token; ppExp = Date.now() + (j.expires_in || 3000) * 1000;
    }
    const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
    const url = `${base}/v1/reporting/transactions?start_date=${iso(Date.now() - 3 * 86400e3)}&end_date=${iso(Date.now())}&fields=transaction_info,payer_info&page_size=200`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${ppToken}` }, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (VERBOSE) console.log(`PayPal respondió ${r.status}: ${(j.transaction_details || []).length} movimientos en 3 días`, r.ok ? "" : j);
    if (r.status === 401) ppToken = null;
    if (!r.ok) throw new Error(`${r.status} ${j.message || j.name || ""}${/PERMISSION|AUTHORIZ/i.test(j.name || "") ? " (activa «Transaction search» en la app de PayPal)" : ""}`);
    const rows = (j.transaction_details || []).map((d) => {
      const t = d.transaction_info || {}, pi = d.payer_info || {}, a = t.transaction_amount || {};
      return { source: "paypal", tx_id: t.transaction_id, amount: Number(a.value), currency: a.currency_code || "",
        payer: (pi.payer_name && (pi.payer_name.alternate_full_name || [pi.payer_name.given_name, pi.payer_name.surname].filter(Boolean).join(" "))) || pi.email_address || "",
        note: t.transaction_note || t.transaction_subject || "", received_at: t.transaction_initiation_date, status: t.transaction_status };
    }).filter((x) => x.amount > 0 && x.tx_id && x.status === "S");
    if (rows.length) { const n = await rpc("pos_incoming_push", { p_rows: rows }); if (n) log(`PayPal: ${n} pago(s) nuevo(s) recibido(s)`); }
    await reportCheck("paypal", null);
  } catch (e) {
    await reportCheck("paypal", e);
    // internet lento o caído un momento: se reintenta en 1 minuto en vez de esperar 5
    if (!ppRetry) ppRetry = setTimeout(() => { ppRetry = null; checkPaypal(); }, 60e3);
  }
}

// ---------------------------------------------------------------- Actualizaciones automáticas
// Cada 10 min pregunta a Supabase si hay versión nueva. Solo acepta archivos permitidos (nunca config.json),
// comprueba el sha256 de cada uno y la sintaxis de puente.js, guarda respaldo en «respaldo\» y reinicia.
// Si la versión nueva no logra arrancar 3 veces seguidas, vuelve sola a la anterior.
const VERSION_FILE = path.join(DIR, "version.txt"), TRIAL_FILE = path.join(DIR, "actualizacion-en-prueba.json"), BACKUP_DIR = path.join(DIR, "respaldo");
function currentVersion() { try { return parseInt(fs.readFileSync(VERSION_FILE, "utf8"), 10) || 0; } catch (e) { return 0; } }
function allowedPath(rel) {
  if (typeof rel !== "string" || rel.includes("..") || path.isAbsolute(rel) || /[:*?"<>|]/.test(rel)) return false;
  const n = rel.replace(/\\/g, "/");
  if (/(^|\/)config(\.example)?\.json$/i.test(n) || /\.(log|bat|vbs|exe|cmd)$/i.test(n)) return false;
  return n === "puente.js" || n === "logo.pbm" || n === "imprimir-usb.ps1" || n.startsWith("app/");
}
function rollbackIfBroken() {
  // Se llama al arrancar: si hay una actualización en prueba, cuenta el intento y, al tercero, restaura el respaldo.
  let t; try { t = JSON.parse(fs.readFileSync(TRIAL_FILE, "utf8")); } catch (e) { return; }
  t.tries = (t.tries || 0) + 1;
  if (t.tries < 3) { fs.writeFileSync(TRIAL_FILE, JSON.stringify(t)); return; }
  for (const rel of t.files || []) {
    const bak = path.join(BACKUP_DIR, rel);
    try { if (fs.existsSync(bak)) { fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true }); fs.copyFileSync(bak, path.join(DIR, rel)); } } catch (e) { /* sigue */ }
  }
  fs.writeFileSync(VERSION_FILE, String(t.from || 0));
  fs.writeFileSync(path.join(DIR, "version-fallida.txt"), String(t.version));
  fs.unlinkSync(TRIAL_FILE);
  log(`La versión ${t.version} no arrancó bien: se restauró la ${t.from}. No se volverá a instalar esa versión.`);
  process.exit(4); // iniciar.bat vuelve a arrancar ya con los archivos restaurados
}
let updating = false;
async function checkUpdate() {
  if (updating || cfg.actualizar === false) return; updating = true;
  try {
    const from = currentVersion();
    const rel = await rpc("pos_bridge_check", { p_version: from, p_info: { node: process.version, host: os.hostname() } });
    if (!rel || !rel.version) return;
    let failed = 0; try { failed = parseInt(fs.readFileSync(path.join(DIR, "version-fallida.txt"), "utf8"), 10) || 0; } catch (e) { /* nada */ }
    if (rel.version <= failed) return; // esa versión ya falló aquí
    const files = (rel.files || []).filter((f) => allowedPath(f.path));
    // 1) Escribir todo como .nuevo y verificar
    for (const f of files) {
      const buf = Buffer.from(f.b64, "base64");
      if (crypto.createHash("sha256").update(buf).digest("hex") !== f.sha256) throw new Error(`${f.path}: el archivo llegó dañado`);
      const dest = path.join(DIR, f.path); fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest + ".nuevo", buf);
    }
    const js = files.find((f) => f.path === "puente.js");
    if (js) {
      const chk = path.join(os.tmpdir(), "ichiraku-puente-revision.js");
      fs.copyFileSync(path.join(DIR, "puente.js.nuevo"), chk);
      await new Promise((res, rej) => execFile(process.execPath, ["--check", chk], { windowsHide: true }, (e, o, er) =>
        (e ? rej(new Error("puente.js nuevo con errores: " + String(er).split("\n").filter((l) => /Error/.test(l))[0])) : res())));
    }
    // 2) Respaldo de lo actual y reemplazo
    for (const f of files) {
      const dest = path.join(DIR, f.path), bak = path.join(BACKUP_DIR, f.path);
      if (fs.existsSync(dest)) { fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.copyFileSync(dest, bak); }
      fs.renameSync(dest + ".nuevo", dest);
    }
    fs.writeFileSync(VERSION_FILE, String(rel.version));
    log(`Actualizado a la versión ${rel.version}${rel.notes ? ": " + rel.notes : ""} (${files.length} archivo(s))`);
    if (files.some((f) => f.path === "logo.pbm")) LOGO = null;
    if (js) { // reiniciar para usar el puente nuevo (en prueba hasta que pase 2 min funcionando)
      fs.writeFileSync(TRIAL_FILE, JSON.stringify({ version: rel.version, from, files: files.map((f) => f.path), tries: 0 }));
      setTimeout(() => process.exit(3), 1500);
    }
  } catch (e) {
    for (const f of fs.readdirSync(DIR)) if (f.endsWith(".nuevo")) try { fs.unlinkSync(path.join(DIR, f)); } catch (e2) { /* nada */ }
    log("No se pudo actualizar: " + (e.message || e));
  } finally { updating = false; }
}

function startBridge() {
  serveApp();
  {
    const desc = (p) => (p ? (p.windows ? "USB «" + p.windows + "»" : p.ip) : "sin configurar");
    log(`Puente iniciado. Cocina ${desc(cfg.printers.cocina)} · Caja ${desc(cfg.printers.caja)} · Edo ${desc(cfg.printers.edo)}`);
    tick(); setInterval(tick, POLL_MS);
    updateRate();
    log("Correo de cierres: " + (cfg.correo && cfg.correo.host && cfg.correo.password ? "configurado (" + cfg.correo.user + ")" : "SIN configurar"));
    setInterval(reloadConfig, 30e3);
    sendReports(); setInterval(sendReports, 60e3);
    log(keysInfo() + ` · versión ${currentVersion()}`);
    // Si arrancó una actualización en prueba y lleva 2 min bien, queda confirmada
    if (fs.existsSync(TRIAL_FILE)) setTimeout(() => { try { fs.unlinkSync(TRIAL_FILE); log("Actualización confirmada: funciona bien"); } catch (e) { /* nada */ } }, 120e3);
    setTimeout(checkUpdate, 20e3); setInterval(checkUpdate, 10 * 60e3);
    checkBinance(); setInterval(checkBinance, 60e3);          // Binance Pay: casi al instante
    checkPaypal(); setInterval(checkPaypal, 5 * 60e3);        // PayPal: su reporte tarda hasta 3 h en mostrar cada pago
  }
}
module.exports = { checkUpdate, rollbackIfBroken, allowedPath, render, parseBcv, ascii, wrap, smtpSend, reportHtml, checkBinance, checkPaypal };
