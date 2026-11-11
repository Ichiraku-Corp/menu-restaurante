// Recorre Gestión → WhatsApp en un navegador real: resultados por anuncio, ajustes del bot (datos de pago,
// horario) y zonas de delivery. Usa gestion-falso.js y le añade, solo aquí, las tablas wa_* en memoria.
// Uso: node pruebas-navegador/recorrido-gestion-whatsapp.js   (necesita Playwright y Chromium)
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});

let fallos = 0;
function ok(cond, msg) { if (cond) console.log("ok: " + msg); else { fallos++; console.log("FALLÓ: " + msg); } }

// Tablas wa_* con filtros eq y update/insert/delete que devuelven filas, como PostgREST.
const FAKE_WA = `
(function(){
  var client = window.supabase.createClient(), from0 = client.from, rpc0 = client.rpc;
  var W = window.__WA = { calls: [], tables: {
    wa_settings: [{ id: 1, bot_active: true, welcome: "¡Irasshaimase!", payment_info: "", delivery_min: 10, allow_cash: false,
      address_text: "San Diego – C.C. Metrópolis", maps_url: "https://maps.google.com/?cid=1", menu_url: "https://ichiraku-corp.github.io/menu-restaurante/",
      hours: { "0": ["11:30","20:30"], "1": ["12:30","21:30"], "2": ["11:30","20:30"], "3": ["11:30","20:30"], "4": ["11:30","20:30"], "5": ["11:30","20:30"], "6": ["11:30","20:30"] } }],
    wa_zones: [{ id: 1, name: "Centro", fee: 2, active: true, position: 1 }] } };
  var next = 10;
  function wb(t){
    var f = [], op = null, val = null, b = {};
    ["select","order","limit"].forEach(function(m){ b[m] = function(){ return b; }; });
    b.eq = function(c, v){ f.push([c, v]); return b; };
    b.maybeSingle = function(){ b._one = true; return b; };
    b.insert = function(v){ op = "insert"; val = v; return b; };
    b.update = function(v){ op = "update"; val = v; return b; };
    b.delete = function(){ op = "delete"; return b; };
    b.then = function(ok, ko){
      var rows = W.tables[t], hit = rows.filter(function(r){ return f.every(function(x){ return r[x[0]] === x[1]; }); }), out;
      if (op) W.calls.push({ table: t, op: op, value: val, where: f });
      if (op === "insert") { var r = Object.assign({ id: ++next, active: true }, val); rows.push(r); out = [r]; }
      else if (op === "update") { hit.forEach(function(r){ Object.assign(r, val); }); out = hit; }
      else if (op === "delete") { W.tables[t] = rows.filter(function(r){ return hit.indexOf(r) < 0; }); out = []; }
      else out = b._one ? (hit[0] || null) : hit;
      return Promise.resolve({ data: JSON.parse(JSON.stringify(out)), error: null }).then(ok, ko);
    };
    return b;
  }
  client.from = function(t){ return /^wa_/.test(t) ? wb(t) : from0(t); };
  client.rpc = function(n, a){
    if (n !== "wa_stats") return rpc0(n, a);
    W.calls.push({ rpc: n, args: a });
    return Promise.resolve({ data: { days: a.p_days, funnel: { conversaciones: 20, carritos: 9, pedidos: 8, aceptados: 6, rechazados: 1, reservas: 3, humano: 2 },
      ventas: 162, ticket: 27, anuncios: [{ anuncio: "Ramen 2x1 jueves", source_id: "ad_1", conversaciones: 12, pedidos: 5, ventas: 135 }], sin_anuncio: 8 }, error: null });
  };
})();`;

(async () => {
  await new Promise((r) => server.listen(8795, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8");
  await page.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "gestion-falso.js"), "utf8") + FAKE_WA }));
  await page.route("**/vendor/sentry-*/**", (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  const S = (fn) => page.evaluate(fn);

  try {
    await page.goto("http://localhost:8795/gestion.html");
    await page.waitForSelector("#app:not(.hidden)", { timeout: 8000 });
    await page.click('#tabs [data-tab="whatsapp"]');
    await page.waitForSelector("#waApp:not([hidden])", { timeout: 5000 });
    ok(true, "la pestaña WhatsApp abre en Gestión");
    await page.waitForSelector("#waKpis .kpi", { timeout: 5000 });
    const kpis = await page.textContent("#waKpis");
    ok(/Conversaciones nuevas\s*20/.test(kpis) && /Aceptados\s*6 \(30 %\)/.test(kpis), "resultados: conversaciones y aceptados con su porcentaje");
    ok(/Ramen 2x1 jueves/.test(await page.textContent("#waAds")) && /135/.test(await page.textContent("#waAds")), "ventas por anuncio");

    // Ajustes del bot
    ok((await page.inputValue("#waAddr")).includes("Metrópolis"), "muestra la dirección guardada");
    await page.fill("#waPay", "Pago móvil: Banco Prueba, 0414-0000000, J-00000000-0");
    await page.uncheck('#waHours [data-day="1"] [data-open]');
    await page.fill('#waHours [data-day="5"] [data-to]', "22:00");
    await page.click("#waSave"); await page.waitForTimeout(400);
    const st = await S(() => window.__WA.tables.wa_settings[0]);
    ok(st.payment_info.includes("Banco Prueba"), "guarda los datos de pago");
    ok(!st.hours["1"] && st.hours["5"][1] === "22:00" && st.hours["0"][0] === "11:30", "guarda el horario: lunes cerrado, viernes hasta las 22:00");
    await page.fill('#waHours [data-day="2"] [data-to]', "10:00"); await page.click("#waSave"); await page.waitForTimeout(300);
    ok((await S(() => window.__WA.tables.wa_settings[0].hours["2"][1])) === "20:30", "no deja guardar un cierre antes de la apertura");

    // Zonas
    await page.fill("#waZName", "Urb. La Esmeralda"); await page.fill("#waZFee", "3,5"); await page.click("#waZAdd"); await page.waitForTimeout(300);
    ok(await S(() => window.__WA.tables.wa_zones.some((z) => z.name === "Urb. La Esmeralda" && z.fee === 3.5)), "añade una zona con su precio (acepta coma)");
    await page.fill('#waZones [data-zone="1"] [data-f="fee"]', "2.5"); await page.press('#waZones [data-zone="1"] [data-f="fee"]', "Tab"); await page.waitForTimeout(300);
    ok(await S(() => window.__WA.tables.wa_zones.find((z) => z.id === 1).fee === 2.5), "cambia el precio de una zona");
    await page.uncheck('#waZones [data-zone="1"] [data-f="active"]'); await page.waitForTimeout(300);
    ok(await S(() => window.__WA.tables.wa_zones.find((z) => z.id === 1).active === false), "desactiva una zona sin borrarla");
    await page.click('#waZones [data-zdel="1"]'); await page.waitForTimeout(300);
    ok(await S(() => !window.__WA.tables.wa_zones.some((z) => z.id === 1)), "borra una zona");
    ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  } catch (e) {
    fallos++; console.log("FALLÓ: " + e.message);
  } finally {
    await browser.close(); server.close();
  }
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODO EL RECORRIDO DE WHATSAPP EN GESTIÓN PASÓ");
})();
