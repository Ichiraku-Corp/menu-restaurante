// Pruebas de la función nex sin red: Claude y Supabase simulados.
// Ejecutar:  deno test supabase/functions/tests/nex_test.ts
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { converse, matchByName, runTool, SYSTEM_PROMPT, TOOLS } from "../nex/index.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }

// ---------------------------------------------------------------- Supabase simulado
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const rpcCalls: { fn: string; args: Row }[] = [];
  const db = {
    rpcCalls,
    from(t: string) {
      let rows = [...(tables[t] ?? [])];
      const q = {
        select() { return q; },
        order(c: string, o?: { ascending?: boolean }) { rows.sort((a, b) => (a[c]! > b[c]! ? 1 : -1) * (o?.ascending === false ? -1 : 1)); return q; },
        eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
        gte(c: string, v: string) { rows = rows.filter((r) => String(r[c]) >= v); return q; },
        limit(n: number) { rows = rows.slice(0, n); return q; },
        then(res: (v: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: rows, error: null }).then(res); },
      };
      return q;
    },
    rpc(fn: string, args: Row) {
      rpcCalls.push({ fn, args });
      const ing = tables.ingredients.find((i) => String(i.id) === args.p_ingredient)!;
      const f: Record<string, number> = { kg: 1000, g: 1, l: 1000, ml: 1, unidad: 1 };
      const q = Number(args.p_qty) * f[String(args.p_unit)] / f[String(ing.buy_unit)];
      const before = Number(ing.stock_qty);
      ing.stock_qty = args.p_kind === "conteo" ? q : args.p_kind === "ajuste" ? before + q : before - q;
      return Promise.resolve({ data: { stock: ing.stock_qty, unit: ing.buy_unit, cost: Math.abs(Number(ing.stock_qty) - before) * 5, below_min: Number(ing.stock_qty) < Number(ing.min_qty), min: ing.min_qty }, error: null });
    },
  };
  return db;
}
const baseTables = () => ({
  ingredients: [
    { id: 1, name: "Pechuga de pollo", buy_unit: "kg", stock_qty: 5, min_qty: 4, buy_price: 5, buy_qty: 1 },
    { id: 2, name: "Pollo molido", buy_unit: "kg", stock_qty: 2, min_qty: 0, buy_price: 4, buy_qty: 1 },
    { id: 3, name: "Aceite", buy_unit: "l", stock_qty: 3, min_qty: 2, buy_price: 3, buy_qty: 1 },
  ],
  dishes: [{ id: 10, name: "Pollo Saiyan", variants: [{ label: "Peq" }, { label: "Gr" }] }],
  recipe_items: [
    { dish_id: 10, variant: "Peq", ingredient_id: 1, qty: 200, unit: "g", position: 0 },
    { dish_id: 10, variant: "Gr", ingredient_id: 1, qty: 400, unit: "g", position: 0 },
  ],
  inventory_movements: [] as Row[],
});

