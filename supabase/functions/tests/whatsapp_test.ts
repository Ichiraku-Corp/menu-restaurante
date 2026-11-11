// Pruebas de la función whatsapp. Meta va simulada; la base de datos es la de pruebas de verdad
// (la crea supabase/pruebas/correr.sh), así que se prueba la conversación completa contra el SQL real.
// Ejecutar:  PGHOST=localhost PGUSER=postgres PGPASSWORD=… deno test -A supabase/functions/tests/whatsapp_test.ts
// Sin PGHOST solo corren las pruebas que no usan base de datos.
import postgres from "npm:postgres@3.4.7";
import { Bot, type Db, flushOutbox, handler, hoursText, openDays, parseWebhook, slotsFor, verifySignature, type Wa } from "../whatsapp/index.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }

async function sign(raw: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- Sin base de datos
Deno.test("firma de Meta: válida, alterada y ausente", async () => {
  const raw = '{"entry":[]}';
  assert(await verifySignature(raw, await sign(raw, "secreto"), "secreto"), "la firma correcta pasa");
  assert(!await verifySignature(raw + " ", await sign(raw, "secreto"), "secreto"), "un cuerpo alterado no pasa");
  assert(!await verifySignature(raw, await sign(raw, "otro"), "secreto"), "otra clave no pasa");
  assert(!await verifySignature(raw, null, "secreto"), "sin firma no pasa");
  assert(!await verifySignature(raw, await sign(raw, "secreto"), ""), "sin secreto configurado no pasa nada");
});

Deno.test("verificación del webhook (GET)", async () => {
  const env = { WHATSAPP_VERIFY_TOKEN: "ramen" };
  const ok = await handler(new Request("https://x/whatsapp?hub.mode=subscribe&hub.verify_token=ramen&hub.challenge=123"), env, { db: {} as Db, wa: {} as Wa });
  eq([ok.status, await ok.text()], [200, "123"], "con el token correcto devuelve el desafío");
  const bad = await handler(new Request("https://x/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=123"), env, { db: {} as Db, wa: {} as Wa });
  eq(bad.status, 403, "con otro token se rechaza");
  await bad.body?.cancel();
});

Deno.test("POST con firma falsa o sin sesión de caja se rechaza sin tocar la base", async () => {
  const db: Db = { rpc: () => { throw new Error("no debía llamar a la base"); } };
  const res = await handler(new Request("https://x/whatsapp", { method: "POST", body: "{}", headers: { "x-hub-signature-256": "sha256=00" } }),
    { WHATSAPP_APP_SECRET: "s" }, { db, wa: {} as Wa });
  eq(res.status, 401, "firma no válida");
  await res.body?.cancel();
  const res2 = await handler(new Request("https://x/whatsapp", { method: "POST", body: '{"action":"flush"}' }), {}, { db, wa: {} as Wa, staffOk: false });
  eq(res2.status, 403, "sin sesión de caja no se puede vaciar la cola");
  await res2.body?.cancel();
});

Deno.test("lectura del webhook: texto, botón, lista, ubicación, imagen, anuncio y estados", () => {
  const body = { entry: [{ changes: [{ field: "messages", value: {
    contacts: [{ wa_id: "584141234567", profile: { name: "Naruto" } }],
    messages: [
      { from: "584141234567", id: "m1", type: "text", text: { body: "hola" }, referral: { source_id: "ad1" } },
      { from: "584141234567", id: "m2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "kind:llevar", title: "Retiro" } } },
      { from: "584141234567", id: "m3", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "zone:3", title: "Centro" } } },
      { from: "584141234567", id: "m4", type: "location", location: { latitude: 10.1, longitude: -67.9 } },
      { from: "584141234567", id: "m5", type: "image", image: { id: "img1", caption: "pago" } },
    ],
    statuses: [{ id: "out1", status: "failed", errors: [{ title: "Re-engagement" }] }],
  } }] }] };
  const { messages: m, statuses: s } = parseWebhook(body);
  eq(m.map((x) => x.replyId ?? x.text ?? x.imageId ?? null), ["hola", "kind:llevar", "zone:3", null, "pago"], "contenidos");
  eq([m[0].name, m[0].referral.source_id, m[3].location?.latitude, m[4].imageId], ["Naruto", "ad1", 10.1, "img1"], "datos extra");
  eq(s, [{ id: "out1", status: "failed", error: "Re-engagement" }], "estados");
  eq(parseWebhook({}).messages.length, 0, "un cuerpo vacío no rompe nada");
});

