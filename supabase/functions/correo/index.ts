// Función «correo»: envía desde el servidor los cierres de caja y el resumen semanal (Ichiraku).
// La llama la base al guardar un cierre (supabase/correo.sql) y cada 5 minutos para reintentar.
// No recibe datos: busca en la base lo pendiente, lo aparta (pos_report_next) y lo envía por SMTP.
// Claves en Supabase → Edge Functions → Secrets: SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS,
// y opcionales SMTP_FROM, SMTP_FROM_NAME. Sin ellas no hace nada y la laptop sigue enviando.
// Se publica con verify_jwt = false: llamarla solo hace salir lo pendiente hacia los correos ya configurados.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { alertSubject, reportHtml, weekSubject } from "./reporte.js";

export type Smtp = { host: string; port: number; user: string; password: string; from: string; from_name: string };
type Conn = { read(p: Uint8Array): Promise<number | null>; write(p: Uint8Array): Promise<number>; close(): void };
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (s: string) => { let bin = ""; for (const b of enc.encode(s)) bin += String.fromCharCode(b); return btoa(bin); };

// SMTP con TLS directo (puerto 465). Supabase no deja salir por 25 ni 587.
export async function smtpSend(o: Smtp, to: string[], subject: string, html: string,
  connect: (host: string, port: number) => Promise<Conn> = (hostname, port) => Deno.connectTls({ hostname, port })) {
  const conn = await connect(o.host, o.port || 465);
  let buf = "", vencido = false;
  // Si el servidor de correo no termina en 60 s se corta, con un error que se entienda
  const timer = setTimeout(() => { vencido = true; try { conn.close(); } catch { /* ya cerrada */ } }, 60000);
  async function reply(ok: number[]) {
    for (;;) {
      const m = buf.match(/^(\d{3})([ -])(.*)\r?\n/m);
      if (m && buf.indexOf(m[0]) === 0) {
        buf = buf.slice(m[0].length);
        if (m[2] === " ") { if (!ok.includes(Number(m[1]))) throw new Error(`Correo: ${m[1]} ${m[3]}`); return; }
        continue;
      }
      const chunk = new Uint8Array(4096), n = await conn.read(chunk);
      if (n === null) throw new Error("El servidor de correo cortó la conexión");
      buf += dec.decode(chunk.subarray(0, n));
    }
  }
  // write() puede escribir solo una parte (un cierre pesa ~100 KB): se repite hasta mandarlo todo
  async function send(line: string) {
    const bytes = enc.encode(line + "\r\n");
    for (let off = 0; off < bytes.length;) {
      const n = await conn.write(bytes.subarray(off));
      if (!n) throw new Error("El servidor de correo no aceptó más datos");
      off += n;
    }
  }
  const msg = [
    `From: =?UTF-8?B?${b64(o.from_name)}?= <${o.from}>`, `To: ${to.join(", ")}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    b64(html).replace(/.{76}/g, "$&\r\n"), "",
  ].join("\r\n");
  try {
    await reply([220]);
    await send("EHLO ichiraku-servidor"); await reply([250]);
    await send("AUTH LOGIN"); await reply([334]);
    await send(b64(o.user)); await reply([334]);
    await send(b64(o.password)); await reply([235]);
    await send(`MAIL FROM:<${o.from}>`); await reply([250]);
    for (const r of to) { await send(`RCPT TO:<${r}>`); await reply([250, 251]); }
    await send("DATA"); await reply([354]);
    await send(msg + "\r\n."); await reply([250]);
    await send("QUIT");
  } catch (e) {
    throw vencido ? new Error("El servidor de correo no respondió en 60 s") : e;
  } finally { clearTimeout(timer); try { conn.close(); } catch { /* ya cerrada */ } }
}

const fm = (n: unknown) => Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hh = (t: string) => (t ? new Date(t).toLocaleString("es-VE", { timeZone: "America/Caracas", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "");
// deno-lint-ignore no-explicit-any
export function subjectOf(d: any) {
  if (d && d.kind === "semanal") return weekSubject(d);
  if (d && d.kind === "alerta") return alertSubject(d);
  const s = (d && d.session) || {};
  return `Cierre de caja ${hh(s.closed_at)} · Ref ${fm(d && d.totals && d.totals.total)}`;
}
export function smtpFromEnv(env: Record<string, string | undefined>): Smtp | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  return { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465), user: env.SMTP_USER, password: env.SMTP_PASS,
           from: env.SMTP_FROM || env.SMTP_USER, from_name: env.SMTP_FROM_NAME || "Ichiraku Ramen" };
}

// deno-lint-ignore no-explicit-any
export async function handler(_req: Request, env: Record<string, string | undefined> = Deno.env.toObject(), db?: any, send = smtpSend) {
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  const smtp = smtpFromEnv(env);
  // Sin claves no se aparta nada: la laptop sigue enviando como siempre
  if (!smtp) return json({ ok: false, error: "Faltan las claves del correo en Secrets (SMTP_HOST, SMTP_USER, SMTP_PASS)" });
  const sb = db ?? createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  try { await sb.rpc("pos_week_queue"); } catch { /* el lunes se vuelve a intentar */ }
  const { data, error } = await sb.rpc("pos_report_next", { p_min_age: 0 });
  if (error) return json({ ok: false, error: error.message }, 500);
  let enviados = 0, fallidos = 0;
  for (const r of data || []) {
    const to = String(r.recipients || "").split(/[,;\s]+/).filter((x: string) => /@/.test(x));
    try {
      if (!to.length) throw new Error("Sin destinatarios");
      await send(smtp, to, subjectOf(r.data), reportHtml(r.data));
      await sb.rpc("pos_report_done", { p_id: r.id, p_ok: true });
      enviados++;
    } catch (e) {
      await sb.rpc("pos_report_done", { p_id: r.id, p_ok: false, p_error: (e as Error).message });
      fallidos++;
    }
  }
  return json({ ok: true, enviados, fallidos });
}

if (import.meta.main) Deno.serve((req) => handler(req));
