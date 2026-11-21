// Función «correo»: envía el cierre por SMTP (simulado) y lo marca enviado; sin claves no toca nada.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handler, smtpSend, subjectOf } from "../correo/index.ts";

// Servidor SMTP falso: lee por líneas como uno real, responde lo justo y guarda lo que recibe.
// maxWrite simula una conexión que en cada write() acepta solo una parte de lo enviado.
function fakeSmtp(fail?: string, maxWrite = Infinity) {
  const enc = new TextEncoder(), dec = new TextDecoder(), outbox: Uint8Array[] = [enc.encode("220 hola\r\n")], got: string[] = [];
  let data = false, buf = "", lines = 0;
  const reply = (r: string) => outbox.push(enc.encode(r + "\r\n"));
  const conn = {
    read(p: Uint8Array) { const m = outbox.shift(); if (!m) return Promise.resolve(null); p.set(m); return Promise.resolve(m.length); },
    write(p: Uint8Array) {
      const n = Math.min(p.length, maxWrite);
      buf += dec.decode(p.subarray(0, n), { stream: true });
      for (;;) {
        if (data) { // el mensaje termina con una línea que solo tiene un punto
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) break;
          got.push(buf.slice(0, end + 5)); buf = buf.slice(end + 5); data = false; reply("250 enviado");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i < 0) break;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2); got.push(line + "\r\n"); lines++;
        if (line.startsWith("EHLO")) reply("250-hola\r\n250 AUTH LOGIN");
        else if (line.startsWith("AUTH") || lines === 3) reply("334 dime");
        else if (lines === 4) reply(fail === "clave" ? "535 clave mala" : "235 dentro");
        else if (line.startsWith("DATA")) { data = true; reply("354 adelante"); }
        else reply("250 ok");
      }
      return Promise.resolve(n);
    },
    close() {},
  };
  return { connect: () => Promise.resolve(conn), got };
}
const smtp = { host: "smtp.prueba", port: 465, user: "caja@prueba.test", password: "x", from: "caja@prueba.test", from_name: "Ichiraku Ramen" };
const cierre = { session: { closed_at: "2026-11-15T01:45:00Z", counted: {}, expected: {} }, totals: { total: 1234.5 }, notes: "hoy no es nuestro dia" };

Deno.test("envía el cierre completo por SMTP", async () => {
  const f = fakeSmtp();
  await smtpSend(smtp, ["dueno@prueba.test"], subjectOf(cierre), "<h1>Cierre</h1>", f.connect);
  const all = f.got.join("");
  assert(all.includes("RCPT TO:<dueno@prueba.test>"), "manda al destinatario");
  assert(all.includes("Subject: =?UTF-8?B?"), "asunto con acentos codificado");
  assertEquals(subjectOf(cierre), "Cierre de caja 14/11 21:45 · Ref 1.234,50");
});

Deno.test("un cierre grande sale completo aunque la conexión lo acepte por partes", async () => {
  // El cierre del 19/11 pesaba ~100 KB y write() solo mandó una parte: el servidor se quedó esperando el resto
  const f = fakeSmtp(undefined, 1000);
  const html = "<table>" + "<tr><td>Ramen Ichiraku · Señor</td><td>Ref 12,50</td></tr>".repeat(1500) + "</table>";
  await smtpSend(smtp, ["dueno@prueba.test"], subjectOf(cierre), html, f.connect);
  const msg = f.got.find((g) => g.includes("Content-Transfer-Encoding: base64"));
  assert(msg, "el servidor recibió el mensaje completo, con su punto final");
  const body = msg.slice(msg.indexOf("\r\n\r\n") + 4, msg.lastIndexOf("\r\n.\r\n")).replace(/\s+/g, "");
  assertEquals(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))), html, "llega todo el cierre, igualito");
  assert(f.got.at(-1)?.startsWith("QUIT"), "y se despide");
});

Deno.test("si la clave del correo es mala, avisa el error", async () => {
  const f = fakeSmtp("clave");
  let err = "";
  try { await smtpSend(smtp, ["a@b.c"], "x", "y", f.connect); } catch (e) { err = (e as Error).message; }
  assert(err.includes("535"), err);
});

