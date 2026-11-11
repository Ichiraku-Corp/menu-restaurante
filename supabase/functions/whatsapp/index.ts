// WhatsApp de Ichiraku Ramen (Supabase Edge Function). Plan: docs/whatsapp-ventas.md
//
// Meta llama aquí con cada mensaje de un cliente (webhook). La función:
//   1) comprueba la firma de Meta (X-Hub-Signature-256) y descarta lo que no venga de Meta,
//   2) guarda el mensaje (wa_ingest), y si el bot está activo en esa conversación,
//   3) responde con botones y listas: carta, pedido paso a paso, reservas, ubicación, hablar con una persona,
//   4) envía los avisos pendientes de wa_outbox (pedido aceptado, rechazado, en camino…).
// La caja también llama aquí con su sesión ({"action": "flush"}) para que sus avisos salgan al momento.
//
// Precios, agotados, mínimos y reglas viven en la base de datos (supabase/whatsapp.sql): aquí solo se conversa.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   WHATSAPP_TOKEN            token permanente (usuario del sistema) con permiso whatsapp_business_messaging
//   WHATSAPP_PHONE_NUMBER_ID  id del número (WhatsApp → Configuración de la API)
//   WHATSAPP_APP_SECRET       secreto de la app (Configuración de la app → Básica)
//   WHATSAPP_VERIFY_TOKEN     contraseña inventada que también se escribe en Meta al configurar el webhook
//   WHATSAPP_API_VERSION      opcional, por defecto v23.0
// Supabase ya define SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
// Publicar SIN verificación de JWT (Meta no manda sesión de Supabase; la seguridad es la firma):
//   supabase functions deploy whatsapp --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const TZ_OFFSET_H = -4; // Venezuela, sin horario de verano
const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DAYS_LONG = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const PAY_LABELS: Record<string, string> = {
  pago_movil: "Pago móvil", zelle: "Zelle", binance: "Binance", paypal: "PayPal", efectivo: "Efectivo al recibir",
};

// ---------------------------------------------------------------- Tipos
// deno-lint-ignore no-explicit-any
type Json = any;
export type RpcResult = { data: Json; error: { message: string } | null };
export interface Db { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult> }
export interface Wa {
  send(to: string, payload: Record<string, unknown>): Promise<{ id?: string; error?: string }>;
  markRead(messageId: string): Promise<void>;
}
export interface InMsg {
  from: string; name: string; id: string; type: string;
  text?: string; replyId?: string; replyTitle?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  imageId?: string; referral?: Json;
}
export interface Status { id: string; status: string; error?: string }
type Payload = Record<string, unknown>;

// ---------------------------------------------------------------- Firma de Meta
function hex(buf: ArrayBuffer) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

export async function verifySignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const got = header.slice(7).toLowerCase();
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);   // comparación en tiempo constante
  return diff === 0;
}

// ---------------------------------------------------------------- Lectura del webhook
export function parseWebhook(body: Json): { messages: InMsg[]; statuses: Status[] } {
  const messages: InMsg[] = [], statuses: Status[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const v = change.value ?? {};
      const names: Record<string, string> = {};
      for (const c of v.contacts ?? []) names[c.wa_id] = c.profile?.name ?? "";
      for (const m of v.messages ?? []) {
        const msg: InMsg = { from: String(m.from), name: names[m.from] ?? "", id: String(m.id), type: String(m.type), referral: m.referral };
        if (m.type === "text") msg.text = m.text?.body ?? "";
        else if (m.type === "interactive") {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply ?? {};
          msg.replyId = r.id; msg.replyTitle = r.title;
        } else if (m.type === "button") { msg.replyId = m.button?.payload; msg.replyTitle = m.button?.text; msg.text = m.button?.text; }
        else if (m.type === "location") msg.location = m.location;
        else if (m.type === "image") { msg.imageId = m.image?.id; msg.text = m.image?.caption ?? ""; }
        messages.push(msg);
      }
      for (const s of v.statuses ?? []) statuses.push({ id: String(s.id), status: String(s.status), error: s.errors?.[0]?.title });
    }
  }
  return { messages, statuses };
}

