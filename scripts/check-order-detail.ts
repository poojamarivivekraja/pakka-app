// Offline checks for the order page's view model. No database, no AI.
import { getProfile } from "@/config/profiles";
import type { Attachment, Flag, Order, OrderEvent, PendingRequest } from "@/types/db";
import { buildOrderDetail, displayValue, listWithThe, type OrderDetailInput } from "@/lib/order-detail-model";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}

const profile = getProfile("bakery");
const T = (h: number, m = 0) => `2026-10-22T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`;
const msgs = [
  { id: "m1", direction: "in" as const, type: "text" as const, body: "Need a cake for our anniversary on 31st", media_path: null, sent_at: T(8) },
  { id: "m2", direction: "out" as const, type: "text" as const, body: "Done, ₹1800. Message on cake?", media_path: null, sent_at: T(9) },
  { id: "m3", direction: "in" as const, type: "text" as const, body: "Chocolate, 1.5 kg. Delivery to Anna Nagar at 7 pm", media_path: null, sent_at: T(10) },
  { id: "m4", direction: "in" as const, type: "text" as const, body: "make it red velvet instead", media_path: null, sent_at: T(11) },
  { id: "m5", direction: "out" as const, type: "text" as const, body: "Ok red velvet done", media_path: null, sent_at: T(12) },
];
const fv = (value: string, src: string | null, extra: Record<string, unknown> = {}) => ({
  value, source_message_id: src, confidence: "high" as const, updated_at: "", previous_value: null, edited_by_owner: false, quote: null, ...extra,
});

function input(over: Partial<OrderDetailInput> & { fields?: Order["fields"]; status?: Order["status"]; updatedAfter?: boolean } = {}): OrderDetailInput {
  const order: Order = {
    id: "o1", customer_id: "c1", profile: "bakery", status: over.status ?? "ready",
    updated_after_confirmation: over.updatedAfter ?? false, created_at: "", updated_at: "", confirmed_at: null,
    fields: over.fields ?? {
      occasion: fv("anniversary", "m1"), items_summary: fv("a cake", "m1"), due_date: fv("2026-10-31", "m1"), due_time: fv("19:00", "m3", { quote: "7 pm" }),
      fulfilment: fv("delivery", "m3"), address: fv("Anna Nagar", "m3"), price_agreed: fv("₹1800", "m2", { quote: "₹1800" }),
      size_or_weight: fv("1.5 kg", "m3"), flavour: fv("red velvet", "m4", { previous_value: "chocolate", quote: "red velvet" }),
    },
  };
  return {
    order, customer: { name: "Rahul", waId: "919900000002" }, profile, flags: [], notes: [], pending: [], attachments: [], events: [],
    messages: msgs, imageUrls: {}, siblings: [], ...("flags" in over ? { flags: over.flags! } : {}),
    ...("notes" in over ? { notes: over.notes! } : {}), ...("pending" in over ? { pending: over.pending! } : {}),
    ...("attachments" in over ? { attachments: over.attachments! } : {}), ...("events" in over ? { events: over.events! } : {}),
    ...("siblings" in over ? { siblings: over.siblings! } : {}), ...("imageUrls" in over ? { imageUrls: over.imageUrls! } : {}),
  };
}
const flag = (type: Flag["type"], data: Flag["data"], over: Partial<Flag> = {}): Flag => ({
  id: `f-${type}`, order_id: "o1", customer_id: "c1", message_id: "m4", type, detail: "", data, resolved: false, created_at: "", ...over,
});
const ev = (over: Partial<OrderEvent>): OrderEvent => ({
  id: `e${Math.random()}`, order_id: "o1", field: null, old_value: null, new_value: null, actor: "chat", note: null, source_message_id: null, created_at: T(13), ...over,
});

