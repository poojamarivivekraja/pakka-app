// Offline checks for the pipeline rules: made-up model replies, in-memory drafts,
// no database and no AI calls.
import { getProfile } from "@/config/profiles";
import type { Order, OrderFields, OrderStatus } from "@/types/db";
import { EXTRACTION_SYSTEM_PROMPT, parseModelResult } from "@/lib/pipeline/extraction-prompt";
import { createWorkspace, draftFromRows, openFlags, openPending, type MessageCtx, type OrderDraft } from "@/lib/pipeline/draft";
import { applyEditedMessage, applyExtraction } from "@/lib/pipeline/rules-apply";
import { computeBalance } from "@/lib/pipeline/rules-order";
import { flagRevokedMessage, flagUnreadableMessage } from "@/lib/pipeline/rules-events";
import { formatChatTime, parseMoney } from "@/lib/pipeline/helpers";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

const profile = getProfile("bakery");
const CUSTOMER = "cust-1";
let counter = 0;

const val = (value: string, source = "m0", confidence: "high" | "low" = "high") => ({
  value, source_message_id: source, confidence,
  updated_at: "2026-10-20T10:00:00Z", previous_value: null, edited_by_owner: false,
});

const FULL: Record<string, string> = {
  items_summary: "Birthday cake", due_date: "2026-10-31", due_time: "19:00", fulfilment: "pickup",
  price_agreed: "1800", size_or_weight: "1.5 kg", flavour: "chocolate",
};

function orderWith(values: Record<string, string>, status: OrderStatus = "needs_review"): OrderDraft {
  const fields: OrderFields = {};
  for (const [k, v] of Object.entries(values)) fields[k] = val(v);
  const order: Order = {
    id: `order-${++counter}`, customer_id: CUSTOMER, profile: "bakery", status, fields,
    updated_after_confirmation: false, created_at: "2026-10-20T10:00:00Z",
    updated_at: "2026-10-20T10:00:00Z", confirmed_at: null,
  };
  return draftFromRows(order);
}

const ws = (...orders: OrderDraft[]) => createWorkspace(CUSTOMER, profile, orders);

function msg(body: string, direction: "in" | "out" = "in", sentAt = "2026-10-22T03:35:00Z", type: MessageCtx["type"] = "text"): MessageCtx {
  return { id: `msg-${++counter}`, customerId: CUSTOMER, direction, type, body, sentAt };
}

const result = (r: Record<string, unknown>) =>
  parseModelResult({ message_type: "order_detail", order_ref: "NONE", link_confidence: "high", ...r });

const upd = (field: string, value: string, quote: string, extra: Record<string, unknown> = {}) =>
  ({ field, value, quote, agreed_by_business: false, confidence: "high", ...extra });

const openOf = (d: OrderDraft, type: string) => openFlags(d).filter((f) => f.type === type);

// ---- Rule 1: quote check
{
  const o = orderWith({});
  const w = ws(o);
  const m = msg("Need a chocolate cake");
  applyExtraction(w, result({ order_ref: o.order.id, field_updates: [
    upd("flavour", "red velvet", "red velvet"),   // not in the message
    upd("size_or_weight", "1 kg", "NEED A  chocolate"), // wrong field but quote ok (case/space normalised)
  ] }), m);
  check("rule 1: unsupported quote is dropped", !o.order.fields.flavour);
  check("rule 1: dropped update raises a low_confidence flag", openOf(o, "low_confidence").some((f) => f.data?.reason === "quote_not_found"));
  check("rule 1: quote match ignores case and extra spaces", o.order.fields.size_or_weight?.value === "1 kg");
  const o2 = orderWith({});
  applyExtraction(ws(o2), result({ order_ref: o2.order.id, field_updates: [upd("not_a_field", "x", "cake")] }), msg("cake"));
  check("rule 1: unknown field keys are dropped", Object.keys(o2.order.fields).length === 0);
}

// ---- Rule 3: empty field is filled
{
  const o = orderWith({});
  const m = msg("Chocolate, 1.5 kg. Delivery to Anna Nagar at 7 pm");
  applyExtraction(ws(o), result({ order_ref: o.order.id, field_updates: [upd("flavour", "chocolate", "Chocolate")] }), m);
  const f = o.order.fields.flavour;
  check("rule 3: empty field is filled with value, source and confidence",
    f?.value === "chocolate" && f.source_message_id === m.id && f.confidence === "high" && f.previous_value === null);
  check("rule 3: filling writes a history event", o.newEvents.some((e) => e.field === "flavour" && e.actor === "chat"));
  check("rule 3: filling an empty field makes no note or pending request", o.newNotes.length === 0 && o.newPending.length === 0);
}

