import "./load-env";
// Database round-trip for the pipeline: synthetic customer, fake model replies, no AI calls.
// Everything it creates is deleted at the end (customers cascade to messages, orders, flags...).
import { getProfile } from "@/config/profiles";
import { getSupabase } from "@/lib/supabase";
import { parseModelResult } from "@/lib/pipeline/extraction-prompt";
import { openPending, type MessageCtx } from "@/lib/pipeline/draft";
import { applyExtraction } from "@/lib/pipeline/rules-apply";
import { insertMessage, loadWorkspace, saveWorkspace } from "@/lib/pipeline/store";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

const db = getSupabase();
const profile = getProfile("bakery");
const result = (r: Record<string, unknown>) =>
  parseModelResult({ message_type: "order_detail", order_ref: "NONE", link_confidence: "high", ...r });
const upd = (field: string, value: string, quote: string, agreed = false) =>
  ({ field, value, quote, agreed_by_business: agreed, confidence: "high" });

async function send(customerId: string, direction: "in" | "out", type: "text" | "image", body: string, sentAt: string, waMessageId: string | null = null) {
  const { message, duplicate } = await insertMessage({ customerId, direction, type, body, mediaPath: null, sentAt, waMessageId, raw: null });
  const ctx: MessageCtx = { id: message.id, customerId, direction, type, body, sentAt };
  return { message, ctx, duplicate };
}

async function main() {
  const cust = (await db.from("customers").insert({ wa_id: `test-pipeline-${Date.now()}`, name: "Pipeline Check" }).select("*").single()).data!;
  try {
    // 1. A new order from the first message.
    const m1 = await send(cust.id, "in", "text", "Chocolate cake 1.5 kg for 31st, pickup", "2026-10-20T12:40:00Z", `wa-${cust.id}-1`);
    let ws = await loadWorkspace(cust.id, profile);
    applyExtraction(ws, result({ order_ref: "NEW", field_updates: [
      upd("flavour", "chocolate", "Chocolate cake"), upd("size_or_weight", "1.5 kg", "1.5 kg"), upd("fulfilment", "pickup", "pickup"),
    ] }), m1.ctx);
    await saveWorkspace(ws);
    ws = await loadWorkspace(cust.id, profile);
    const order = ws.orders[0];
    check("db: order saved with its fields", ws.orders.length === 1 && order.order.fields.flavour?.value === "chocolate" && order.order.fields.flavour.source_message_id === m1.message.id);
    check("db: missing_field flags saved (4 missing)", order.flags.filter((f) => f.type === "missing_field").length === 4);
    check("db: status needs_review saved", order.order.status === "needs_review");
    const dup = await send(cust.id, "in", "text", "again", "2026-10-20T12:41:00Z", `wa-${cust.id}-1`);
    check("db: repeated WhatsApp message id is detected as a duplicate", dup.duplicate === true);

    // 2. Rest of the details; flags get resolved.
    const m2 = await send(cust.id, "out", "text", "Done, 1800. Send 900 advance", "2026-10-20T12:50:00Z");
    applyExtraction(ws, result({ order_ref: order.order.id, field_updates: [
      upd("price_agreed", "1800", "1800", true), upd("advance_requested", "900", "900 advance", true),
    ] }), m2.ctx);
    await saveWorkspace(ws);

    // 3. Unagreed change -> pending request, saved.
    const m3 = await send(cust.id, "in", "text", "make it red velvet instead", "2026-10-22T03:35:00Z");
    ws = await loadWorkspace(cust.id, profile);
    applyExtraction(ws, result({ order_ref: ws.orders[0].order.id, field_updates: [upd("flavour", "red velvet", "red velvet instead")] }), m3.ctx);
    await saveWorkspace(ws);
    ws = await loadWorkspace(cust.id, profile);
    check("db: pending request saved and loaded", openPending(ws.orders[0]).length === 1 && ws.orders[0].order.fields.flavour.value === "chocolate");

    // 4. Business agrees -> value changes, pending resolved, note + event saved.
    const m4 = await send(cust.id, "out", "text", "Ok red velvet done", "2026-10-22T03:50:00Z");
    applyExtraction(ws, result({ message_type: "agreement", agrees_to_pending: [openPending(ws.orders[0])[0].id] }), m4.ctx);
    await saveWorkspace(ws);
    ws = await loadWorkspace(cust.id, profile);
    check("db: agreed value saved with previous_value", ws.orders[0].order.fields.flavour.value === "red velvet" && ws.orders[0].order.fields.flavour.previous_value === "chocolate");
    check("db: pending request resolved in the database", openPending(ws.orders[0]).length === 0);
    const notes = (await db.from("update_notes").select("text").eq("order_id", ws.orders[0].order.id)).data ?? [];
    check("db: update note saved", notes.length === 1 && notes[0].text.startsWith("Flavour is now red velvet. Agreed in chat by your business on 22 Oct, 9:20 am"));
    const events = (await db.from("order_events").select("field, actor").eq("order_id", ws.orders[0].order.id)).data ?? [];
    check("db: history events saved", events.some((e) => e.field === "flavour" && e.actor === "chat"));

    // 5. Payment screenshot with the wrong amount.
    const m5 = await send(cust.id, "in", "image", "", "2026-10-22T04:10:00Z");
    applyExtraction(ws, result({ message_type: "payment", order_ref: ws.orders[0].order.id, image_role: "payment_screenshot", payment: { amount: "₹500", reference: "R1", payee: "Kavya's Bakes", date: "22 Oct" } }), m5.ctx);
    await saveWorkspace(ws);
    ws = await loadWorkspace(cust.id, profile);
    check("db: payment attachment saved, unverified", ws.orders[0].attachments.some((a) => a.kind === "payment_screenshot" && a.marked_received === false && a.extracted?.amount === 500));
    check("db: payment_mismatch flag saved", ws.orders[0].flags.some((f) => f.type === "payment_mismatch"));
  } finally {
    await db.from("customers").delete().eq("id", cust.id);
    const left = (await db.from("orders").select("id").eq("customer_id", cust.id)).data ?? [];
    check("db: test data cleaned up", left.length === 0);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL  check-pipeline-db crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
