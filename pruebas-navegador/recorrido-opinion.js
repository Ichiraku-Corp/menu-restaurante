// Página de opinión del recibo (opinion.html?t=…): estrellas, comentario, contacto opcional, Google con 4–5 estrellas
// y los avisos (enlace incompleto, inventado, vencido, sin conexión). Supabase se simula: nunca sale a internet.
// Uso: node pruebas-navegador/recorrido-opinion.js   (CAPTURAS=carpeta guarda capturas de teléfono)
"use strict";
// Espera sondeando con page.evaluate (page.waitForFunction necesita 'unsafe-eval' y la política de la página no lo permite)
async function esperar(pg, fn, arg, ms) {
  const fin = Date.now() + (ms || 5000);
  while (!(await pg.evaluate(fn, arg))) { if (Date.now() > fin) throw new Error("tiempo agotado esperando: " + String(fn).slice(0, 90)); await pg.waitForTimeout(100); }
}
const fs = require("fs"), path = require("path"), http = require("http"), { chromium } = require("playwright");
const ROOT = path.join(__dirname, ".."); let fallos = 0;
function ok(c, m) { if (c) console.log("ok: " + m); else { fallos++; console.log("FALLÓ: " + m); } }
const T = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
});
const CAP = process.env.CAPTURAS;