// ---- Rule 4: agreed change
{
  const o = orderWith({ ...FULL });
  const m = msg("Ok red velvet eggless done, no extra charge", "out", "2026-10-22T03:50:00Z");
  applyExtraction(ws(o), result({ order_ref: o.order.id, field_updates: [
    upd("flavour", "red velvet", "red velvet", { agreed_by_business: true }),
  ] }), m);
  const f = o.order.fields.flavour;
  check("rule 4: agreed change is applied", f.value === "red velvet");
  check("rule 4: previous_value is kept", f.previous_value === "chocolate");
  check("rule 4: change is written to history (actor chat)", o.newEvents.some((e) => e.old_value === "chocolate" && e.new_value === "red velvet" && e.actor === "chat"));
  check("rule 4: update note text", o.newNotes[0]?.text === "Flavour is now red velvet. Agreed in chat by your business on 22 Oct, 9:20 am.");
  check("rule 4: agreed change raises no flag", openFlags(o).length === 0 && o.order.status === "ready");
}

// ---- Rule 4 (not agreed) and rule 5
{
  const o = orderWith({ ...FULL });
  const w = ws(o);
  const request = msg("Hey small change, make it red velvet instead", "in", "2026-10-22T03:35:00Z");
  applyExtraction(w, result({ order_ref: o.order.id, field_updates: [upd("flavour", "red velvet", "red velvet instead")] }), request);
  check("rule 4: unagreed change keeps the current value", o.order.fields.flavour.value === "chocolate");
  check("rule 4: unagreed change becomes a pending request", openPending(o).length === 1 && openPending(o)[0].requested_value === "red velvet");
  check("rule 4: pending request is not a flag", openFlags(o).length === 0);

  const reply = msg("Ok red velvet done", "out", "2026-10-22T03:50:00Z");
  applyExtraction(w, result({ message_type: "agreement", agrees_to_pending: [openPending(o)[0].id] }), reply);
  check("rule 5: later agreement applies the pending value", o.order.fields.flavour.value === "red velvet" && o.order.fields.flavour.previous_value === "chocolate");
  check("rule 5: pending request is resolved as agreed", o.pending[0].resolved === "agreed");
  check("rule 5: agreement creates an update note", o.newNotes.some((n) => n.text.startsWith("Flavour is now red velvet. Agreed in chat by your business")));
  check("rule 5: no flag for the agreed change", openFlags(o).length === 0);

  // Same reply that BOTH restates the value and agrees: one note only.
  const o2 = orderWith({ ...FULL });
  const w2 = ws(o2);
  applyExtraction(w2, result({ order_ref: o2.order.id, field_updates: [upd("flavour", "red velvet", "red velvet instead")] }), request);
  applyExtraction(w2, result({ order_ref: o2.order.id,
    field_updates: [upd("flavour", "red velvet", "red velvet", { agreed_by_business: true })],
    agrees_to_pending: [openPending(o2)[0].id] }), reply);
  check("rule 5: restating and agreeing in one message gives one note and closes the request",
    o2.newNotes.length === 1 && o2.pending[0].resolved === "agreed");

  // Refusal and customer-cannot-agree.
  const o3 = orderWith({ ...FULL });
  const w3 = ws(o3);
  applyExtraction(w3, result({ order_ref: o3.order.id, field_updates: [upd("flavour", "red velvet", "red velvet instead")] }), request);
  const pid = openPending(o3)[0].id;
  applyExtraction(w3, result({ agrees_to_pending: [pid] }), msg("yes please", "in"));
  check("rule 5: a customer message cannot agree to a pending request", o3.order.fields.flavour.value === "chocolate" && o3.pending[0].resolved === null);
  applyExtraction(w3, result({ refuses_pending: [pid] }), msg("Sorry we can't change it now", "out"));
  check("rule 5: refusal closes the request and keeps the value", o3.pending[0].resolved === "refused" && o3.order.fields.flavour.value === "chocolate");
}