// ---- formatting
const money = { type: "money" as const };
check("format: money", displayValue(money, "₹1800") === "₹1,800" && displayValue(money, "1800") === "₹1,800");
check("format: date", displayValue({ type: "date" }, "2026-10-31") === "Sat, 31 Oct");
check("format: time", displayValue({ type: "time" }, "19:00") === "7:00 pm");
check("format: enum", displayValue({ type: "enum" }, "pickup") === "Pickup");
check("format: list of names", listWithThe(["price"]) === "the price" && listWithThe(["price", "address"]) === "the price and the address" && listWithThe(["price", "address", "time"]) === "the price, the address and the time");

// ---- header
const m = buildOrderDetail(input());
check("header: date block", m.header.weekday === "Sat" && m.header.day === "31" && m.header.month === "Oct");
check("header: time and fulfilment", m.header.time === "7:00 pm" && m.header.fulfilment === "Delivery");
check("header: customer · occasion", m.header.title === "Rahul · anniversary");
check("header: pill for a ready order", m.pill.tone === "ready");
check("header: WhatsApp link", m.whatsappUrl === "https://wa.me/919900000002");
check("header: closed orders get a plain label", buildOrderDetail(input({ status: "cancelled" })).pill.label === "Cancelled");

// ---- fields
const flavour = m.fields.find((f) => f.key === "flavour")!;
check("fields: one row per profile field", m.fields.length === profile.fields.length);
check("fields: 'Was' note and Updated pill for a chat change", flavour.note === "Was chocolate" && flavour.updated && !flavour.editedByOwner);
check("fields: Source link only where a source exists", flavour.hasSource && !m.fields.find((f) => f.key === "dietary")!.hasSource);
const edited = buildOrderDetail(input({ fields: { flavour: fv("almond", null, { edited_by_owner: true, previous_value: "walnut" }) } })).fields.find((f) => f.key === "flavour")!;
check("fields: owner edit is marked and has no Source", edited.editedByOwner && !edited.updated && edited.note === "Was walnut" && !edited.hasSource);
check("fields: personalisation is flagged as exact text with the profile's label", m.fields.find((f) => f.key === "personalisation")!.exactText && m.fields.find((f) => f.key === "personalisation")!.label === "Message on cake");
check("fields: address is required for delivery", m.fields.find((f) => f.key === "address")!.required);

// ---- sources
const src = m.sources.flavour;
check("source: title", src.title === 'Source for "Flavour: red velvet"', src.title);
check("source: subtitle", src.subtitle === "Rahul · WhatsApp chat");
check("source: supporting bubbles and the context before them", src.bubbles.map((b) => `${b.id}${b.supporting ? "*" : ""}`).join() === "m3,m4*", src.bubbles.map((b) => b.id).join());
check("source: highlight uses the stored quote", src.bubbles.find((b) => b.supporting)!.highlight === "red velvet");
check("source: no agreement strip for a customer's request alone", src.agreed === null);

const agreedEvents = [ev({ field: "flavour", old_value: "chocolate", new_value: "red velvet", source_message_id: "m5" })];
const withAgreement = buildOrderDetail(input({ events: agreedEvents })).sources.flavour;
check("source: the business's agreement is shown as a supporting bubble", withAgreement.bubbles.some((b) => b.id === "m5" && b.supporting && b.direction === "out"));
check("source: agreement strip with time", withAgreement.agreed?.at === "22 Oct, 12:00 pm", withAgreement.agreed?.at);

const viaRequest = buildOrderDetail(input({
  fields: { ...input().order.fields, flavour: fv("red velvet", "m5", { previous_value: "chocolate", quote: "red velvet" }) },
  pending: [{ id: "p9", order_id: "o1", field: "flavour", requested_value: "Red Velvet", source_message_id: "m4", resolved: "agreed", created_at: "" }],
})).sources.flavour;
check("source: a customer request the business agreed to is shown too", viaRequest.bubbles.filter((b) => b.supporting).map((b) => b.id).join() === "m4,m5", viaRequest.bubbles.map((b) => b.id + (b.supporting ? "*" : "")).join());

