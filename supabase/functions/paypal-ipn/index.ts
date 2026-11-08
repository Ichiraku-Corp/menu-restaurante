// Notificaciones instantáneas de PayPal (IPN): cada pago recibido llega aquí en segundos.
// 1) Se responde 200 a PayPal de inmediato. 2) Se comprueba con PayPal que el aviso es auténtico
// («VERIFIED»). 3) Si es un pago completado, se guarda en pos_incoming y se empareja con los cobros
// anotados a mano (misma lógica que la revisión de cada 5 minutos del puente, que queda de respaldo).
// Desplegar sin verificación de JWT: PayPal no envía token. Dirección para PayPal:
//   https://<proyecto>.supabase.co/functions/v1/paypal-ipn
const VERIFY_URL = "https://ipnpb.paypal.com/cgi-bin/webscr";

async function handle(raw: string) {
  const check = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Ichiraku-IPN" },
    body: "cmd=_notify-validate&" + raw,
  });
  const verdict = (await check.text()).trim();
  if (verdict !== "VERIFIED") { console.log("IPN no verificado:", verdict); return; }

  const f = new URLSearchParams(raw);
  const status = f.get("payment_status") || "";
  const gross = Number(f.get("mc_gross") || "0");
  const txn = f.get("txn_id") || "";
  if (status !== "Completed" || !(gross > 0) || !txn) { console.log("IPN ignorado:", status, gross, txn); return; }

  const payer = [f.get("first_name"), f.get("last_name")].filter(Boolean).join(" ") || f.get("payer_email") || "";
  const when = Date.parse(f.get("payment_date") || "");
  const row = {
    source: "paypal", tx_id: txn, amount: gross, currency: f.get("mc_currency") || "",
    payer, note: (f.get("memo") || f.get("item_name") || "").slice(0, 120),
    received_at: new Date(isFinite(when) ? when : Date.now()).toISOString(),
  };
  const url = Deno.env.get("SUPABASE_URL") + "/rest/v1/rpc/pos_incoming_ipn";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r = await fetch(url, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_row: row }),
  });
  console.log("IPN guardado:", txn, gross, r.status, await r.text());
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  // PayPal reintenta si no recibe 200 rápido: se responde ya y se procesa en segundo plano
  // @ts-ignore EdgeRuntime existe en Supabase
  const bg = (globalThis as any).EdgeRuntime?.waitUntil?.bind((globalThis as any).EdgeRuntime);
  const job = handle(raw).catch((e) => console.error("IPN error:", e));
  if (bg) bg(job); else await job;
  return new Response("ok");
});
