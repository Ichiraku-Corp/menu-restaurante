// Función «correo»: envía el cierre por SMTP (simulado) y lo marca enviado; sin claves no toca nada.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handler, smtpSend, subjectOf } from "../correo/index.ts";

// Servidor SMTP falso: responde lo justo y guarda lo que recibe
function fakeSmtp(fail?: string) {
  const enc = new TextEncoder(), dec = new TextDecoder(), outbox: Uint8Array[] = [enc.encode("220 hola\r\n")], got: string[] = [];
  let data = false;
  const conn = {
    read(p: Uint8Array) { const m = outbox.shift(); if (!m) return Promise.resolve(null); p.set(m); return Promise.resolve(m.length); },
    write(p: Uint8Array) {
      const line = dec.decode(p); got.push(line);
      let r = "250 ok";
      if (data) { data = false; r = "250 enviado"; }
      else if (line.startsWith("EHLO")) r = "250-hola\r\n250 AUTH LOGIN";
      else if (line.startsWith("AUTH") || got.length === 3) r = "334 dime";
      else if (got.length === 4) r = fail === "clave" ? "535 clave mala" : "235 dentro";
      else if (line.startsWith("DATA")) { data = true; r = "354 adelante"; }
      outbox.push(enc.encode(r + "\r\n")); return Promise.resolve(p.length);
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