// ---------------------------------------------------------------- Claude simulado
function fakeAnthropic(script: Row[]) {
  const requests: { body: Row; headers: Headers }[] = [];
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push({ body: JSON.parse(String(init!.body)), headers: new Headers(init!.headers) });
    const msg = script[requests.length - 1];
    return new Response(JSON.stringify({ id: `msg_${requests.length}`, type: "message", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, stop_sequence: null, ...msg }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  return { client: new Anthropic({ apiKey: "test", fetch: fetchFn as typeof fetch, maxRetries: 0 }), requests };
}

Deno.test("las herramientas son estrictas y sin campos extra", () => {
  for (const t of TOOLS) {
    assert(t.strict === true, `${t.name} debe ser strict`);
    const s = t.input_schema as { additionalProperties?: boolean; required?: string[]; properties?: Row };
    eq(s.additionalProperties, false, `${t.name} additionalProperties`);
    eq([...(s.required ?? [])].sort(), Object.keys(s.properties ?? {}).sort(), `${t.name} required = todas las propiedades`);
  }
});

Deno.test("buscar insumos por nombre: exacto, parcial y ambiguo", () => {
  const ings = baseTables().ingredients;
  eq(matchByName(ings, "aceite").one?.id, 3, "exacto sin mayúsculas");
  eq(matchByName(ings, "pechuga").one?.id, 1, "parcial único");
  eq(matchByName(ings, "pollo").many?.map((i) => i.id), [1, 2], "ambiguo devuelve opciones");
  eq(matchByName(ings, "harina").many, [], "nada encontrado");
});

Deno.test("«se quemaron 2 kilos de pechuga» registra la merma con el empleado y confirma", async () => {
  const tables = baseTables(), db = fakeDb(tables);
  const { client, requests } = fakeAnthropic([
    { stop_reason: "tool_use", content: [
      { type: "thinking", thinking: "", signature: "sig-1" },
      { type: "tool_use", id: "tu_1", name: "registrar_merma", input: { insumo: "pechuga", cantidad: 2, unidad: "kg", motivo: "se quemó" } },
    ] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Listo Carlos, registré 2 kilos de pechuga de pollo como merma." }] },
  ]);
  const history = [{ role: "user" as const, content: "[Habla: Carlos] se quemaron 2 kilos de pechuga" }];
  // deno-lint-ignore no-explicit-any
  const out = await converse(client, db as any, history, 21);

  // Petición a Claude
  const first = requests[0];
  eq(first.body.model, "claude-opus-5-5", "modelo");
  eq(first.body.fallbacks, "default", "respaldo ante rechazos");
  assert(String(first.headers.get("anthropic-beta")).includes("server-side-fallback-2026-07-01"), "cabecera beta del respaldo");
  eq((first.body.output_config as Row).effort, "low", "esfuerzo bajo para voz");
  eq(((first.body.system as Row[])[0]).text, SYSTEM_PROMPT, "personalidad");
  eq(((first.body.system as Row[])[0]).cache_control, { type: "ephemeral" }, "caché de las instrucciones");
  assert(!("thinking" in first.body), "no se desactiva el razonamiento");

  // Acción en la base de datos
  eq(db.rpcCalls.length, 1, "una llamada a la base");
  eq(db.rpcCalls[0].args, { p_ingredient: "1", p_kind: "merma", p_qty: 2, p_unit: "kg", p_reason: "se quemó", p_employee: "21", p_source: "nex" }, "argumentos de register_movement");
  eq(tables.ingredients[0].stock_qty, 3, "stock 5 → 3 kg");

  // Resultado devuelto a Claude
  const second = requests[1].body.messages as Row[];
  eq(second.length, 3, "historial: usuario, asistente, resultado");
  eq((second[1].content as Row[])[0], { type: "thinking", thinking: "", signature: "sig-1" }, "el razonamiento se reenvía intacto");
  const tr = (second[2].content as Row[])[0] as Row;
  eq(tr.tool_use_id, "tu_1", "resultado ligado a la llamada");
  const parsed = JSON.parse(String(tr.content));
  eq(parsed.stock_ahora, "3 kg", "stock en el resultado");
  eq(parsed.bajo_minimo, true, "avisa que quedó bajo el mínimo (3 < 4)");

  // Respuesta para la tablet
  eq(out.reply, "Listo Carlos, registré 2 kilos de pechuga de pollo como merma.", "respuesta hablada");
  eq(out.added.length, 3, "se devuelven los 3 mensajes nuevos para que la tablet los guarde");
});

Deno.test("nombre ambiguo: no registra nada y devuelve opciones", async () => {
  const db = fakeDb(baseTables());
  // deno-lint-ignore no-explicit-any
  const r = await runTool(db as any, "registrar_merma", { insumo: "pollo", cantidad: 1, unidad: "kg", motivo: "x" }, 21) as Row;
  eq(db.rpcCalls.length, 0, "no toca la base");
  eq(r.opciones, ["Pechuga de pollo", "Pollo molido"], "opciones para preguntar");
});

Deno.test("receta: pregunta el tamaño si no se dijo, y responde si se dijo", async () => {
  const db = fakeDb(baseTables());
  // deno-lint-ignore no-explicit-any
  const a = await runTool(db as any, "consultar_receta", { plato: "pollo saiyan", tamano: "" }, null) as Row;
  eq(a.tamanos, ["Peq", "Gr"], "pregunta el tamaño");
  // deno-lint-ignore no-explicit-any
  const b = await runTool(db as any, "consultar_receta", { plato: "pollo saiyan", tamano: "gr" }, null) as Row;
  eq(b.ingredientes, ["Pechuga de pollo: 400 g"], "ingredientes del grande");
});

Deno.test("anular el último registro propio deshace el cambio de stock", async () => {
  const tables = baseTables();
  tables.inventory_movements.push({ id: 7, ingredient_id: 3, kind: "merma", delta: -0.5, reason: "se cayó", employee_id: 21, source: "nex", created_at: new Date().toISOString() });
  tables.ingredients[2].stock_qty = 2.5;
  const db = fakeDb(tables);
  // deno-lint-ignore no-explicit-any
  const r = await runTool(db as any, "anular_ultimo", {}, 21) as Row;
  eq(r, { anulado: "merma", insumo: "Aceite" }, "anulado");
  eq(db.rpcCalls[0].args.p_kind, "ajuste", "con un ajuste");
  eq(tables.ingredients[2].stock_qty, 3, "stock vuelve a 3 L");
});

Deno.test("si Claude rechaza, responde con amabilidad y no guarda nada", async () => {
  const db = fakeDb(baseTables());
  const { client } = fakeAnthropic([{ stop_reason: "refusal", content: [], stop_details: { type: "refusal", category: null, explanation: null } }]);
  // deno-lint-ignore no-explicit-any
  const out = await converse(client, db as any, [{ role: "user", content: "[Habla: Ana] hola" }], 1);
  eq(out.added, [], "nada que guardar");
  assert(out.reply.length > 0, "responde algo");
});
