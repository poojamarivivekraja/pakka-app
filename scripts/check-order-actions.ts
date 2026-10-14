import "./load-env";
// Database round-trip for the owner's actions: synthetic customer, fake model replies, no AI.
// Everything it creates is deleted at the end.
import { getProfile } from "@/config/profiles";
import { getSupabase } from "@/lib/supabase";
import { parseModelResult } from "@/lib/pipeline/extraction-prompt";
import type { MessageCtx } from "@/lib/pipeline/draft";
import { applyExtraction } from "@/lib/pipeline/rules-apply";
import { insertMessage, loadWorkspace, saveWorkspace } from "@/lib/pipeline/store";
import {
  ActionError, chooseConflictValue, chooseOrderForMessage, clearUpdatedAfterConfirmation, closeOrder,
  confirmOrder, editField, markFlagChecked, markNoteSeen, markPaymentReceived,
} from "@/lib/order-actions";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}
async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return e instanceof ActionError ? e.message : `unexpected: ${e}`; }
}

const db = getSupabase();
const profile = getProfile("bakery");
const result = (r: Record<string, unknown>) =>
  parseModelResult({ message_type: "order_detail", order_ref: "NONE", link_confidence: "high", ...r });
const upd = (field: string, value: string, quote: string, agreed = false) =>
  ({ field, value, quote, agreed_by_business: agreed, confidence: "high" });

let clock = 0;
async function send(customerId: string, direction: "in" | "out", body: string, type: "text" | "image" = "text") {
  const sentAt = new Date(Date.UTC(2026, 9, 20, 6, 0) + ++clock * 60_000).toISOString();
  const { message } = await insertMessage({ customerId, direction, type, body, mediaPath: null, sentAt, waMessageId: null, raw: null });
  return { message, ctx: { id: message.id, customerId, direction, type, body, sentAt } as MessageCtx };
}
const order = async (id: string) => (await db.from("orders").select("*").eq("id", id).single()).data!;
const openFlags = async (id: string) => ((await db.from("flags").select("*").eq("order_id", id).eq("resolved", false)).data ?? []) as { type: string; data: Record<string, unknown> | null }[];
const events = async (id: string) => ((await db.from("order_events").select("*").eq("order_id", id)).data ?? []) as { actor: string; field: string | null; old_value: string | null; new_value: string | null; note: string | null }[];

async function newOrder(customerId: string, body: string, updates: ReturnType<typeof upd>[]) {
  const m = await send(customerId, "in", body);
  const ws = await loadWorkspace(customerId, profile);
  const { draft } = applyExtraction(ws, result({ order_ref: "NEW", field_updates: updates }), m.ctx);
  await saveWorkspace(ws);
  return draft!.order.id;
}

// Every quote used below appears in this text, so nothing is dropped by the quote check.
const BODY = "12 brownies walnut chocolate pickup 31st 5 pm 1800 900";

const FULL = [
  upd("items_summary", "a box of 12 brownies", "12 brownies"), upd("due_date", "2026-10-31", "31st"), upd("due_time", "17:00", "5 pm"),
  upd("fulfilment", "pickup", "pickup"), upd("size_or_weight", "1 box", "12 brownies"), upd("flavour", "walnut", "walnut"),
];

