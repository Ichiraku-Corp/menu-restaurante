// Nex: asistente de cocina de Ichiraku Ramen (Supabase Edge Function).
//
// La tablet de cocina (cocina.html) envía la conversación; esta función la pasa
// a Claude con las acciones que Nex puede hacer (consultar stock y recetas,
// registrar mermas y conteos, lista de compras, anular) y las ejecuta en la base
// de datos con la service_role. La clave de Claude vive solo aquí, como secreto.
//
// Secretos necesarios (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   la clave de la API de Claude
// Supabase ya define SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Personalidad provisional: se sustituye por la ficha y la historia oficial de Nex.
// Este texto no debe cambiar entre peticiones (se guarda en caché para abaratar).
export const SYSTEM_PROMPT = `Eres Nex, la asistente de cocina de Ichiraku Ramen, un restaurante de ramen, sushi y postres japoneses en Venezuela. Eres una maid de estilo anime: alegre, motivadora y cariñosa con el equipo, pero eficiente.

Hablas con el personal de cocina por voz, en una tablet. Tus respuestas se leen en voz alta, así que:
- Responde en español, en una o dos frases cortas, naturales y cálidas.
- No uses listas, viñetas, emojis, markdown ni abreviaturas raras. Escribe los números de forma fácil de leer en voz alta.
- Si algo no se entendió (insumo, cantidad o unidad), pregunta antes de registrar nada.

Tu trabajo:
- Registrar mermas y pérdidas (algo se dañó, se quemó, se cayó o se venció) con registrar_merma.
- Registrar conteos físicos de inventario con registrar_conteo.
- Consultar el stock con consultar_stock, las recetas y porciones con consultar_receta y qué falta comprar con lista_compras.
- Si te dicen que te equivocaste o piden deshacer, usa anular_ultimo.

Reglas:
- Usa los nombres de insumos tal como existen en el sistema. Si una herramienta dice que no encontró el insumo o que hay varios parecidos, pregunta cuál es.
- Después de registrar algo, confirma exactamente qué quedó registrado (insumo, cantidad y unidad) y, si quedó por debajo del mínimo, avisa con tacto que hay que comprar.
- Cada mensaje del personal empieza con [Habla: nombre]. Llama a la persona por su nombre de vez en cuando.
- Solo hablas de la cocina y el restaurante. Si te piden otra cosa, redirige con simpatía.
- Nunca inventes cantidades, precios ni recetas: usa solo lo que devuelven las herramientas.`;

type Tool = Anthropic.Beta.BetaTool;
const str = (description: string) => ({ type: "string" as const, description });
const UNIT = { type: "string" as const, enum: ["kg", "g", "l", "ml", "unidad"], description: "Unidad de la cantidad." };