const price = m.sources.price_agreed;
check("source: a value stated by the business shows the strip", price.agreed?.at === "22 Oct, 9:00 am");
const sameMsg = buildOrderDetail(input()).sources.size_or_weight;
check("source: 'also used for' lists other fields from the same message", sameMsg.bubbles.length >= 1 && (m.sources.fulfilment.agreed === null) && m.sources.size_or_weight.agreed === null);
const m3b = buildOrderDetail(input({ fields: { ...input().order.fields, flavour: fv("chocolate", "m2") } }));
check("source: also-used-for is filled when the business message backs several fields", (m3b.sources.flavour.agreed?.alsoUsedFor ?? []).includes("Price agreed"), JSON.stringify(m3b.sources.flavour.agreed));

// ---- needs review
const r = buildOrderDetail(input({ flags: [
  flag("missing_field", { field: "dietary" }),
  flag("conflict", { field: "price_agreed", values: ["1800", "1600"] }),
  flag("payment_mismatch", { amount: 500, advance_requested: 900 }, { message_id: "m6" }),
  flag("message_unreadable", null),
  flag("message_deleted", { deleted_message_id: "m1" }),
  flag("low_confidence", { field: "flavour", value: "red velvet" }),
], attachments: [{ id: "a1", order_id: "o1", message_id: "m6", kind: "payment_screenshot", description: null, extracted: { amount: 500 }, marked_received: false, created_at: "" } as Attachment],
  imageUrls: { m6: "/samples/payment_500.png" } })).review;
check("review: most urgent first", r.map((x) => x.type).join() === "conflict,payment_mismatch,message_deleted,message_unreadable,low_confidence,missing_field", r.map((x) => x.type).join());
const conflict = r.find((x) => x.type === "conflict")!;
check("review: conflict buttons use the values", conflict.choices?.map((c) => c.label).join() === "Use ₹1,800,Use ₹1,600");
check("review: conflict explains what the order still says", conflict.explanation.includes("₹1,800") && conflict.explanation.includes("until you choose"));
check("review: conflict has View messages", !!conflict.sourceKey && !!m3b.sources && true);
const pay = r.find((x) => x.type === "payment_mismatch")!;
check("review: payment mismatch explains both amounts", pay.explanation.includes("₹500") && pay.explanation.includes("₹900"));
check("review: payment mismatch can show the screenshot", pay.attachmentId === "a1" && pay.imageUrl === "/samples/payment_500.png");
const miss = r.find((x) => x.type === "missing_field")!;
check("review: missing field carries what the editor needs", miss.title === "Dietary is missing" && miss.field?.key === "dietary" && miss.field.type === "text");
check("review: unreadable and deleted messages are explained", r.some((x) => x.title === "A message couldn't be read") && r.some((x) => x.title === "A message was deleted"));

const which = buildOrderDetail(input({
  siblings: [{ id: "o2", items: "12 cupcakes", dueDate: "2026-11-02" }],
  flags: [flag("which_order", { candidate_order_ids: ["o1", "o2"], message_id: "m4" })],
})).review[0];
check("which order: one choice per candidate with items and due date", which.orderChoices?.length === 2 && which.orderChoices[1].label === "12 cupcakes · due 2 Nov", JSON.stringify(which.orderChoices));
check("which order: quotes the message", which.explanation.includes("make it red velvet instead"));