async function main() {
  const cust = (await db.from("customers").insert({ wa_id: `test-actions-${Date.now()}`, name: "Actions Check" }).select("*").single()).data!;
  try {
    // 1. Editing: fills a missing field, resolves its flag, recomputes the status, writes an owner event.
    const a = await newOrder(cust.id, BODY, FULL);
    check("start: order needs review (price missing)", (await order(a)).status === "needs_review" && (await openFlags(a)).some((f) => f.data?.field === "price_agreed"));
    await editField(a, "price_agreed", "1,800");
    let o = await order(a);
    check("edit: value saved as rupees", o.fields.price_agreed.value === "₹1800");
    check("edit: marked as edited by the owner", o.fields.price_agreed.edited_by_owner === true && o.fields.price_agreed.source_message_id === null);
    check("edit: its missing_field flag is resolved", !(await openFlags(a)).some((f) => f.data?.field === "price_agreed"));
    check("edit: status recomputed to ready", o.status === "ready");
    check("edit: an owner event is written", (await events(a)).some((e) => e.actor === "owner" && e.field === "price_agreed" && e.new_value === "₹1800"));

    await editField(a, "flavour", "pistachio");
    o = await order(a);
    check("edit: previous value is kept as 'Was'", o.fields.flavour.value === "pistachio" && o.fields.flavour.previous_value === "walnut");
    await editField(a, "due_time", "6:30 pm");
    check("edit: times are stored as 24-hour", (await order(a)).fields.due_time.value === "18:30");

    check("edit: an empty value is rejected", (await rejects(() => editField(a, "flavour", "  "))) !== null);
    check("edit: a bad date is rejected", (await rejects(() => editField(a, "due_date", "tomorrow"))) !== null);
    check("edit: a bad time is rejected", (await rejects(() => editField(a, "due_time", "evening"))) !== null);
    check("edit: a bad fulfilment option is rejected", (await rejects(() => editField(a, "fulfilment", "drone"))) !== null);
    check("edit: an untracked field is rejected", (await rejects(() => editField(a, "nope", "x"))) !== null);

    // 2. Confirm.
    await editField(a, "fulfilment", "delivery");
    check("confirm: choosing delivery makes the address required again", (await order(a)).status === "needs_review");
    check("confirm: refused while something is missing", (await rejects(() => confirmOrder(a))) !== null);
    await editField(a, "address", "Flat 4B, Lotus Residency");
    await confirmOrder(a);
    o = await order(a);
    check("confirm: status confirmed with a confirmed_at time", o.status === "confirmed" && !!o.confirmed_at);
    check("confirm: refused a second time", (await rejects(() => confirmOrder(a))) !== null);
    check("confirm: an owner event is written", (await events(a)).some((e) => e.actor === "owner" && e.note === "Order confirmed"));

    // 3. A change agreed after confirmation, then opening the order clears the marker.
    const m1 = await send(cust.id, "out", "Ok pistachio becomes almond, done");
    let ws = await loadWorkspace(cust.id, profile);
    applyExtraction(ws, result({ order_ref: a, field_updates: [upd("flavour", "almond", "almond", true)] }), m1.ctx);
    await saveWorkspace(ws);
    o = await order(a);
    check("confirmed: an agreed change keeps it confirmed and sets updated_after_confirmation", o.status === "confirmed" && o.updated_after_confirmation === true);
    await clearUpdatedAfterConfirmation(a);
    check("confirmed: opening the order clears updated_after_confirmation", (await order(a)).updated_after_confirmation === false);
    const notes = (await db.from("update_notes").select("id, seen").eq("order_id", a)).data ?? [];
    await markNoteSeen(notes[0].id);
    check("notes: 'Got it' marks a note seen", ((await db.from("update_notes").select("seen").eq("id", notes[0].id).single()).data!.seen) === true);

    // 4. Conflict: the owner picks a value.
    const b = await newOrder(cust.id, BODY, [...FULL.slice(0, 5), upd("price_agreed", "1800", "1800"), upd("flavour", "chocolate", "chocolate")]);
    const mc = await send(cust.id, "in", "you said 1600 na?");
    ws = await loadWorkspace(cust.id, profile);
    applyExtraction(ws, result({ order_ref: b, conflicts: [{ field: "price_agreed", values: ["1800", "1600"] }] }), mc.ctx);
    await saveWorkspace(ws);
    const conflict = (await openFlags(b)).find((f) => f.type === "conflict");
    check("conflict: flag raised and order needs review", !!conflict && (await order(b)).status === "needs_review");
    const conflictId = ((await db.from("flags").select("id").eq("order_id", b).eq("type", "conflict")).data ?? [])[0].id;
    await chooseConflictValue(b, conflictId, "1600");
    o = await order(b);
    check("conflict: the chosen value is saved", o.fields.price_agreed.value === "₹1600" && o.fields.price_agreed.previous_value === "1800");
    check("conflict: the flag is resolved and the order is ready", !(await openFlags(b)).some((f) => f.type === "conflict") && o.status === "ready");
    check("conflict: choosing again is refused", (await rejects(() => chooseConflictValue(b, conflictId, "1800"))) !== null);

    // 5. Payment mismatch: mark received.
    const c = await newOrder(cust.id, BODY, [...FULL, upd("price_agreed", "1800", "1800"), upd("advance_requested", "900", "900", true)]);
    const mp = await send(cust.id, "in", "", "image");
    ws = await loadWorkspace(cust.id, profile);
    applyExtraction(ws, result({ order_ref: c, image_role: "payment_screenshot", payment: { amount: "₹500", reference: "R1", payee: "Shop", date: "22 Oct" } }), mp.ctx);
    await saveWorkspace(ws);
    check("payment: mismatch flag raised", (await openFlags(c)).some((f) => f.type === "payment_mismatch"));
    const att = (await db.from("attachments").select("id").eq("order_id", c)).data![0];
    await markPaymentReceived(c, att.id);
    check("payment: screenshot marked received", (await db.from("attachments").select("marked_received").eq("id", att.id).single()).data!.marked_received === true);
    check("payment: mismatch flag resolved and order ready", !(await openFlags(c)).some((f) => f.type === "payment_mismatch") && (await order(c)).status === "ready");

    // 6. Flags the owner just checks.
    const mu = await send(cust.id, "in", "x");
    ws = await loadWorkspace(cust.id, profile);
    applyExtraction(ws, result({ order_ref: c, field_updates: [{ ...upd("dietary", "no nuts", "x"), confidence: "low" }] }), { ...mu.ctx, body: "no nuts x" });
    await saveWorkspace(ws);
    const low = (await db.from("flags").select("id").eq("order_id", c).eq("type", "low_confidence").eq("resolved", false)).data ?? [];
    check("checked: a low-confidence flag exists", low.length === 1);
    await markFlagChecked(c, low[0].id);
    check("checked: marking it checked resolves it", (await openFlags(c)).every((f) => f.type !== "low_confidence"));
    check("checked: a missing_field flag can't be 'checked' away", (await rejects(() => markFlagChecked(a, "00000000-0000-0000-0000-000000000000"))) !== null);

    // 7. which_order: apply the stored result to the chosen order.
    const d1 = await newOrder(cust.id, BODY, FULL);
    const d2 = await newOrder(cust.id, BODY, FULL);
    const mw = await send(cust.id, "in", "make it vanilla and send photo");
    ws = await loadWorkspace(cust.id, profile);
    applyExtraction(ws, result({ order_ref: d1, link_confidence: "low", candidate_order_ids: [d1, d2], field_updates: [upd("dietary", "vanilla base", "vanilla")] }), mw.ctx);
    await saveWorkspace(ws);
    const wo = (await db.from("flags").select("id").eq("type", "which_order").eq("resolved", false).eq("customer_id", cust.id)).data ?? [];
    check("which order: flag raised, nothing applied", wo.length >= 1 && !(await order(d1)).fields.dietary && !(await order(d2)).fields.dietary);
    await chooseOrderForMessage(wo[0].id, d2);
    check("which order: the chosen order gets the stored update", (await order(d2)).fields.dietary?.value === "vanilla base");
    check("which order: the other order is untouched", !(await order(d1)).fields.dietary);
    check("which order: the question is resolved and can't be answered twice",
      (await db.from("flags").select("resolved").eq("id", wo[0].id).single()).data!.resolved === true && (await rejects(() => chooseOrderForMessage(wo[0].id, d1))) !== null);
    check("which order: an order that isn't a candidate is refused", (await rejects(() => chooseOrderForMessage(wo[0].id, a))) !== null);

    // 8. Delivered and cancelled.
    await closeOrder(d1, "cancelled");
    check("close: cancelled", (await order(d1)).status === "cancelled" && (await events(d1)).some((e) => e.actor === "owner" && e.note === "Order cancelled"));
    check("close: a closed order can't be edited", (await rejects(() => editField(d1, "flavour", "x"))) !== null);
    await closeOrder(a, "delivered");
    check("close: delivered", (await order(a)).status === "delivered");
    check("close: can't be closed twice", (await rejects(() => closeOrder(a, "cancelled"))) !== null);
  } finally {
    await db.from("customers").delete().eq("id", cust.id);
    const left = (await db.from("orders").select("id").eq("customer_id", cust.id)).data ?? [];
    check("test data cleaned up", left.length === 0);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL  check-order-actions crashed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