(async () => {
  await new Promise((r) => srv.listen(8806, r));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: CAP ? 2 : 1, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const err = [], csp = [];
  p.on("pageerror", (e) => err.push(e.message));
  p.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await p.route("**/config.js", (r) => r.fulfill({ contentType: "application/javascript", body:
    'window.MENU_CONFIG={SUPABASE_URL:"https://krjryvtnzgwwhanmbdrn.supabase.co",SUPABASE_ANON_KEY:"anon",RESTAURANT_NAME:"Ichiraku Ramen"};' }));
  // Supabase simulado: lo que responde cada enlace y lo que la página envió
  const enviados = []; let ver = {}, respuesta = null, caido = false;
  await p.route("https://krjryvtnzgwwhanmbdrn.supabase.co/**", (r) => {
    if (caido) return r.abort("internetdisconnected");
    const u = r.request().url(), body = JSON.parse(r.request().postData() || "{}");
    if (u.includes("/rpc/opinion_ver")) return r.fulfill({ contentType: "application/json", body: JSON.stringify(ver[body.p_token] || { estado: "no_existe" }) });
    if (u.includes("/rpc/opinion_enviar")) {
      enviados.push({ body, auth: r.request().headers().apikey });
      const res = typeof respuesta === "function" ? respuesta(body) : respuesta;
      return r.fulfill({ status: res.status || 200, contentType: "application/json", body: JSON.stringify(res.body) });
    }
    return r.fulfill({ status: 404, body: "" });
  });
  const abrir = async (t) => { await p.goto("http://localhost:8806/opinion.html" + (t === undefined ? "" : "?t=" + t)); await esperar(p, () => document.getElementById("cargando").hidden); };
  const visible = (id) => p.evaluate((x) => !document.getElementById(x).hidden, id);
  const texto = (id) => p.evaluate((x) => document.getElementById(x).textContent, id);
  const foto = async (n) => { if (CAP) await p.waitForTimeout(500); if (CAP) await p.screenshot({ path: path.join(CAP, n + ".png"), fullPage: true }); };

  try {
    // Avisos
    await abrir();
    ok(await visible("aviso") && (await texto("avisoT")) === "Este enlace no está completo", "sin el código del recibo, pide escanear de nuevo");
    await abrir("Inventado1234");
    ok((await texto("avisoT")) === "Este enlace no es válido", "un código inventado no abre nada");
    ver.Vencido12345 = { estado: "vencida" };
    await abrir("Vencido12345");
    ok((await texto("avisoT")) === "Este enlace ya venció" && /30 días/.test(await texto("avisoP")), "un enlace de más de 30 días dice que venció");
    caido = true; await abrir("Nuevo1234567");
    ok((await texto("avisoT")) === "Sin conexión" && await visible("reintentar"), "sin internet lo dice y ofrece intentar de nuevo");
    caido = false;
    ver.Nuevo1234567 = { estado: "nueva", fecha: "17/11/2026", rating: null, comment: "", contacto: false, cambios: 3, google: null };
    await p.click("#reintentar"); await esperar(p, () => !document.getElementById("form").hidden);
    ok((await texto("fecha")) === "Tu visita del 17/11/2026 · tarda 1 minuto", "«Intentar de nuevo» abre la opinión, con la fecha de la visita");
    ok(await p.evaluate(() => { const i = document.querySelector(".top img"); return i.complete && i.naturalWidth > 0; }), "se ve el logo de la carta arriba");

    // Calificar con 5 estrellas: Google
    await p.click("#enviar");
    ok(await visible("error") && /estrellas/.test(await texto("error")) && enviados.length === 0, "sin estrellas no envía y lo explica");
    await p.click('.star[data-n="5"]');
    ok((await texto("nivel")) === "¡Umai! Excelente" && (await p.$$eval(".star.on", (x) => x.length)) === 5 && await p.evaluate(() => document.getElementById("meter").style.width) === "100%",
      "5 estrellas: «¡Umai! Excelente» y la barra llena");
    ok(!(await visible("error")), "al elegir estrellas se quita el aviso");
    ok((await texto("comentarioL")) === "¿Qué fue lo que más te gustó?", "con buena nota pregunta qué le gustó");
    const c1 = "El ramen de cerdo, ¡buenísimo! Y la atención de Dango.";
    await p.fill("#comentario", c1);
    ok((await texto("cuenta")) === c1.length + " / 500", "cuenta las letras del comentario (" + (await texto("cuenta")) + ")");
    await foto("1-opinion-5-estrellas");
    respuesta = { body: { ok: true, cambios: 3, google: "https://g.page/r/ichiraku-prueba/review" } };
    await p.click("#enviar"); await esperar(p, () => !document.getElementById("gracias").hidden);
    const e1 = enviados[0] && enviados[0].body;
    ok(e1 && e1.p_token === "Nuevo1234567" && e1.p_rating === 5 && e1.p_comment === "El ramen de cerdo, ¡buenísimo! Y la atención de Dango." && e1.p_name === "" && e1.p_phone === "" && enviados[0].auth === "anon",
      "envía la calificación y el comentario con el código del recibo (sin datos de contacto)");
    ok((await texto("grS")) === "★★★★★" && /alegra mucho/.test(await texto("grP")) && (await texto("grT")) === "¡Arigatou!" && await visible("grX"), "da las gracias («¡Arigatou!») con sus 5 estrellas");
    ok(await visible("google") && await p.getAttribute("#googleA", "href") === "https://g.page/r/ichiraku-prueba/review" && await p.getAttribute("#googleA", "target") === "_blank",
      "con 5 estrellas lo invita a dejar la reseña en Google (en otra pestaña)");
    ok(await visible("cambiar"), "puede cambiar su opinión");
    await foto("2-gracias-google");

    // La cambia a 2 estrellas y deja su contacto: sin Google, avisa que el encargado ya lo sabe
    await p.click("#cambiar");
    ok((await p.$$eval(".star.on", (x) => x.length)) === 5 && (await p.inputValue("#comentario")).startsWith("El ramen"), "al cambiarla, aparece lo que había puesto");
    await p.click('.star[data-n="2"]');
    ok((await texto("comentarioL")) === "¿Qué salió mal? Lo vamos a arreglar", "con mala nota pregunta qué salió mal");
    await p.fill("#comentario", "La sopa llegó fría.");
    await p.click("#quiero");
    ok(await visible("datos") && await p.evaluate(() => document.activeElement.id) === "nombre", "«Quiero que me contacten» abre nombre y WhatsApp");
    await p.click("#enviar");
    ok(/nombre y tu WhatsApp/.test(await texto("error")), "si pidió que lo contacten, pide al menos el nombre o el WhatsApp");
    await p.fill("#nombre", "Ana"); await p.fill("#tel", "0414 12");
    await p.click("#enviar");
    ok(/Revisa el número/.test(await texto("error")) && enviados.length === 1, "un WhatsApp incompleto se avisa antes de enviar");
    await p.fill("#tel", "0414 123 4567");
    ok(!(await visible("error")), "al corregir el número se quita el aviso");
    await foto("3-opinion-2-estrellas-contacto");
    respuesta = { body: { ok: true, cambios: 2, google: null } };
    await p.click("#enviar"); await esperar(p, () => !document.getElementById("gracias").hidden);
    const e2 = enviados[1] && enviados[1].body;
    ok(e2 && e2.p_rating === 2 && e2.p_name === "Ana" && e2.p_phone === "0414 123 4567" && e2.p_comment === "La sopa llegó fría.", "envía la nueva nota, el comentario y el contacto");
    ok((await texto("grS")) === "★★☆☆☆" && /avisamos al encargado/.test(await texto("grP")) && !/WhatsApp/.test(await texto("grP")) && !(await visible("google")),
      "con 2 estrellas: «ya le avisamos al encargado», sin invitar a Google");
    ok((await texto("grT")) === "Lo sentimos mucho" && (await texto("grK")) === "ごめんなさい" && !(await visible("grX")),
      "y pide disculpas (sin el chiste de «misión cumplida»)");
    await foto("4-gracias-2-estrellas");

    // El servidor rechaza (ya la cambió 3 veces): se muestra su mensaje y lo escrito no se pierde
    await p.click("#cambiar"); await p.click('.star[data-n="3"]');
    respuesta = { status: 400, body: { message: "Ya cambiaste tu opinión 3 veces: quedó guardada la última" } };
    await p.click("#enviar"); await esperar(p, () => !document.getElementById("error").hidden);
    ok(/3 veces/.test(await texto("error")) && !(await p.isDisabled("#enviar")) && (await p.inputValue("#comentario")) === "La sopa llegó fría.",
      "si el servidor no la acepta, muestra el porqué y conserva lo escrito");
    caido = true; await p.click("#enviar"); await esperar(p, () => /Sin conexión/.test(document.getElementById("error").textContent));
    ok(true, "sin internet al enviar, lo dice y no borra nada");
    caido = false;

    // Con teclado: flechas para elegir estrellas
    await p.focus('.star[data-n="3"]'); await p.keyboard.press("ArrowRight");
    ok((await texto("nivel")) === "¡Bien!" && await p.evaluate(() => document.activeElement.dataset.n) === "4" &&
       await p.getAttribute('.star[data-n="4"]', "aria-checked") === "true", "con las flechas del teclado también se califica");

    // Ya respondida: al abrir de nuevo el enlace ve lo que puso; sin cambios disponibles no ofrece cambiarla
    ver.Listo1234567 = { estado: "respondida", fecha: "16/11/2026", rating: 4, comment: "Rico", contacto: true, cambios: 0, google: "https://g.page/r/ichiraku-prueba/review" };
    await abrir("Listo1234567");
    ok(await visible("gracias") && /^Ya nos diste tu opinión/.test(await texto("grP")) && (await texto("grS")) === "★★★★☆" && await visible("google") && !(await visible("cambiar")),
      "un enlace ya respondido muestra su nota, el botón de Google y, sin cambios disponibles, no ofrece cambiarla");
    // Un enlace de Google mal escrito en Gestión (que no empieza con https://) no se muestra
    ver.Raro12345678 = { estado: "respondida", fecha: "16/11/2026", rating: 5, comment: "", contacto: false, cambios: 1, google: "javascript:alert(1)" };
    await abrir("Raro12345678");
    ok(!(await visible("google")), "un enlace de Google que no es https:// no se muestra");

    ok(err.length === 0, "sin errores en la página" + (err.length ? ": " + err.join(" | ") : ""));
    ok(csp.length === 0, "nada bloqueado por la política de seguridad" + (csp.length ? ": " + csp.join(" | ") : ""));
  } catch (e) { fallos++; console.log("FALLÓ: " + e.message); }
  await b.close(); srv.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DE LA PÁGINA DE OPINIÓN PASARON");
})();