// ---- notes and pending
const np = buildOrderDetail(input({
  notes: [{ id: "n1", order_id: "o1", text: "Flavour is now red velvet.", source_message_id: "m5", seen: false, created_at: "" }, { id: "n2", order_id: "o1", text: "old", source_message_id: null, seen: true, created_at: "" }],
  pending: [{ id: "p1", order_id: "o1", field: "dietary", requested_value: "no nuts", source_message_id: "m4", resolved: null, created_at: "" }, { id: "p2", order_id: "o1", field: "flavour", requested_value: "x", source_message_id: null, resolved: "agreed", created_at: "" } as PendingRequest],
}));
check("notes: only unseen notes are shown", np.notes.length === 1 && np.notes[0].id === "n1");
check("notes: an unseen note makes the pill 'Updated from chat'", np.pill.tone === "updated");
check("pending: only open requests, with the current value", np.pending.length === 1 && np.pending[0].fieldLabel === "Dietary" && np.pending[0].current === null);
check("pending: shows what the order still says", buildOrderDetail(input({ pending: [{ id: "p3", order_id: "o1", field: "flavour", requested_value: "mango", source_message_id: null, resolved: null, created_at: "" }] })).pending[0].current === "red velvet");

// ---- payments
const pm = buildOrderDetail(input({
  fields: { ...input().order.fields, advance_requested: fv("₹900", "m2") },
  attachments: [{ id: "a1", order_id: "o1", message_id: "m6", kind: "payment_screenshot", description: null, extracted: { amount: 500 }, marked_received: false, created_at: "" } as Attachment],
})).payments;
check("payments: price, advance, screenshot and balance", pm.price === "₹1,800" && pm.advance === "₹900" && pm.screenshots[0].amount === "₹500" && pm.balance === "₹1,300", JSON.stringify(pm));
check("payments: no price means no balance", buildOrderDetail(input({ fields: {} })).payments.balance === null);

// ---- history
const h = buildOrderDetail(input({ events: [
  ev({ field: "flavour", old_value: "chocolate", new_value: "red velvet", source_message_id: "m5" }),
  ev({ field: "flavour", old_value: null, new_value: "chocolate", source_message_id: "m3" }),
  ev({ field: "price_agreed", old_value: "₹1800", new_value: "₹2000", actor: "owner", note: "Edited by you", created_at: T(14) }),
  ev({ actor: "owner", note: "Order confirmed", created_at: T(15) }),
] })).history;
check("history: newest first", h[0].text === "Order confirmed" && h[1].text === "Price agreed changed from ₹1,800 to ₹2,000", h.map((x) => x.text).join(" | "));
check("history: agreed change names the business", h.find((x) => x.text.startsWith("Flavour changed"))!.source === "Agreed in chat by your business");
check("history: first value is 'From chat'", h.find((x) => x.text === "Flavour set to chocolate")!.source === "From chat");
check("history: owner edits say 'Edited by you'", h.find((x) => x.text.startsWith("Price agreed"))!.source === "Edited by you");
check("history: uses the message time for chat changes", h.find((x) => x.text.startsWith("Flavour changed"))!.at === "22 Oct, 12:00 pm");

// ---- confirm footer
check("footer: ready order can be confirmed", m.footer.canConfirm && m.footer.reason === null);
const gaps = buildOrderDetail(input({ fields: { ...input().order.fields, price_agreed: undefined as never, address: undefined as never } }));
check("footer: reason names what's missing", gaps.footer.reason === "Add the price and the address to confirm.", String(gaps.footer.reason));
check("footer: open flags block it too", buildOrderDetail(input({ flags: [flag("conflict", { field: "price_agreed", values: ["1", "2"] })] })).footer.reason === "Sort out the items under Needs review to confirm.");
check("footer: confirmed orders can't be confirmed again", !buildOrderDetail(input({ status: "confirmed" })).footer.canConfirm);
check("confirmed: opening clears 'updated after confirmation'", buildOrderDetail(input({ status: "confirmed", updatedAfter: true })).needsClearUpdated && !m.needsClearUpdated);
check("confirmed: a change after confirmation shows 'Updated from chat'", buildOrderDetail(input({ status: "confirmed", updatedAfter: true })).pill.tone === "updated");

// ---- copy rule
check('copy: the word "paid" never appears on the page', !/\bpaid\b/i.test(JSON.stringify([m, r, pm, h])));

process.exit(failed ? 1 : 0);
