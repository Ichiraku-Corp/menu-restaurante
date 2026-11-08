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
async function updateRate() {
  if (cfg.bcv === false) return;
  try {
    const r = await fetch("https://www.bcv.org.ve/", { headers: { "User-Agent": "Ichiraku-puente/1.0" } });
    if (!r.ok) throw new Error("BCV respondió " + r.status);
    const html = await r.text();
    let parsed;
    try { parsed = parseBcv(html); }
    catch (e) { try { fs.writeFileSync(path.join(DIR, "bcv-pagina.html"), html); } catch (e2) { /* nada */ } throw new Error(e.message + " (copia guardada en bcv-pagina.html, " + html.length + " caracteres)"); }
    const { rate, date } = parsed;
    await rpc("pos_set_rate", { p_rate: rate, p_source: "bcv", p_date: date });
    const key = rate + "|" + date;
    if (key !== lastRate) log(`Tasa euro BCV: ${rate} Bs (fecha valor ${date || "hoy"})`);
    lastRate = key;
  } catch (e) {
    log("No se pudo leer la tasa del BCV (la caja puede escribirla a mano): " + (e.cause ? e.cause.code || e.cause.message : e.message));
  }
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

const MNAMES = { efectivo_usd: "Efectivo $", efectivo_bs: "Efectivo Bs", pago_movil: "Pago móvil", punto_debito: "Punto débito",
  punto_credito: "Punto crédito", zelle: "Zelle", binance: "Binance", paypal: "PayPal" };
const BS = new Set(["efectivo_bs", "pago_movil", "punto_debito", "punto_credito"]);
const fm = (n) => Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fq = (n) => Number(n || 0).toLocaleString("es-VE", { maximumFractionDigits: 2 });
const hh = (t) => (t ? new Date(t).toLocaleString("es-VE", { timeZone: "America/Caracas", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const he = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function table(head, rows, right) {
  const th = head.map((h, i) => `<th style="text-align:${right.includes(i) ? "right" : "left"};padding:6px 8px;border-bottom:2px solid #333;font-size:12px;text-transform:uppercase;color:#555">${h}</th>`).join("");
  const tr = rows.map((r) => "<tr>" + r.map((c, i) => `<td style="text-align:${right.includes(i) ? "right" : "left"};padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top">${c}</td>`).join("") + "</tr>").join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:6px 0 18px">${th ? "<thead><tr>" + th + "</tr></thead>" : ""}<tbody>${tr || `<tr><td style="padding:6px 8px;color:#777">Ninguno</td></tr>`}</tbody></table>`;
}
function reportHtml(d) {
  const s = d.session || {}, t = d.totals || {}, exp = s.expected || {}, cnt = s.counted || {};
  const H = (x) => `<h2 style="font-size:17px;margin:22px 0 4px;color:#e5206b">${x}</h2>`;
  const methods = Object.keys(MNAMES).filter((k) => Number(exp[k] || 0) !== 0 || k in cnt).map((k) => {
    const cur = BS.has(k) ? "Bs " : "$ ", m = (d.methods || []).find((x) => x.method === k) || {};
    const diff = k in cnt ? Number(cnt[k]) - Number(exp[k] || 0) : null;
    return [MNAMES[k], m.count || 0, cur + fm(m.amount), "Ref " + fm(m.amount_ref), cur + fm(exp[k]), k in cnt ? cur + fm(cnt[k]) : "sin contar",
      diff === null ? "" : `<b style="color:${Math.abs(diff) < 0.01 ? "#2f7d4f" : "#b3261e"}">${cur + fm(diff)}</b>`];
  });
  return `<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:900px;color:#1f1a17">
<h1 style="font-size:22px;margin:0">Cierre de caja · Ichiraku Ramen</h1>
<p style="color:#555;margin:4px 0 0">Apertura ${hh(s.opened_at)} (${he(s.opened_by)}) · Cierre ${hh(s.closed_at)} (${he(s.closed_by)}) · Tasa € BCV ${fm(d.rate)}</p>
${H("Resumen")}${table([], [["Pedidos cobrados", fq(t.orders)], ["Pedidos anulados", fq(t.cancelled)], ["Ventas con IVA (sin servicio)", "Ref " + fm(t.sales)],
    ["Descuentos", "Ref " + fm(t.discounts)], ["Servicio 10 %", "Ref " + fm(t.service)], ["Delivery", "Ref " + fm(t.delivery)], ["<b>Total cobrado</b>", "<b>Ref " + fm(t.total) + "</b>"],
    ["Fondo inicial", "$ " + fm(s.opening_usd) + " · Bs " + fm(s.opening_bs)]], [1])}
${H("Métodos de pago y arqueo")}${table(["Método", "Pagos", "Monto", "En Ref", "Esperado en caja", "Contado", "Diferencia"], methods, [1, 2, 3, 4, 5, 6])}
${H("Por área")}${table(["Área", "Pedidos", "Total"], (d.by_kind || []).map((x) => [he(x.kind), x.orders, "Ref " + fm(x.total)]), [1, 2])}
${H("Mejores vendedores (incentivos)")}${["day", "week", "month"].map((k) => {
    const rows = (d.tops && d.tops[k]) || [], t = { day: "Hoy", week: "Esta semana", month: "Este mes" }[k];
    return `<p style="margin:8px 0 2px;font-weight:700">${t}${rows[0] ? " · ganador: " + he(rows[0].name) : ""}</p>` +
      table(["#", "Vendedor", "Platos", "Pedidos", "Ventas"], rows.map((r, i) => [i + 1, he(r.name), fq(r.items), r.orders, "Ref " + fm(r.sales)]), [2, 3, 4]);
  }).join("")}
${H("Por mesera (quien abrió la mesa)")}${table(["Persona", "Pedidos", "Total"], (d.staff || []).map((x) => [he(x.name), x.orders, "Ref " + fm(x.total)]), [1, 2])}
${H("Por hora")}${table(["Hora", "Pedidos", "Total"], (d.hours || []).map((x) => [String(x.hour).padStart(2, "0") + ":00", x.orders, "Ref " + fm(x.total)]), [1, 2])}
${H("Platos vendidos")}${table(["Plato", "Cantidad", "Ventas"], (d.dishes || []).map((x) => [he(x.name + (x.variant ? " " + x.variant : "")), fq(x.qty), "Ref " + fm(x.amount)]), [1, 2])}
${H("Anulaciones de platos")}${table(["Pedido", "Plato", "Monto", "Quién", "Motivo"], (d.voids || []).map((x) => [he(x.order), fq(x.qty) + " " + he(x.item), "Ref " + fm(x.amount), he(x.by), he(x.reason)]), [2])}
${H("Descuentos")}${table(["Pedido", "Monto", "Quién", "Motivo"], (d.discounts || []).map((x) => [he(x.order), "Ref " + fm(x.amount), he(x.by), he(x.reason)]), [1])}
${H("Pedidos anulados")}${table(["Pedido", "Quién", "Motivo"], (d.cancelled || []).map((x) => [he(x.order), he(x.by), he(x.reason)]), [])}
${H("Detalle de cada pedido")}${table(["Pedido", "Hora", "Mesera / Caja", "Platos", "Pagos", "Total"], (d.orders || []).map((x) => [he(x.label) + (x.status === "anulada" ? " <i>(anulado)</i>" : ""),
    hh(x.opened_at) + " → " + hh(x.closed_at), he(x.waiter) + " / " + he(x.cashier), he(x.items), he(x.payments), "Ref " + fm(x.total)]), [5])}
${s.notes ? H("Notas de la cajera") + "<p>" + he(s.notes) + "</p>" : ""}
<p style="color:#777;font-size:12px;margin-top:24px">Enviado automáticamente por el sistema de ventas de Ichiraku. Precios con IVA incluido.</p></div>`;
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
  if (process.argv.includes("--prueba")) {
    const which = process.argv[process.argv.indexOf("--prueba") + 1] || "cocina";
    const p = cfg.printers[which];
    sendTo(p, render(`^PRUEBA ${which.toUpperCase()}\nPuente de impresion Ichiraku\n${new Date().toLocaleString("es-VE")}\n=\nSi lees esto, la impresora funciona.`))
      .then(() => { console.log("Enviado a " + which + " (" + (p.windows || p.ip) + ")"); process.exit(0); })
      .catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    // Una sola copia a la vez: si ya hay un puente corriendo, esta termina sin hacer nada.
    const lock = net.createServer();
    lock.once("error", () => { console.log("El puente ya está funcionando."); process.exit(0); });
    lock.listen(47811, "127.0.0.1", () => startBridge());
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

function startBridge() {
  serveApp();
  {
    const desc = (p) => (p ? (p.windows ? "USB «" + p.windows + "»" : p.ip) : "sin configurar");
    log(`Puente iniciado. Cocina ${desc(cfg.printers.cocina)} · Caja ${desc(cfg.printers.caja)} · Edo ${desc(cfg.printers.edo)}`);
    tick(); setInterval(tick, POLL_MS);
    updateRate(); setInterval(updateRate, (cfg.bcv_minutes || 30) * 60e3);
    sendReports(); setInterval(sendReports, 60e3);
  }
}
module.exports = { render, parseBcv, ascii, wrap, smtpSend, reportHtml };