// ---------------------------------------------------------------- Mensajes de WhatsApp
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const text = (body: string): Payload => ({ type: "text", text: { body: cut(body, 4096), preview_url: true } });
export const buttons = (body: string, opts: { id: string; title: string }[]): Payload => ({
  type: "interactive",
  interactive: { type: "button", body: { text: cut(body, 1024) },
    action: { buttons: opts.slice(0, 3).map((o) => ({ type: "reply", reply: { id: o.id, title: cut(o.title, 20) } })) } },
});
export const list = (body: string, label: string, rows: { id: string; title: string; description?: string }[]): Payload => ({
  type: "interactive",
  interactive: { type: "list", body: { text: cut(body, 4096) },
    action: { button: cut(label, 20), sections: [{ title: "Opciones", rows: rows.slice(0, 10).map((r) => ({
      id: r.id, title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) })) }] } },
});
const location = (lat: number, lng: number, name: string, address: string): Payload =>
  ({ type: "location", location: { latitude: lat, longitude: lng, name, address } });

function payloadText(p: Payload): string {
  const i = p.interactive as Json;
  if (p.type === "text") return (p.text as Json).body;
  if (i) return i.body?.text ?? "";
  if (p.type === "location") return "📍 " + ((p.location as Json).address ?? "");
  if (p.type === "template") return "[plantilla] " + (p.template as Json).name;
  return "";
}