Deno.test("un fallo interno de la base no se le muestra al cliente; una regla del negocio sí", async () => {
  for (const [dbError, expected] of [["permission denied for table wa_orders", "problema técnico"], ["El pedido mínimo para delivery es Ref 10", "mínimo"]]) {
    const sent: string[] = [];
    const db: Db = { rpc: (fn) => Promise.resolve(fn === "wa_ingest" ? { data: { conversation_id: 1, duplicate: false }, error: null }
      : fn === "wa_state" ? { data: { draft: null, step: "" }, error: null }
      : fn === "wa_order_from_cart" ? { data: null, error: { message: dbError } } : { data: null, error: null }) };
    const wa: Wa = { send: (_to, p) => { sent.push(JSON.stringify(p)); return Promise.resolve({ id: "x" }); }, markRead: () => Promise.resolve() };
    await new Bot(db, wa, { bot_active: true, open_now: true }).handle({ from: "584140000000", name: "", id: "e" + expected, type: "text", text: "pedido AB2CD" });
    assert(sent.some((s) => s.includes(expected)) && !sent.some((s) => s.includes("permission denied")), `error «${dbError}»`);
  }
});

const HOURS = { "0": ["11:30", "20:30"], "1": ["12:30", "21:30"], "2": ["11:30", "20:30"], "3": ["11:30", "20:30"],
  "4": ["11:30", "20:30"], "5": ["11:30", "20:30"], "6": ["11:30", "20:30"] } as Record<string, [string, string]>;

Deno.test("horario de Ichiraku: días abiertos y horas para elegir", () => {
  eq(hoursText(HOURS), "Lunes: 12:30 a 21:30\nMartes a domingo: 11:30 a 20:30", "texto del horario");
  // Miércoles 11 nov 2026, 22:00 en Caracas (02:00 UTC del jueves): hoy ya cerró
  const night = new Date("2026-11-12T02:00:00Z");
  const days = openDays(HOURS, night, 3);
  eq(days.map((d) => d.date), ["2026-11-12", "2026-11-13", "2026-11-14"], "de noche, el primer día es mañana");
  eq(slotsFor(days[0], night, 60, 60).slice(0, 2).map((s) => s.iso), ["2026-11-12T11:30:00-04:00", "2026-11-12T12:30:00-04:00"], "desde que abre");
  // Lunes 16 nov, 13:10 en Caracas: hoy abierto hasta las 21:30
  const monday = new Date("2026-11-16T17:10:00Z");
  const today = openDays(HOURS, monday, 1)[0];
  assert(today.today && today.dow === 1, "el lunes al mediodía, hoy cuenta");
  eq(slotsFor(today, monday, 30, 30)[0].label, "14:00", "la primera hora de hoy deja al menos 30 min para preparar");
  eq(slotsFor(today, monday, 30, 30).length, 10, "una lista de WhatsApp tiene máximo 10 opciones");
});

// ---------------------------------------------------------------- Con la base de datos de pruebas
const PG = Deno.env.get("PGHOST");
const sql = PG ? postgres({ host: PG, port: Number(Deno.env.get("PGPORT") ?? 5432), user: Deno.env.get("PGUSER") ?? "postgres",
  password: Deno.env.get("PGPASSWORD") ?? "", database: Deno.env.get("PRUEBAS_DB") ?? "ichiraku_pruebas", onnotice: () => {} }) : null;

/** Llama a las funciones SQL como lo hace supabase-js (rpc con argumentos con nombre). */
function lit(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  return `'${String(v).replaceAll("'", "''")}'`;
}
const realDb: Db = {
  async rpc(fn, args = {}) {
    try {
      const params = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
      const rows = await sql!.unsafe(`select public.${fn}(${params}) as r`);
      return { data: rows[0]?.r ?? null, error: null };
    } catch (e) {
      return { data: null, error: { message: String((e as Error).message) } };
    }
  },
};

function fakeWa() {
  const sent: { to: string; p: Record<string, unknown> }[] = [];
  let n = 0;
  const wa: Wa = { send(to, p) { sent.push({ to, p }); return Promise.resolve({ id: `wamid.out.${Date.now()}.${++n}` }); }, markRead: () => Promise.resolve() };
  return { wa, sent };
}
// deno-lint-ignore no-explicit-any
type P = any;
const last = (sent: { p: P }[]) => sent[sent.length - 1].p;
const ids = (p: P): string[] => p.interactive?.action?.buttons?.map((b: P) => b.reply.id) ?? p.interactive?.action?.sections?.[0]?.rows?.map((r: P) => r.id) ?? [];
const body = (p: P): string => p.text?.body ?? p.interactive?.body?.text ?? "";
type InMsg = Parameters<Bot["handle"]>[0];