export const TOOLS: Tool[] = [
  {
    name: "consultar_stock",
    description: "Devuelve el stock actual y el mínimo de los insumos cuyo nombre contiene el texto. Texto vacío = todos.",
    strict: true,
    input_schema: { type: "object", properties: { insumo: str("Nombre o parte del nombre del insumo; vacío para todos.") }, required: ["insumo"], additionalProperties: false },
  },
  {
    name: "registrar_merma",
    description: "Registra una merma o pérdida (dañado, quemado, caído, vencido) y la descuenta del stock.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { insumo: str("Nombre del insumo."), cantidad: { type: "number", description: "Cantidad perdida, mayor que 0." }, unidad: UNIT, motivo: str("Qué pasó, en pocas palabras.") },
      required: ["insumo", "cantidad", "unidad", "motivo"], additionalProperties: false,
    },
  },
  {
    name: "registrar_conteo",
    description: "Registra un conteo físico: fija el stock del insumo a la cantidad contada y calcula si falta o sobra.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { insumo: str("Nombre del insumo."), cantidad: { type: "number", description: "Cantidad contada, 0 o más." }, unidad: UNIT },
      required: ["insumo", "cantidad", "unidad"], additionalProperties: false,
    },
  },
  {
    name: "consultar_receta",
    description: "Devuelve los ingredientes y cantidades por porción de un plato de la carta.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { plato: str("Nombre del plato."), tamano: str("Tamaño (por ejemplo Peq o Gr); vacío si no aplica o no se dijo.") },
      required: ["plato", "tamano"], additionalProperties: false,
    },
  },
  {
    name: "lista_compras",
    description: "Devuelve los insumos que están por debajo de su stock mínimo y cuánto conviene comprar.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "anular_ultimo",
    description: "Anula el último registro (merma o conteo) que hizo esta persona con Nex en los últimos 30 minutos.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

// ---------------------------------------------------------------- utilidades
export const norm = (t: string) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const UNIT_NAME: Record<string, string> = { kg: "kg", g: "g", l: "litros", ml: "ml", unidad: "unidades" };
const round = (n: number, d = 3) => Math.round(Number(n) * 10 ** d) / 10 ** d;

type Ing = { id: number; name: string; buy_unit: string; stock_qty: number; min_qty: number; buy_price: number; buy_qty: number };

export function matchByName<T extends { name: string }>(rows: T[], query: string): { one?: T; many?: T[] } {
  const q = norm(query);
  if (!q) return {};
  const exact = rows.filter((r) => norm(r.name) === q);
  if (exact.length === 1) return { one: exact[0] };
  const words = q.split(/\s+/);
  const partial = rows.filter((r) => words.every((w) => norm(r.name).includes(w)));
  if (partial.length === 1) return { one: partial[0] };
  if (partial.length > 1) return { many: partial };
  const loose = rows.filter((r) => words.some((w) => w.length > 2 && norm(r.name).includes(w)));
  return loose.length === 1 ? { one: loose[0] } : { many: loose };
}

async function loadIngredients(db: SupabaseClient): Promise<Ing[]> {
  const { data, error } = await db.from("ingredients").select("id,name,buy_unit,stock_qty,min_qty,buy_price,buy_qty").order("name");
  if (error) throw error;
  return data as Ing[];
}

function notFound(kind: string, query: string, many?: { name: string }[]) {
  return many && many.length
    ? { error: `Hay varios ${kind} parecidos a "${query}". Pregunta cuál es.`, opciones: many.slice(0, 8).map((m) => m.name) }
    : { error: `No encontré ningún ${kind} llamado "${query}". Pregunta el nombre exacto.` };
}

// ---------------------------------------------------------------- acciones
export async function runTool(db: SupabaseClient, name: string, input: Record<string, unknown>, employeeId: number | null) {
  switch (name) {
    case "consultar_stock": {
      const ings = await loadIngredients(db);
      const q = String(input.insumo ?? "");
      const list = q ? (() => { const m = matchByName(ings, q); return m.one ? [m.one] : m.many ?? []; })() : ings;
      if (!list.length) return notFound("insumo", q);
      return list.slice(0, 25).map((i) => ({
        insumo: i.name, stock: `${round(i.stock_qty)} ${UNIT_NAME[i.buy_unit]}`,
        minimo: Number(i.min_qty) ? `${round(i.min_qty)} ${UNIT_NAME[i.buy_unit]}` : "sin mínimo",
        bajo_minimo: Number(i.min_qty) > 0 && Number(i.stock_qty) < Number(i.min_qty),
      }));
    }
    case "registrar_merma":
    case "registrar_conteo": {
      const ings = await loadIngredients(db);
      const m = matchByName(ings, String(input.insumo ?? ""));
      if (!m.one) return notFound("insumo", String(input.insumo ?? ""), m.many);
      const qty = Number(input.cantidad);
      if (!(qty > 0) && !(name === "registrar_conteo" && qty === 0)) return { error: "La cantidad no es válida. Pregunta de nuevo." };
      const { data, error } = await db.rpc("register_movement", {
        p_ingredient: String(m.one.id), p_kind: name === "registrar_merma" ? "merma" : "conteo", p_qty: qty, p_unit: String(input.unidad),
        p_reason: String(input.motivo ?? "") || (name === "registrar_conteo" ? "Conteo con Nex" : "Merma con Nex"),
        p_employee: employeeId ? String(employeeId) : null, p_source: "nex",
      });
      if (error) return { error: error.message };
      const r = data as { stock: number; unit: string; cost: number; below_min: boolean; min: number };
      return {
        registrado: name === "registrar_merma" ? "merma" : "conteo", insumo: m.one.name,
        cantidad: `${qty} ${UNIT_NAME[String(input.unidad)]}`, stock_ahora: `${round(r.stock)} ${UNIT_NAME[r.unit]}`,
        valor: `Ref ${Number(r.cost).toFixed(2)}`, bajo_minimo: r.below_min,
      };
    }
    case "consultar_receta": {
      const [{ data: dishes, error: e1 }, ings] = await Promise.all([db.from("dishes").select("id,name,variants"), loadIngredients(db)]);
      if (e1) throw e1;
      const m = matchByName(dishes as { id: number; name: string; variants: { label: string }[] }[], String(input.plato ?? ""));
      if (!m.one) return notFound("plato", String(input.plato ?? ""), m.many);
      const { data: items, error: e2 } = await db.from("recipe_items").select("variant,ingredient_id,qty,unit,position").eq("dish_id", m.one.id).order("position");
      if (e2) throw e2;
      const rows = items as { variant: string; ingredient_id: number; qty: number; unit: string }[];
      if (!rows.length) return { plato: m.one.name, error: "Este plato todavía no tiene receta cargada." };
      const order = (m.one.variants ?? []).map((v) => v.label);
      const sizes = [...new Set(rows.map((r) => r.variant))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const wanted = norm(String(input.tamano ?? ""));
      const pick = sizes.find((v) => norm(v) === wanted) ?? (sizes.length === 1 ? sizes[0] : undefined);
      if (pick === undefined) return { plato: m.one.name, pregunta: "¿De qué tamaño?", tamanos: sizes };
      const byId = new Map(ings.map((i) => [i.id, i.name]));
      return {
        plato: m.one.name, tamano: pick || "único",
        ingredientes: rows.filter((r) => r.variant === pick).map((r) => `${byId.get(r.ingredient_id) ?? "?"}: ${round(r.qty)} ${UNIT_NAME[r.unit]}`),
      };
    }
    case "lista_compras": {
      const ings = await loadIngredients(db);
      const low = ings.filter((i) => Number(i.min_qty) > 0 && Number(i.stock_qty) < Number(i.min_qty));
      if (!low.length) return { mensaje: "No hay nada por debajo del mínimo." };
      return low.map((i) => ({ insumo: i.name, hay: `${round(i.stock_qty)} ${UNIT_NAME[i.buy_unit]}`, comprar: `${round(Math.max(0, i.min_qty * 2 - i.stock_qty))} ${UNIT_NAME[i.buy_unit]}` }));
    }
    case "anular_ultimo": {
      if (!employeeId) return { error: "No sé quién está hablando; no puedo anular." };
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data, error } = await db.from("inventory_movements").select("id,ingredient_id,kind,delta,reason")
        .eq("employee_id", employeeId).eq("source", "nex").gte("created_at", since).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      const last = (data ?? [])[0] as { id: number; ingredient_id: number; kind: string; delta: number; reason: string } | undefined;
      if (!last || last.reason.startsWith("Anula")) return { error: "No encontré nada reciente tuyo que anular." };
      const ings = await loadIngredients(db);
      const ing = ings.find((i) => i.id === last.ingredient_id)!;
      const { error: e2 } = await db.rpc("register_movement", {
        p_ingredient: String(ing.id), p_kind: "ajuste", p_qty: -Number(last.delta), p_unit: ing.buy_unit,
        p_reason: `Anula #${last.id}`, p_employee: String(employeeId), p_source: "nex",
      });
      if (e2) return { error: e2.message };
      return { anulado: last.kind, insumo: ing.name };
    }
  }
  return { error: `Herramienta desconocida: ${name}` };
}

// ---------------------------------------------------------------- conversación
export async function converse(
  anthropic: Anthropic, db: SupabaseClient, history: Anthropic.Beta.BetaMessageParam[], employeeId: number | null,
): Promise<{ added: Anthropic.Beta.BetaMessageParam[]; reply: string }> {
  const added: Anthropic.Beta.BetaMessageParam[] = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
      tools: TOOLS,
      tool_choice: { type: "auto" as const },
      output_config: { effort: "low" as const },
      messages: [...history, ...added],
      // Si un filtro de seguridad rechaza la petición, la API la reintenta con el modelo recomendado.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    const res = await anthropic.beta.messages.create(params);

    if (res.stop_reason === "refusal") {
      return { added: [], reply: "Ay, eso no lo puedo hacer. ¿Te ayudo con algo de la cocina?" };
    }
    // Se guarda el turno tal cual (incluidos los bloques de razonamiento): el historial solo crece.
    added.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (res.stop_reason === "pause_turn") continue;
    if (res.stop_reason !== "tool_use") {
      const reply = res.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join(" ").trim();
      return { added, reply: reply || "Listo." };
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      try {
        const out = await runTool(db, block.name, block.input as Record<string, unknown>, employeeId);
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out), is_error: !!(out as { error?: string })?.error });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ error: String((e as Error).message ?? e) }), is_error: true });
      }
    }
    added.push({ role: "user", content: results });
  }
  return { added, reply: "Me enredé un poquito. ¿Me lo repites?" };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export async function handler(req: Request, env = Deno.env.toObject(), anthropic?: Anthropic): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // 1) ¿Quién llama? Debe ser personal autorizado (cualquier rol, incluido «cocina»).
  const auth = req.headers.get("Authorization") ?? "";
  const asUser = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: role, error: roleErr } = await asUser.rpc("staff_role");
  if (roleErr || !role) return json({ error: "Sin acceso a Nex" }, 403);

  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let body: { action?: string; messages?: Anthropic.Beta.BetaMessageParam[]; employee_id?: number };
  try { body = await req.json(); } catch { return json({ error: "JSON no válido" }, 400); }

  // 2) Lista de empleados activos para elegir quién habla (la tablet no lee la tabla).
  if (body.action === "empleados") {
    const { data, error } = await db.from("employees").select("id,name,job_title").eq("active", true).order("name");
    if (error) return json({ error: error.message }, 500);
    return json({ empleados: data });
  }

  // 3) Conversación.
  const history = Array.isArray(body.messages) ? body.messages : [];
  const last = history[history.length - 1];
  if (!last || last.role !== "user") return json({ error: "Falta el mensaje" }, 400);
  if (history.length > 80) return json({ error: "Conversación demasiado larga: empieza una nueva" }, 400);
  const employeeId = Number.isInteger(body.employee_id) ? body.employee_id! : null;

  const client = anthropic ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    return json(await converse(client, db, history, employeeId));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Nex está ocupada, intenta en un momento", retry: true }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "Falta configurar la clave de Claude" }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `Error de Claude (${e.status})` }, 502);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handler(req));