// ---- Rule 6: conflict
{
  const o = orderWith({ ...FULL });
  applyExtraction(ws(o), result({ order_ref: o.order.id, conflicts: [{ field: "price_agreed", values: ["1800", "1600"], detail: "x" }] }), msg("Btw you said 1600 na?"));
  const flags = openOf(o, "conflict");
  check("rule 6: conflict creates a conflict flag", flags.length === 1 && flags[0].detail === "Price agreed: 1800 vs 1600. Check the chat.");
  check("rule 6: conflict changes nothing", o.order.fields.price_agreed.value === "1800" && o.newEvents.length === 0);
  check("rule 6: conflict makes the order needs_review", o.order.status === "needs_review");
}

// ---- Rule 7: low confidence
{
  const o = orderWith({});
  applyExtraction(ws(o), result({ order_ref: o.order.id, field_updates: [upd("due_date", "2026-10-30", "next friday", { confidence: "low" })] }), msg("next friday please"));
  check("rule 7: low-confidence update is applied", o.order.fields.due_date?.value === "2026-10-30" && o.order.fields.due_date.confidence === "low");
  check("rule 7: low-confidence update also raises a flag", openOf(o, "low_confidence").length === 1);
}

// ---- Rule 8-9, 12: payments and images
{
  const o = orderWith({ ...FULL, advance_requested: "900" });
  const w = ws(o);
  const m = msg("[image]", "in", "2026-10-22T04:10:00Z", "image");
  applyExtraction(w, result({ message_type: "payment", order_ref: o.order.id, image_role: "payment_screenshot",
    payment: { amount: "₹500", reference: "UPI123", payee: "Kavya's Bakes", date: "22 Oct 2026" } }), m);
  const att = o.newAttachments[0];
  check("rule 8: payment attachment stores amount, reference, payee and date",
    att?.kind === "payment_screenshot" && att.extracted?.amount === 500 && att.extracted?.reference === "UPI123" && att.extracted?.payee === "Kavya's Bakes" && att.extracted?.date === "22 Oct 2026");
  check("rule 8: payment is unverified until the owner marks it", att.marked_received === false);
  const mm = openOf(o, "payment_mismatch");
  check("rule 8: amount differing from advance_requested raises payment_mismatch", mm.length === 1 && mm[0].detail === "Screenshot shows ₹500, but the advance asked was ₹900.");
  check("rule 12: balance = price - screenshots", computeBalance(o.order.fields, o.attachments) === 1300);
  check("rule 8: mismatch makes the order needs_review", o.order.status === "needs_review");

  const ok = orderWith({ ...FULL, advance_requested: "700" });
  applyExtraction(ws(ok), result({ message_type: "payment", order_ref: ok.order.id, image_role: "payment_screenshot", payment: { amount: "700", reference: null, payee: null, date: null } }), m);
  check("rule 8: matching advance raises no flag (unverified payment is not a flag)", openFlags(ok).length === 0 && ok.order.status === "ready");

  const none = orderWith({ ...FULL });
  applyExtraction(ws(none), result({ order_ref: none.order.id, image_role: "payment_screenshot", payment: { amount: "500" } }), m);
  check("rule 8: no advance_requested means no mismatch check", openOf(none, "payment_mismatch").length === 0);

  const r = orderWith({ ...FULL });
  applyExtraction(ws(r), result({ order_ref: r.order.id, image_role: "reference_image", image_description: "A jungle theme cake with animals." }), m);
  check("rule 9: reference image attachment keeps the description", r.newAttachments[0]?.kind === "reference_image" && r.newAttachments[0].description === "A jungle theme cake with animals.");
  check("rule 12: balance is null without a price", computeBalance({}, []) === null);
}

// ---- Rule 2: NEW and which_order
{
  const w = ws();
  const m = msg("Cake for 31st please");
  const { draft } = applyExtraction(w, result({ order_ref: "NEW", field_updates: [upd("occasion", "anniversary", "Cake")] }), m);
  check("rule 2: NEW creates an order with the active profile", !!draft && w.orders.length === 1 && draft.order.profile === "bakery" && draft.isNew);

  const a = orderWith({ ...FULL });
  const b = orderWith({ ...FULL });
  const w2 = ws(a, b);
  applyExtraction(w2, result({ order_ref: a.order.id, link_confidence: "low", candidate_order_ids: [a.order.id, b.order.id], field_updates: [upd("flavour", "vanilla", "vanilla")] }), msg("make it vanilla"));
  const flag = a.flags.find((f) => f.type === "which_order");
  check("rule 2: low link confidence raises which_order with candidate ids", !!flag && (flag.data?.candidate_order_ids as string[]).length === 2);
  check("rule 2: nothing is applied until the owner picks", a.order.fields.flavour.value === "chocolate" && b.order.fields.flavour.value === "chocolate" && a.newPending.length === 0);
}