Deno.test({ name: "conversación completa: carta → delivery → pago → caja recibe el pedido", ignore: !sql, sanitizeResources: false, sanitizeOps: false, async fn() {
  const phone = "58412" + String(Date.now()).slice(-7);
  await sql!`update public.wa_settings set hours = ${sql!.json({ "0": ["00:00", "23:59"], "1": ["00:00", "23:59"], "2": ["00:00", "23:59"],
    "3": ["00:00", "23:59"], "4": ["00:00", "23:59"], "5": ["00:00", "23:59"], "6": ["00:00", "23:59"] })}, payment_info = 'Pago móvil: Banco X, 0414-0000000, J-000'`;
  await sql!`update public.dishes set available = true where name in ('Pollo Kobayashi', 'Gyozas')`;
  const [{ id: zone }] = await sql!`insert into public.wa_zones (name, fee) values ('Zona prueba bot', 3) returning id`;
  const [{ k }] = await sql!`select id as k from public.dishes where name = 'Pollo Kobayashi'`;
  const [{ g }] = await sql!`select id as g from public.dishes where name = 'Gyozas'`;
  const { data: cart } = await realDb.rpc("wa_cart_create", { p_items: [{ dish_id: Number(k), variant: "Gr", qty: 1 }, { dish_id: Number(g), qty: 1 }] });

  const { wa, sent } = fakeWa();
  const { data: ctx } = await realDb.rpc("wa_context", {});
  const bot = new Bot(realDb, wa, ctx);
  let seq = 0;
  const say = (m: Partial<InMsg>) => bot.handle({ from: phone, name: "Kakashi Hatake", id: `in.${phone}.${++seq}`, type: "text", ...m });

  await say({ text: "Hola" });
  assert(ids(last(sent)).includes("menu:pedir"), "un saludo recibe el menú con opciones");
  await say({ type: "interactive", replyId: "menu:ubicacion" });
  assert(sent.some((s) => s.p.type === "location"), "«Ubicación» manda el pin del local");

  await say({ text: `Hola, quiero hacer el pedido ${cart.code}` });
  assert(sent.some((s) => body(s.p).includes("Ref 20,00")), "el resumen muestra el total real (15 + 5)");
  eq(ids(last(sent)), ["kind:llevar", "kind:delivery"], "pregunta retiro o delivery");
  await say({ type: "interactive", replyId: "kind:delivery" });
  assert(ids(last(sent)).includes(`zone:${zone}`), "muestra las zonas");
  await say({ type: "interactive", replyId: `zone:${zone}` });
  assert(body(last(sent)).includes("dirección"), "pide la dirección");
  await say({ text: "Calle Hokage, casa 7, frente a la academia" });
  eq(ids(last(sent)), ["name:profile"], "ofrece usar el nombre del perfil");
  await say({ type: "interactive", replyId: "name:profile" });
  eq(ids(last(sent)), ["doc:omitir"], "pide la cédula (se puede omitir)");
  await say({ text: "hola" });
  assert(body(last(sent)).includes("número de cédula"), "si escribe otra cosa, explica qué necesita");
  await say({ text: "V-20.123.456" });
  assert(!ids(last(sent)).includes("pay:efectivo") && ids(last(sent)).includes("pay:pago_movil"), "métodos de pago, sin efectivo");
  await say({ type: "interactive", replyId: "pay:pago_movil" });
  assert(body(last(sent)).includes("Banco X") && body(last(sent)).includes("Ref 23,00"), "manda los datos de pago y el total con delivery");
  await say({ text: "00123456" });
  eq(ids(last(sent)), ["order:confirm", "order:cancel"], "pide confirmar");
  assert(body(last(sent)).includes("Calle Hokage") && body(last(sent)).includes("Kakashi"), "el resumen final tiene dirección y nombre");
  await say({ type: "interactive", replyId: "order:confirm" });
  assert(body(last(sent)).includes("Recibimos tu pedido"), "confirma al cliente");

  const [o] = await sql!`select o.status, o.kind, o.delivery_fee, o.doc_id, o.payment_ref, o.customer_name
                         from public.wa_orders o join public.wa_conversations c on c.id = o.conversation_id where c.phone = ${phone}`;
  eq([o.status, o.kind, Number(o.delivery_fee), o.doc_id, o.payment_ref, o.customer_name],
     ["por_aceptar", "delivery", 3, "V20123456", "00123456", "Kakashi Hatake"], "caja recibe el pedido completo");
  const [{ n }] = await sql!`select count(*)::int as n from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
                             where c.phone = ${phone} and m.direction = 'out'`;
  eq(n, sent.length, "cada respuesta del bot queda guardada en la conversación");

  // Meta reenvía el mismo mensaje: no se responde dos veces.
  const before = sent.length;
  await bot.handle({ from: phone, name: "Kakashi Hatake", id: `in.${phone}.1`, type: "text", text: "Hola" });
  eq(sent.length, before, "un mensaje repetido no genera respuesta");
}});