// ---------------------------------------------------------------- Dinero y horas (Venezuela)
export const ref = (n: number) => "Ref " + Number(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bs = (n: number) => "Bs " + Number(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (n: number) => String(n).padStart(2, "0");
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Fecha y hora local de Caracas para un instante. */
function local(at: Date) {
  const d = new Date(at.getTime() + TZ_OFFSET_H * 3600_000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const dateKey = (l: { y: number; mo: number; d: number }) => `${l.y}-${pad(l.mo)}-${pad(l.d)}`;
const isoAt = (date: string, min: number) => `${date}T${hhmm(min)}:00-04:00`;

export type Day = { date: string; dow: number; d: number; mo: number; open: number; close: number; today: boolean };

/** Días abiertos desde hoy (hasta `count`), con su horario. */
export function openDays(hours: Record<string, [string, string]>, now: Date, count = 7): Day[] {
  const out: Day[] = [];
  for (let i = 0; i < 14 && out.length < count; i++) {
    const l = local(new Date(now.getTime() + i * 86400_000));
    const h = hours[String(l.dow)];
    if (!h) continue;
    const open = minutes(h[0]), close = minutes(h[1]);
    if (i === 0 && local(now).min >= close - 60) continue;   // hoy ya cerró (o está por cerrar)
    out.push({ date: dateKey(l), dow: l.dow, d: l.d, mo: l.mo, open, close, today: i === 0 });
  }
  return out;
}

/** Horas para elegir en un día: cada `step` minutos, desde que abre (o desde ya, si es hoy) hasta `lastBefore` antes de cerrar. */
export function slotsFor(day: Day, now: Date, step = 60, lastBefore = 60) {
  let start = day.open;
  if (day.today) start = Math.max(start, Math.ceil((local(now).min + 30) / 30) * 30);
  const out: { iso: string; label: string }[] = [];
  for (let m = start; m <= day.close - lastBefore && out.length < 10; m += step) out.push({ iso: isoAt(day.date, m), label: hhmm(m) });
  return out;
}

const dayLabel = (x: Day) => (x.today ? "Hoy" : `${DAYS[x.dow]} ${x.d}/${x.mo}`);

export function hoursText(hours: Record<string, [string, string]>): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const parts: string[] = [];
  let i = 0;
  while (i < order.length) {
    const h = hours[String(order[i])];
    let j = i;
    while (j + 1 < order.length && JSON.stringify(hours[String(order[j + 1])]) === JSON.stringify(h)) j++;
    const days = i === j ? DAYS_LONG[order[i]] : `${DAYS_LONG[order[i]]} a ${DAYS_LONG[order[j]].toLowerCase()}`;
    parts.push(`${days}: ${h ? `${h[0]} a ${h[1]}` : "cerrado"}`);
    i = j + 1;
  }
  return parts.join("\n");
}

function orderSummary(o: Json): string {
  const lines = (o.items as Json[]).map((x) =>
    `• ${x.qty} × ${x.name}${x.variant ? ` (${x.variant})` : ""}${x.option ? ` ${x.option}` : ""} — ${ref(x.qty * x.unit_price)}` +
    (x.notes ? `\n   _${x.notes}_` : ""));
  const extra = o.kind === "delivery" && o.zone ? `\n🛵 Delivery ${o.zone}: ${ref(o.delivery_fee)}` : "";
  return `${lines.join("\n")}${extra}\n*Total: ${ref(o.total)}*  (${bs(o.total_bs)})`;
}

const fmtWhen = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString("es-VE", { timeZone: "America/Caracas", ...opts });

class UserError extends Error {}
const INTERNAL_ERROR = /permission denied|does not exist|syntax error|violates|null value|invalid input|column|relation|function|fetch failed|timeout|JWT|connection/i;

// ---------------------------------------------------------------- Conversación
export class Bot {
  constructor(private db: Db, private wa: Wa, private ctx: Json, private now = new Date()) {}

  private async call(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) {
      // Las reglas del negocio llegan en español claro y se le muestran al cliente; un fallo interno, no.
      if (INTERNAL_ERROR.test(error.message)) {
        console.error(fn, error.message);
        throw new UserError("Tuvimos un problema técnico. Intenta de nuevo en un momento o toca «Hablar con una persona» 🙏");
      }
      throw new UserError(error.message);
    }
    return data;
  }

  private async say(conv: number, to: string, p: Payload) {
    const r = await this.wa.send(to, p);
    await this.db.rpc("wa_log_out", { p_conv: conv, p_wa_id: r.id ?? "", p_type: String(p.type), p_body: payloadText(p),
      p_payload: p, p_sent_by: "bot", p_ok: !r.error, p_error: r.error ?? "" });
  }

  private menu(greet: string): Payload {
    return list(`${greet}\n\n¿En qué te ayudamos?`, "Ver opciones", [
      { id: "menu:pedir", title: "🍜 Hacer un pedido", description: "Para retirar o delivery" },
      { id: "menu:carta", title: "📖 Ver la carta", description: "Platos, fotos y precios" },
      { id: "menu:reservar", title: "📅 Reservar mesa" },
      { id: "menu:ubicacion", title: "📍 Ubicación y horario" },
      { id: "menu:humano", title: "🙋 Hablar con una persona" },
    ]);
  }

  async handle(msg: InMsg): Promise<void> {
    const r = await this.call("wa_ingest", { p_phone: msg.from, p_name: msg.name, p_wa_id: msg.id, p_type: msg.type,
      p_body: msg.text || msg.replyTitle || (msg.location ? "📍 Ubicación" : msg.imageId ? "🖼️ Imagen" : `[${msg.type}]`),
      p_payload: msg.replyId || msg.location || msg.imageId ? { reply_id: msg.replyId, location: msg.location, image_id: msg.imageId } : null,
      p_referral: msg.referral ?? null });
    if (r.duplicate) return;
    await this.wa.markRead(msg.id).catch(() => {});
    if (!this.ctx.bot_active || r.bot_paused) return;   // una persona atiende, o el bot está apagado
    const conv = Number(r.conversation_id), to = msg.from;
    try {
      await this.route(conv, to, msg);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      // Los errores de la base de datos ya vienen en español claro («El pedido mínimo para delivery es Ref 10»).
      await this.say(conv, to, text("⚠️ " + e.message));
      const st = await this.call("wa_state", { p_conv: conv });
      if (st?.draft) await this.next(conv, to, st);
    }
  }

  private async route(conv: number, to: string, msg: InMsg) {
    const st = await this.call("wa_state", { p_conv: conv });
    const id = msg.replyId ?? "";
    const t = (msg.text ?? "").trim();

    // 1) Código de la carta: «Hola, quiero hacer el pedido K7M2P» (o solo el código)
    const code = t.match(/pedido\s*#?\s*([A-Za-z0-9]{5})\b/i)?.[1] ?? t.match(/^([A-Za-z0-9]{5})$/)?.[1];
    if (code && (/pedido/i.test(t) || /[0-9]/.test(code))) {
      const o = await this.call("wa_order_from_cart", { p_conv: conv, p_code: code });
      await this.call("wa_set_step", { p_conv: conv, p_step: "", p_data: {} });
      await this.say(conv, to, text(`🍜 ¡Recibimos tu pedido!\n\n${orderSummary(o)}`));
      return this.next(conv, to);
    }

    // 2) Botones y listas
    if (id.startsWith("menu:")) return this.menuChoice(conv, to, id.slice(5), st);
    if (id.startsWith("res:")) return this.reservation(conv, to, id, st);
    if (id.startsWith("kind:")) { await this.set(conv, { kind: id.slice(5) }); return this.next(conv, to); }
    if (id.startsWith("zone:")) { await this.set(conv, { zone_id: Number(id.slice(5)) }); return this.next(conv, to); }
    if (id.startsWith("slot:")) { await this.set(conv, { scheduled_for: id.slice(5) }); return this.next(conv, to); }
    if (id.startsWith("pay:")) { await this.set(conv, { payment_method: id.slice(4) }); return this.next(conv, to); }
    if (id === "name:profile") { await this.set(conv, { customer_name: st.name }); return this.next(conv, to); }
    if (id === "doc:omitir") {
      await this.call("wa_set_step", { p_conv: conv, p_step: "", p_data: { ...st.step_data, doc_skipped: true } });
      return this.next(conv, to);
    }
    if (id === "order:confirm") return this.submit(conv, to);
    if (id === "order:cancel") {
      await this.call("wa_order_cancel", { p_conv: conv });
      return this.say(conv, to, text("Listo, cancelamos el pedido. Escríbenos cuando quieras 🍜"));
    }

    // 3) Respuesta libre a la última pregunta del bot
    if (msg.location && st.draft?.kind === "delivery") {
      await this.set(conv, { location: { latitude: msg.location.latitude, longitude: msg.location.longitude },
        ...(msg.location.address ? { address: msg.location.address } : {}) });
      return this.next(conv, to);
    }
    if (msg.imageId && st.draft && st.step === "pago_ref") { await this.set(conv, { payment_media: msg.imageId }); return this.next(conv, to); }
    if (t && st.draft) {
      if (st.step === "direccion") { await this.set(conv, { address: t }); return this.next(conv, to); }
      if (st.step === "nombre") { await this.set(conv, { customer_name: t }); return this.next(conv, to); }
      if (st.step === "cedula") {
        if (!/^[VEJGP]?[-\s.]*\d[\d.\s]{4,}$/i.test(t)) return this.say(conv, to, text("Escribe solo el número de cédula o RIF, por ejemplo V-12345678 🙏"));
        await this.set(conv, { doc_id: t }); return this.next(conv, to);
      }
      if (st.step === "pago_ref") { await this.set(conv, { payment_ref: t }); return this.next(conv, to); }
    }
    if (t && st.step === "res_personas") {
      const n = parseInt(t, 10);
      if (n > 0) return this.reservation(conv, to, `res:people:${n}`, st);
    }

    // 4) Con un pedido a medias, se lo recordamos; si no, menú principal.
    if (st.draft) {
      await this.say(conv, to, text("Seguimos con tu pedido 👇 (si prefieres, toca *Cancelar* al final)"));
      return this.next(conv, to, st);
    }
    const first = (msg.name || "").split(" ")[0];
    const closed = this.ctx.open_now ? "" : " Ahora estamos cerrados, pero igual tomamos pedidos y reservas para cuando abramos.";
    return this.say(conv, to, this.menu(`¡Irasshaimase${first ? `, ${first}` : ""}! 🍜${closed}`));
  }

  private set(conv: number, fields: Record<string, unknown>) { return this.call("wa_order_set", { p_conv: conv, p_fields: fields }); }

  /** Pregunta lo primero que falte del pedido en borrador. */
  private async next(conv: number, to: string, state?: Json): Promise<void> {
    const st = state ?? await this.call("wa_state", { p_conv: conv });
    const o = st?.draft;
    if (!o) return;
    const step = (s: string) => this.call("wa_set_step", { p_conv: conv, p_step: s });

    if (!this.ctx.open_now && !o.scheduled_for) {
      const day = openDays(this.ctx.hours, this.now, 1)[0];
      const slots = day ? slotsFor(day, this.now, 30, 30) : [];
      if (day && slots.length) {
        await step("hora");
        return this.say(conv, to, list(`Ahora estamos cerrados 🌙 Te lo preparamos para ${day.today ? "hoy" : `el ${DAYS_LONG[day.dow].toLowerCase()} ${day.d}/${day.mo}`}. ¿A qué hora?`,
          "Elegir hora", slots.map((s) => ({ id: "slot:" + s.iso, title: s.label }))));
      }
    }
    if (!o.kind) {
      await step("tipo");
      return this.say(conv, to, buttons("¿Cómo lo quieres?", [{ id: "kind:llevar", title: "🥡 Retiro en local" }, { id: "kind:delivery", title: "🛵 Delivery" }]));
    }
    if (o.kind === "delivery" && !o.zone) {
      const zones = (this.ctx.zones ?? []) as Json[];
      if (!zones.length) {
        await this.set(conv, { kind: "llevar" });
        await this.say(conv, to, text("Por ahora no tenemos delivery por WhatsApp 🙏 Te lo dejamos para retirar en el local."));
        return this.next(conv, to);
      }
      await step("zona");
      return this.say(conv, to, list(`¿A qué zona va el delivery? (pedido mínimo ${ref(this.ctx.delivery_min)} sin el envío)`, "Elegir zona",
        zones.map((z) => ({ id: "zone:" + z.id, title: z.name, description: ref(z.fee) }))));
    }
    if (o.kind === "delivery" && (o.address ?? "").length < 5 && !o.location) {
      await step("direccion");
      return this.say(conv, to, text("📍 Envía la *dirección* con un punto de referencia, o comparte tu *ubicación* (📎 → Ubicación)."));
    }
    if ((o.customer_name ?? "").length < 2) {
      await step("nombre");
      if (st.name) return this.say(conv, to, buttons("¿A nombre de quién va el pedido? Toca el botón o escribe otro nombre.", [{ id: "name:profile", title: st.name }]));
      return this.say(conv, to, text("¿A nombre de quién va el pedido?"));
    }
    if (!o.doc_id && !st.step_data?.doc_skipped) {
      await step("cedula");
      return this.say(conv, to, buttons("¿Tu cédula o RIF? Así guardamos tu historial y tus beneficios. Escríbela o toca Omitir.", [{ id: "doc:omitir", title: "Omitir" }]));
    }
    if (!o.payment_method) {
      await step("pago_metodo");
      const methods = ["pago_movil", "zelle", "binance", "paypal", ...(this.ctx.allow_cash ? ["efectivo"] : [])];
      return this.say(conv, to, list(`Total a pagar: *${ref(o.total)}* (${bs(o.total_bs)} a tasa BCV).\n¿Cómo vas a pagar?`, "Elegir pago",
        methods.map((m) => ({ id: "pay:" + m, title: PAY_LABELS[m] }))));
    }
    if (o.payment_method !== "efectivo" && !o.payment_ref && !o.has_payment_media) {
      await step("pago_ref");
      const info = String(this.ctx.payment_info ?? "").trim();
      return this.say(conv, to, text(`💳 *${PAY_LABELS[o.payment_method]}*\nTotal: *${ref(o.total)}* (${bs(o.total_bs)})\n\n` +
        (info ? `${info}\n\n` : "") + "Cuando pagues, envía aquí la *referencia* o la *captura* del pago."));
    }
    await step("confirmar");
    const where = o.kind === "delivery" ? `🛵 Delivery a: ${o.address || "tu ubicación"}` : "🥡 Retiro en el local";
    const when = o.scheduled_for ? `\n🕒 Para: ${fmtWhen(o.scheduled_for, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "";
    return this.say(conv, to, buttons(`Revisa tu pedido:\n\n${orderSummary(o)}\n\n${where}${when}\n👤 ${o.customer_name}\n💳 ${PAY_LABELS[o.payment_method]}${o.payment_ref ? ` · ref ${o.payment_ref}` : ""}`,
      [{ id: "order:confirm", title: "✅ Confirmar" }, { id: "order:cancel", title: "Cancelar" }]));
  }

  private async submit(conv: number, to: string) {
    const o = await this.call("wa_order_submit", { p_conv: conv });
    await this.call("wa_set_step", { p_conv: conv, p_step: "", p_data: {} });
    await this.say(conv, to, text("✅ ¡Listo! Recibimos tu pedido. Caja está verificando el pago y te confirmamos en unos minutos 🙏"));
    if (o.kind === "llevar") await this.sendLocation(conv, to);
  }

  private async sendLocation(conv: number, to: string) {
    const c = this.ctx;
    if (c.lat != null && c.lng != null) await this.say(conv, to, location(Number(c.lat), Number(c.lng), "Ichiraku Ramen", c.address ?? ""));
  }

  private async menuChoice(conv: number, to: string, choice: string, st: Json): Promise<void> {
    const c = this.ctx;
    if (choice === "pedir" || choice === "carta") {
      return this.say(conv, to, text((choice === "pedir"
        ? "🍜 Arma tu pedido en la carta y, al final, toca *Pedir por WhatsApp*. Te llega aquí con todo listo:\n"
        : "📖 Esta es nuestra carta:\n") + c.menu_url));
    }
    if (choice === "ubicacion") {
      await this.say(conv, to, text(`📍 ${c.address}\n${c.maps_url ?? ""}\n\n🕒 Horario:\n${hoursText(c.hours)}`));
      return this.sendLocation(conv, to);
    }
    if (choice === "humano") {
      await this.call("wa_handoff", { p_conv: conv });
      return this.say(conv, to, text(c.open_now ? "🙋 Listo, una persona del equipo te responde en un momento."
        : `🙋 Anotado. Ahora estamos cerrados; te respondemos apenas abramos.\n\n🕒 ${hoursText(c.hours)}`));
    }
    if (choice === "reservar") return this.reservation(conv, to, "res:start", st);
  }

  private async reservation(conv: number, to: string, id: string, st: Json): Promise<void> {
    const data = { ...(st.step_data ?? {}) };
    if (id === "res:start") {
      const days = openDays(this.ctx.hours, this.now, 7);
      await this.call("wa_set_step", { p_conv: conv, p_step: "res_dia", p_data: {} });
      return this.say(conv, to, list("📅 ¿Para qué día es la reserva?", "Elegir día", days.map((d) => ({ id: "res:day:" + d.date, title: dayLabel(d) }))));
    }
    if (id.startsWith("res:day:")) {
      const day = openDays(this.ctx.hours, this.now, 7).find((d) => d.date === id.slice(8));
      if (!day) return this.reservation(conv, to, "res:start", st);
      const slots = slotsFor(day, this.now, 60, 60);
      if (!slots.length) return this.say(conv, to, text("Ese día ya no quedan horas. Elige otro 🙏"));
      await this.call("wa_set_step", { p_conv: conv, p_step: "res_hora", p_data: { ...data, res_day: day.date } });
      return this.say(conv, to, list(`${dayLabel(day)}: ¿a qué hora?`, "Elegir hora", slots.map((s) => ({ id: "res:time:" + s.iso, title: s.label }))));
    }
    if (id.startsWith("res:time:")) {
      await this.call("wa_set_step", { p_conv: conv, p_step: "res_personas", p_data: { ...data, res_when: id.slice(9) } });
      const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `res:people:${n}`, title: `${n} persona${n > 1 ? "s" : ""}` }));
      return this.say(conv, to, list("¿Cuántas personas?", "Elegir", [...rows, { id: "res:people:mas", title: "9 o más" }]));
    }
    if (id === "res:people:mas") return this.say(conv, to, text("¿Cuántas personas serán? Escribe el número."));
    if (id.startsWith("res:people:")) {
      if (!data.res_when) return this.reservation(conv, to, "res:start", st);
      const people = parseInt(id.slice(11), 10);
      await this.call("wa_reservation_create", { p_conv: conv, p_name: st.customer_name || st.name || "Cliente", p_people: people,
        p_when: data.res_when, p_area: "", p_notes: "" });
      await this.call("wa_set_step", { p_conv: conv, p_step: "", p_data: {} });
      const when = fmtWhen(data.res_when, { weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
      await this.say(conv, to, text(`📅 ¡Anotado! Reserva para *${people}* el *${when}*.\nCaja te la confirma por aquí en breve 🙏`));
      return this.sendLocation(conv, to);
    }
  }
}

// ---------------------------------------------------------------- Cola de avisos (wa_outbox)
export async function flushOutbox(db: Db, wa: Wa): Promise<{ sent: number; failed: number }> {
  const { data, error } = await db.rpc("wa_outbox_next", { p_limit: 20 });
  if (error) throw new Error(error.message);
  let sent = 0, failed = 0;
  for (const m of (data ?? []) as Json[]) {
    let r: { id?: string; error?: string };
    if (m.kind === "plantilla") {
      const params = (m.params ?? []) as string[];
      r = await wa.send(m.phone, { type: "template", template: { name: m.template, language: { code: "es" },
        components: params.length ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p) })) }] : [] } });
    } else if (m.in_window) {
      r = await wa.send(m.phone, text(m.body));
    } else {
      r = { error: "Pasaron más de 24 h desde el último mensaje del cliente: hace falta una plantilla aprobada" };
    }
    await db.rpc("wa_outbox_done", { p_id: m.id, p_ok: !r.error, p_wa_id: r.id ?? "", p_error: r.error ?? "" });
    if (r.error) failed++; else sent++;
  }
  return { sent, failed };
}

// ---------------------------------------------------------------- Cliente de la API de Meta
export function metaClient(env: Record<string, string>): Wa {
  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION || "v23.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const post = async (body: Record<string, unknown>): Promise<{ id?: string; error?: string }> => {
    try {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", ...body }) });
      const j = await res.json().catch(() => ({}));
      return res.ok ? { id: j.messages?.[0]?.id } : { error: String(j.error?.message ?? `HTTP ${res.status}`) };
    } catch (e) {
      return { error: String((e as Error).message ?? e) };
    }
  };
  return {
    send: (to, payload) => post({ recipient_type: "individual", to, ...payload }),
    markRead: async (id) => { await post({ status: "read", message_id: id }); },
  };
}

/** Descarga una imagen que mandó el cliente (dos pasos: Meta da una URL temporal y luego se baja con el token). */
export async function fetchMedia(env: Record<string, string>, id: string, f: typeof fetch = fetch): Promise<Response | null> {
  const auth = { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` };
  try {
    const meta = await f(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION || "v23.0"}/${id}`, { headers: auth });
    if (!meta.ok) { await meta.body?.cancel(); return null; }
    const { url, mime_type } = await meta.json();
    if (!url || !/^image\//.test(String(mime_type))) return null;
    const img = await f(url, { headers: auth });
    if (!img.ok) { await img.body?.cancel(); return null; }
    return new Response(img.body, { status: 200, headers: { ...CORS, "Content-Type": String(mime_type), "Cache-Control": "private, max-age=600" } });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Entrada HTTP
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export async function handler(req: Request, env = Deno.env.toObject(), deps?: { db?: Db; wa?: Wa; now?: Date; staffOk?: boolean; fetch?: typeof fetch }): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  // Meta comprueba el webhook al configurarlo.
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && !!env.WHATSAPP_VERIFY_TOKEN &&
      url.searchParams.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const db: Db = deps?.db ?? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const wa = deps?.wa ?? metaClient(env);
  const raw = await req.text();

  // Mensajes de Meta (firmados)
  const sig = req.headers.get("x-hub-signature-256");
  if (sig !== null) {
    if (!await verifySignature(raw, sig, env.WHATSAPP_APP_SECRET ?? "")) return new Response("Firma no válida", { status: 401 });
    let body: Json;
    try { body = JSON.parse(raw); } catch { return new Response("ok", { status: 200 }); }
    const { messages, statuses } = parseWebhook(body);
    for (const s of statuses) await db.rpc("wa_status", { p_wa_id: s.id, p_status: s.status, p_error: s.error ?? "" });
    if (messages.length) {
      const { data: ctx, error } = await db.rpc("wa_context", {});
      if (error) console.error("wa_context", error.message);
      const bot = new Bot(db, wa, ctx ?? { bot_active: false }, deps?.now);
      // Siempre se responde 200 a Meta: si algo falla se registra, pero Meta no debe reintentar en bucle.
      for (const m of messages) await bot.handle(m).catch((e) => console.error("mensaje", m.id, e));
    }
    await flushOutbox(db, wa).catch((e) => console.error("cola", e));
    return new Response("ok", { status: 200 });
  }

  // La caja pide enviar los avisos al momento (con la sesión de un equipo autorizado).
  let allowed = deps?.staffOk ?? false;
  if (deps?.staffOk === undefined) {
    const asUser = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: role } = await asUser.rpc("staff_role");
    allowed = ["sala", "dueño", "admin", "cajero"].includes(String(role));
  }
  if (!allowed) return json({ error: "Sin acceso" }, 403);
  let body: Json = {};
  try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "JSON no válido" }, 400); }
  if (body.action === "flush") return json(await flushOutbox(db, wa));
  // Captura del pago que mandó el cliente: la caja la ve sin que la imagen pase por ningún otro sitio.
  if (body.action === "media") {
    const id = String(body.id ?? "");
    if (!/^\d{5,30}$/.test(id)) return json({ error: "Imagen no válida" }, 400);
    const r = await fetchMedia(env, id, deps?.fetch ?? fetch);
    return r ?? json({ error: "No se pudo traer la imagen (Meta la guarda unos 30 días)" }, 404);
  }
  return json({ error: "Acción no válida" }, 400);
}

if (import.meta.main) Deno.serve((req) => handler(req));