// ---- Rule 10: edit, revoke, unsupported
{
  const original = msg("Hi, 2 kg butterscotch cake for office farewell", "in", "2026-10-21T08:30:00Z");
  const o = orderWith({});
  o.order.fields.size_or_weight = val("2 kg", original.id);
  const w = ws(o);
  applyEditedMessage(w, result({ order_ref: o.order.id, field_updates: [upd("size_or_weight", "1.5 kg", "1.5 kg butterscotch")] }),
    { ...original, body: "Hi, 1.5 kg butterscotch cake for office farewell" });
  check("rule 10: edit replaces the value from the original message", o.order.fields.size_or_weight.value === "1.5 kg" && o.newPending.length === 0);
  check("rule 10: edit adds the note 'Customer edited a message'", o.newNotes.some((n) => n.text === "Customer edited a message"));

  const o2 = orderWith({ ...FULL });
  o2.order.fields.flavour = val("chocolate", "src-msg");
  const w2 = ws(o2);
  flagRevokedMessage(w2, "src-msg", "revoke-msg");
  check("rule 10: revoke adds a message_deleted flag", openOf(o2, "message_deleted").length === 1);
  check("rule 10: revoke lowers confidence on fields from that message", o2.order.fields.flavour.confidence === "low" && o2.order.fields.price_agreed.confidence === "high");

  const o3 = orderWith({ ...FULL });
  const w3 = ws(o3);
  flagUnreadableMessage(w3, "bad-msg");
  check("rule 10: unsupported message adds message_unreadable flag", o3.flags.some((f) => f.type === "message_unreadable" && f.detail === "1 message couldn't be read. Check WhatsApp."));
}

// ---- Rule 10: edit linking and the business-replied rule
{
  const edited = (original: MessageCtx, text: string) => ({ ...original, body: text });
  const setup = (direction: "in" | "out" = "in") => {
    const original = msg("Hi, 2 kg butterscotch cake", direction, "2026-10-21T08:30:00Z");
    const o = orderWith({});
    o.order.fields.size_or_weight = val("2 kg", original.id);
    return { original, o, w: ws(o) };
  };
  const sizeUpdate = (agreed = false) => upd("size_or_weight", "1.5 kg", "1.5 kg butterscotch", { agreed_by_business: agreed });

  for (const ref of ["NEW", "NONE"]) {
    const { original, o, w } = setup();
    applyEditedMessage(w, result({ order_ref: ref, field_updates: [sizeUpdate()] }), edited(original, "Hi, 1.5 kg butterscotch cake"));
    check(`rule 10: edit where the model says ${ref} still goes to the order it came from`,
      w.orders.length === 1 && o.order.fields.size_or_weight.value === "1.5 kg" && o.newPending.length === 0);
  }

  {
    const { original, o, w } = setup();
    applyEditedMessage(w, result({ order_ref: "NEW", link_confidence: "low", candidate_order_ids: ["x"], field_updates: [sizeUpdate()] }),
      edited(original, "Hi, 1.5 kg butterscotch cake"));
    check("rule 10: a low-confidence link on an edit does not stop it applying", o.order.fields.size_or_weight.value === "1.5 kg" && !o.flags.some((f) => f.type === "which_order"));
  }

  {
    const { original, o, w } = setup();
    applyEditedMessage(w, result({ order_ref: o.order.id, field_updates: [sizeUpdate(true)] }),
      edited(original, "Hi, 1.5 kg butterscotch cake"), { businessRepliedSince: true });
    check("rule 10: after a business reply, an edited value is not applied", o.order.fields.size_or_weight.value === "2 kg");
    check("rule 10: after a business reply, it becomes a pending request", openPending(o).length === 1 && openPending(o)[0].requested_value === "1.5 kg");
    check("rule 10: after a business reply, the edit note is still added", o.newNotes.some((n) => n.text === "Customer edited a message"));
    check("rule 10: an edit never counts as the business agreeing", o.newNotes.every((n) => !n.text.includes("Agreed in chat")) && openFlags(o).every((f) => f.type !== "conflict"));
  }

  {
    const { original, o, w } = setup("out");
    applyEditedMessage(w, result({ order_ref: o.order.id, field_updates: [sizeUpdate(true)] }),
      edited(original, "Hi, 1.5 kg butterscotch cake"), { businessRepliedSince: true });
    check("rule 10: the business editing its own message applies directly", o.order.fields.size_or_weight.value === "1.5 kg");
  }

  {
    const original = msg("Hi, 2 kg butterscotch cake", "in", "2026-10-21T08:30:00Z");
    const w = ws();
    applyEditedMessage(w, result({ order_ref: "NEW", field_updates: [upd("size_or_weight", "1.5 kg", "1.5 kg butterscotch")] }), edited(original, "Hi, 1.5 kg butterscotch cake"));
    check("rule 10: an edit of a message that filled in no order is processed normally", w.orders.length === 1 && w.orders[0].isNew);
  }
}