Deno.test({ name: "reglas, reservas, hablar con una persona y cola de avisos", ignore: !sql, sanitizeResources: false, sanitizeOps: false, async fn() {
  const phone = "58424" + String(Date.now()).slice(-7);
  const [{ g }] = await sql!`select id as g from public.dishes where name = 'Gyozas'`;
  const { data: cart } = await realDb.rpc("wa_cart_create", { p_items: [{ dish_id: Number(g), qty: 1 }] });
  const { wa, sent } = fakeWa();
  const { data: ctx } = await realDb.rpc("wa_context", {});
  const bot = new Bot(realDb, wa, ctx);
  let seq = 0;
  const say = (m: Partial<InMsg>) => bot.handle({ from: phone, name: "Rock Lee", id: `in.${phone}.${++seq}`, type: "text", ...m });

  // Delivery por debajo del mínimo: el error de la base llega claro al cliente.
  await say({ text: `pedido ${cart.code}` });
  await say({ type: "interactive", replyId: "kind:delivery" });
  const [{ id: zone }] = await sql!`select id from public.wa_zones where active order by id limit 1`;
  await say({ type: "interactive", replyId: `zone:${zone}` });
  await say({ text: "Avenida Konoha 1" });
  await say({ type: "interactive", replyId: "name:profile" });
  await say({ type: "interactive", replyId: "doc:omitir" });
  await say({ type: "interactive", replyId: "pay:zelle" });
  await say({ text: "ZX99" });
  await say({ type: "interactive", replyId: "order:confirm" });
  assert(sent.some((s) => body(s.p).includes("mínimo para delivery")), "explica el pedido mínimo");
  await say({ type: "interactive", replyId: "order:cancel" });
  assert(body(last(sent)).includes("cancelamos"), "puede cancelar");

  // Reserva
  await say({ type: "interactive", replyId: "menu:reservar" });
  await say({ type: "interactive", replyId: ids(last(sent))[1] });
  await say({ type: "interactive", replyId: ids(last(sent))[0] });
  await say({ type: "interactive", replyId: "res:people:mas" });
  await say({ text: "12" });
  assert(sent.some((s) => body(s.p).includes("Reserva para *12*")), "reserva de 12 personas anotada");
  const [{ people }] = await sql!`select r.people from public.wa_reservations r join public.wa_conversations c on c.id = r.conversation_id where c.phone = ${phone}`;
  eq(people, 12, "la reserva queda pendiente para caja");

  // Hablar con una persona: el bot se calla en esa conversación.
  await say({ type: "interactive", replyId: "menu:humano" });
  const before = sent.length;
  await say({ text: "¿tienen ramen vegetariano?" });
  eq(sent.length, before, "con una persona atendiendo, el bot no responde");

  // Cola de avisos: lo que deja caja sale por WhatsApp.
  const [{ conv }] = await sql!`select id as conv from public.wa_conversations where phone = ${phone}`;
  await sql!`select public.wa_queue(${conv}, 'Aviso de prueba de la caja')`;
  const r = await flushOutbox(realDb, wa);
  assert(r.sent >= 1 && sent.some((s) => s.to === phone && body(s.p) === "Aviso de prueba de la caja"), "el aviso de caja sale");
  const [{ st }] = await sql!`select status as st from public.wa_outbox where body = 'Aviso de prueba de la caja'`;
  eq(st, "enviado", "y queda marcado como enviado");
}});

Deno.test({ name: "webhook firmado de punta a punta", ignore: !sql, sanitizeResources: false, sanitizeOps: false, async fn() {
  const phone = "58416" + String(Date.now()).slice(-7);
  const { wa, sent } = fakeWa();
  const raw = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: {
    contacts: [{ wa_id: phone, profile: { name: "Hinata" } }],
    messages: [{ from: phone, id: `in.${phone}.x`, type: "text", text: { body: "Buenas" } }] } }] }] });
  const res = await handler(new Request("https://x/whatsapp", { method: "POST", body: raw, headers: { "x-hub-signature-256": await sign(raw, "s3") } }),
    { WHATSAPP_APP_SECRET: "s3" }, { db: realDb, wa });
  eq(res.status, 200, "Meta recibe 200");
  await res.body?.cancel();
  assert(sent.some((s) => s.to === phone && ids(s.p).includes("menu:reservar")), "y el cliente recibe el menú");
  await sql!.end();
}});