Deno.test("aparta, envía y marca enviado; sin claves no aparta nada", async () => {
  const calls: { fn: string; args?: unknown }[] = [];
  const db = { rpc(fn: string, args?: unknown) {
    calls.push({ fn, args });
    if (fn === "pos_report_next") return Promise.resolve({ data: [{ id: 7, recipients: "dueno@prueba.test", data: cierre }], error: null });
    return Promise.resolve({ data: null, error: null });
  } };
  const sent: string[] = [];
  const env = { SMTP_HOST: "smtp.prueba", SMTP_USER: "caja@prueba.test", SMTP_PASS: "x" };
  const r = await (await handler(new Request("http://x"), env, db, (_o, to, subject) => { sent.push(to[0] + " · " + subject); return Promise.resolve(); })).json();
  assertEquals(r, { ok: true, enviados: 1, fallidos: 0 });
  assertEquals(sent, ["dueno@prueba.test · Cierre de caja 14/11 21:45 · Ref 1.234,50"]);
  assert(calls.some((c) => c.fn === "pos_report_done" && (c.args as { p_ok: boolean }).p_ok), "lo marca enviado");
  calls.length = 0;
  const r2 = await (await handler(new Request("http://x"), {}, db)).json();
  assertEquals(r2.ok, false);
  assertEquals(calls.length, 0, "sin claves no aparta reportes (la laptop sigue enviando)");
});

Deno.test("las alertas llegan con su asunto y sus líneas", async () => {
  const { reportHtml } = await import("../correo/reporte.js");
  const d = { kind: "alerta", clave: "cierre-9", titulo: "El cierre de caja no cuadra: faltan Ref 25,00", at: "2026-11-15T23:00:00Z",
              lineas: ["Cerró: Cajera · 15/11 19:00", "Diferencia por método: Efectivo $: falta $ 25,00", "Nota del cierre: <sin nota>"] };
  assertEquals(subjectOf(d), "⚠ El cierre de caja no cuadra: faltan Ref 25,00");
  const html = reportHtml(d);
  assert(html.includes("Diferencia por método: Efectivo $: falta $ 25,00") && html.includes("&lt;sin nota&gt;") && !html.includes("<sin nota>"), "líneas escapadas");
});

Deno.test("el resumen del lunes trae los indicadores de la semana contra la anterior", async () => {
  const { reportHtml } = await import("../correo/reporte.js");
  const per = (v: number, ins: number, cf: number) => ({
    ventas: { total: v, ticket: v / 100, canales: { mesa: { ventas: v * 0.7 }, llevar: { ventas: v * 0.3 } } },
    costos: { insumos_pct: ins, cobertura_pct: 90, nomina_pct: 15, gastos: 300, queda: v * 0.3, queda_pct: 35 },
    servicio: { cocina_min: 14, mesa_min: 45, calificacion: 4.6, calificaron: 12 },
    control: { descuentos: 20, anulados: 3, cierres: 7, cierres_fuera: cf },
  });
  const sem = { kind: "semanal", from: "2026-11-16", to: "2026-11-22", totals: { total: 3500 }, kpis: { dias: 7, actual: per(3500, 41, 1), anterior: per(3200, 43, 2) } };
  const html = reportHtml(sem);
  assert(html.includes("Indicadores de la semana") && html.includes("Esta semana") && html.includes("Semana anterior"), "sección de indicadores");
  assert(/#2f7d4f">▲ 9 %/.test(html), "ventas +9 %, en verde");
  assert(/#2f7d4f">▼ 2,0 pts/.test(html), "insumos bajan 2 puntos: bueno, en verde");
  assert(html.includes("70 % · 30 % · 0 %"), "mezcla mesa · para llevar · delivery");
  assert(html.includes("1 de 7"), "cierres que no cuadran");
  assert(!reportHtml({ kind: "semanal", from: "2026-11-16", to: "2026-11-22", totals: { total: 1 } }).includes("Indicadores de la semana"), "sin indicadores, el resumen sale igual");
});