// ---- Rule 11: missing fields
{
  const o = orderWith({});
  const w = ws(o);
  applyExtraction(w, result({ order_ref: o.order.id, field_updates: [upd("flavour", "chocolate", "chocolate")] }), msg("chocolate"));
  const missing = openOf(o, "missing_field").map((f) => f.data?.field).sort().join();
  check("rule 11: one missing_field flag per missing required field", missing === "due_date,due_time,fulfilment,items_summary,price_agreed,size_or_weight");
  applyExtraction(w, result({ order_ref: o.order.id, field_updates: [upd("size_or_weight", "1 kg", "1 kg")] }), msg("1 kg"));
  check("rule 11: no duplicate flags after a second message", openOf(o, "missing_field").length === 5);
  check("rule 11: filling a field resolves its flag", !openOf(o, "missing_field").some((f) => f.data?.field === "size_or_weight"));
  applyExtraction(w, result({ order_ref: o.order.id, field_updates: [upd("fulfilment", "delivery", "delivery")] }), msg("delivery"));
  check("rule 11: delivery makes address required", openOf(o, "missing_field").some((f) => f.data?.field === "address"));
  applyExtraction(w, result({ order_ref: o.order.id, field_updates: [upd("fulfilment", "pickup", "pickup", { agreed_by_business: true })] }), msg("pickup then", "out"));
  check("rule 11: switching back to pickup resolves the address flag", !openOf(o, "missing_field").some((f) => f.data?.field === "address"));
}

// ---- Rules 13-14: status
{
  const o = orderWith({ ...FULL });
  applyExtraction(ws(o), result({ order_ref: o.order.id, field_updates: [upd("dietary", "eggless", "eggless")] }), msg("eggless"));
  check("rule 13: all required fields and no flags -> ready", o.order.status === "ready");

  const blank = orderWith({});
  applyExtraction(ws(blank), result({ order_ref: blank.order.id, field_updates: [upd("flavour", "x", "x")] }), msg("x"));
  check("rule 13: any open flag -> needs_review", blank.order.status === "needs_review");

  const done = orderWith({ ...FULL }, "confirmed");
  applyExtraction(ws(done), result({ order_ref: done.order.id, conflicts: [{ field: "flavour", values: ["a", "b"] }] }), msg("a or b?"));
  check("rule 13: confirmed orders keep their status", done.order.status === "confirmed");

  const c = orderWith({ ...FULL }, "confirmed");
  applyExtraction(ws(c), result({ order_ref: c.order.id, field_updates: [upd("flavour", "red velvet", "red velvet", { agreed_by_business: true })] }), msg("red velvet done", "out"));
  check("rule 14: agreed change keeps the order confirmed", c.order.status === "confirmed" && c.order.fields.flavour.value === "red velvet");
  check("rule 14: updated_after_confirmation is set", c.order.updated_after_confirmation === true);

  const d = orderWith({ ...FULL }, "delivered");
  applyExtraction(ws(d), result({ order_ref: d.order.id, conflicts: [{ field: "flavour", values: ["a", "b"] }] }), msg("a or b?"));
  check("rule 13: delivered orders keep their status", d.order.status === "delivered");
}

// ---- Prompt
check("prompt: tells the model about edited messages", EXTRACTION_SYSTEM_PROMPT.includes("edit_of_earlier_message"));
check("prompt: includes the pickup/delivery time rule", EXTRACTION_SYSTEM_PROMPT.includes("hours 1 to 8 mean pm") && EXTRACTION_SYSTEM_PROMPT.includes('"around 6"'));

// ---- Helpers
check("helpers: parseMoney", parseMoney("₹1,400") === 1400 && parseMoney("Rs. 700/-") === 700 && parseMoney("abc") === null);
check("helpers: chat time is shown in India time", formatChatTime("2026-10-22T03:50:00Z") === "22 Oct, 9:20 am");

process.exit(failed ? 1 : 0);
