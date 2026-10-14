import type { Attachment, Flag, FlagType, Message, Order, OrderEvent, PendingRequest, UpdateNote } from "@/types/db";
import type { FieldType, Profile, ProfileField } from "@/types/profile";
import { isRequired, missingRequiredFields } from "@/config/profiles";
import type { PillTone } from "@/components/StatusPill";
import { formatChatStamp, formatRupees } from "@/lib/format";
import { dayOfMonth, formatTime12, isIsoDate, monthShort, weekdayShort } from "@/lib/dates";
import { pillTone } from "@/lib/orders-view";
import { computeBalance } from "@/lib/pipeline/rules-order";
import { parseMoney } from "@/lib/pipeline/helpers";

// Turns one order's stored rows into exactly what the order page shows. Pure (no database,
// no server-only imports), so it is tested offline and can be sent to client components.

export type OrderDetailInput = {
  order: Order;
  customer: { name: string | null; waId: string };
  profile: Profile;
  flags: Flag[];
  notes: UpdateNote[];
  pending: PendingRequest[];
  attachments: Attachment[];
  events: OrderEvent[];
  /** Every message in the customer's chat, any order. */
  messages: Pick<Message, "id" | "direction" | "type" | "body" | "media_path" | "sent_at">[];
  /** Viewable image address per message id (for screenshots). */
  imageUrls: Record<string, string>;
  /** The customer's other open orders, to label "Which order?" choices. */
  siblings: { id: string; items: string | null; dueDate: string | null }[];
};

export type FieldRowModel = {
  key: string;
  label: string;
  shortLabel: string;
  type: FieldType;
  options?: string[];
  /** Raw stored value (what the editor starts with). */
  raw: string | null;
  display: string | null;
  required: boolean;
  note: string | null;
  updated: boolean;
  editedByOwner: boolean;
  lowConfidence: boolean;
  hasSource: boolean;
  exactText: boolean;
};

export type SourceBubble = {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  imageUrl: string | null;
  at: string;
  supporting: boolean;
  /** The words to bold and underline inside the body, if any. */
  highlight: string | null;
};

export type SourceModel = {
  title: string;
  subtitle: string;
  bubbles: SourceBubble[];
  /** Set when the business's own words back this value. */
  agreed: { at: string; alsoUsedFor: string[] } | null;
};

export type ReviewItem = {
  id: string;
  type: FlagType;
  title: string;
  explanation: string;
  field?: { key: string; label: string; shortLabel: string; type: FieldType; options?: string[]; raw: string | null };
  choices?: { value: string; label: string }[];
  orderChoices?: { orderId: string; label: string }[];
  attachmentId?: string;
  imageUrl?: string;
  /** Key into `sources` for "View messages". */
  sourceKey?: string;
};

export type HistoryEntry = { id: string; at: string; text: string; source: string };

export type OrderDetailModel = {
  id: string;
  status: Order["status"];
  closed: boolean;
  pill: { tone: PillTone; label?: string };
  header: { weekday: string | null; day: string | null; month: string | null; time: string | null; fulfilment: string | null; title: string };
  whatsappUrl: string;
  notes: { id: string; text: string }[];
  pending: { id: string; fieldLabel: string; requested: string; current: string | null }[];
  review: ReviewItem[];
  fields: FieldRowModel[];
  payments: {
    price: string | null;
    advance: string | null;
    screenshots: { id: string; amount: string; received: boolean; imageUrl: string | null }[];
    balance: string | null;
  };
  history: HistoryEntry[];
  sources: Record<string, SourceModel>;
  footer: { canConfirm: boolean; reason: string | null };
  needsClearUpdated: boolean;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.toLowerCase();

/** How a stored value reads on screen: ₹1,800, Sat, 31 Oct, 5:00 pm. */
export function displayValue(field: Pick<ProfileField, "type">, value: string): string {
  if (field.type === "money") {
    const n = parseMoney(value);
    return n === null ? value : formatRupees(n);
  }
  if (field.type === "date" && isIsoDate(value)) return `${weekdayShort(value)}, ${dayOfMonth(value)} ${monthShort(value)}`;
  if (field.type === "time") return formatTime12(value) ?? value;
  if (field.type === "enum") return cap(value);
  return value;
}

/** "the price", "the price and the address", "the price, the address and the time". */
export function listWithThe(names: string[]): string {
  const withThe = names.map((n) => `the ${n}`);
  return withThe.length <= 1 ? withThe.join("") : `${withThe.slice(0, -1).join(", ")} and ${withThe[withThe.length - 1]}`;
}

const REVIEW_ORDER: FlagType[] = ["which_order", "conflict", "payment_mismatch", "message_deleted", "message_unreadable", "low_confidence", "missing_field"];

export function buildOrderDetail(input: OrderDetailInput): OrderDetailModel {
  const { order, customer, profile, flags, events, messages } = input;
  const f = order.fields;
  const customerName = customer.name?.trim() || `+${customer.waId}`;
  const waUrl = `https://wa.me/${customer.waId}`;
  const field = (key: string) => profile.fields.find((p) => p.key === key);
  const labelOf = (key: unknown) => field(String(key))?.label ?? String(key);
  const shown = (key: string, value: string) => { const p = field(key); return p ? displayValue(p, value) : value; };
  const msgById = new Map(messages.map((m) => [m.id, m]));
  const sorted = [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at));

  // ---- sources ("Source ↗" sheets)
  function bubbles(supportingIds: string[], highlightFor: (id: string) => string | null, extraBefore = true): SourceBubble[] {
    const ids = new Set(supportingIds.filter((id) => msgById.has(id)));
    const firstIdx = Math.min(...[...ids].map((id) => sorted.findIndex((m) => m.id === id)));
    const shownMsgs = sorted.filter((m, i) => ids.has(m.id) || (extraBefore && i === firstIdx - 1));
    return shownMsgs.map((m) => ({
      id: m.id, direction: m.direction, type: m.type, body: m.body,
      imageUrl: input.imageUrls[m.id] ?? null, at: formatChatStamp(m.sent_at),
      supporting: ids.has(m.id), highlight: ids.has(m.id) ? highlightFor(m.id) : null,
    }));
  }

  const sources: Record<string, SourceModel> = {};
  for (const p of profile.fields) {
    const v = f[p.key];
    if (!v || v.edited_by_owner || !v.source_message_id) continue;
    const ids = [v.source_message_id];
    // A change the business agreed to later: show that agreement too.
    const agreement = [...events].reverse().find((e) => e.field === p.key && e.actor === "chat" && e.new_value === v.value && e.source_message_id && e.source_message_id !== v.source_message_id);
    if (agreement?.source_message_id && msgById.get(agreement.source_message_id)?.direction === "out") ids.push(agreement.source_message_id);
    // The customer's request the business later agreed to is part of the evidence too.
    for (const pr of input.pending) {
      if (pr.field === p.key && pr.resolved === "agreed" && pr.source_message_id && pr.requested_value.trim().toLowerCase() === v.value.trim().toLowerCase()) ids.push(pr.source_message_id);
    }
    const list = bubbles([...new Set(ids)], () => v.quote?.trim() || v.value);
    if (list.every((b) => !b.supporting)) continue; // source message no longer exists
    const businessMsg = list.find((b) => b.supporting && b.direction === "out");
    const others = profile.fields.filter((q) => q.key !== p.key && f[q.key]?.source_message_id === v.source_message_id).map((q) => q.label);
    sources[p.key] = {
      title: `Source for "${p.label}: ${displayValue(p, v.value)}"`,
      subtitle: `${customerName} · WhatsApp chat`,
      bubbles: list,
      agreed: businessMsg ? { at: businessMsg.at, alsoUsedFor: others } : null,
    };
  }

  // ---- fields card
  const fields: FieldRowModel[] = profile.fields.map((p) => {
    const v = f[p.key];
    return {
      key: p.key, label: p.label, shortLabel: p.short_label, type: p.type, options: p.options,
      raw: v?.value ?? null,
      display: v ? displayValue(p, v.value) : null,
      required: isRequired(p, f),
      note: v?.previous_value ? `Was ${displayValue(p, v.previous_value)}` : null,
      updated: !!v?.previous_value && !v.edited_by_owner,
      editedByOwner: !!v?.edited_by_owner,
      lowConfidence: v?.confidence === "low",
      hasSource: !!sources[p.key],
      exactText: p.type === "exact_text",
    };
  });

  // ---- needs review
  const openFlags = flags.filter((x) => !x.resolved);
  const review: ReviewItem[] = [];
  for (const flag of [...openFlags].sort((a, b) => REVIEW_ORDER.indexOf(a.type) - REVIEW_ORDER.indexOf(b.type))) {
    const key = flag.data?.field as string | undefined;
    const p = key ? field(key) : undefined;
    const fieldInfo = p ? { key: p.key, label: p.label, shortLabel: p.short_label, type: p.type, options: p.options, raw: f[p.key]?.value ?? null } : undefined;
    const base = { id: flag.id, type: flag.type, field: fieldInfo };

    if (flag.type === "missing_field" && p) {
      review.push({ ...base, title: `${p.label} is missing`, explanation: `Pakka couldn't find the ${p.short_label} in the chat.` });
    } else if (flag.type === "conflict" && p) {
      const values = ((flag.data?.values as string[] | undefined) ?? []).slice(0, 2);
      review.push({
        ...base, title: `${p.label}: two different values`,
        explanation: `The chat gives two different values. The order still says ${f[p.key] ? displayValue(p, f[p.key].value) : "nothing"} until you choose.`,
        choices: values.map((v) => ({ value: v, label: `Use ${displayValue(p, v)}` })),
        sourceKey: `flag:${flag.id}`,
      });
    } else if (flag.type === "payment_mismatch") {
      const att = input.attachments.find((a) => a.kind === "payment_screenshot" && a.message_id === flag.message_id);
      const got = parseMoney(flag.data?.amount as number | undefined);
      const asked = parseMoney(flag.data?.advance_requested as number | undefined);
      review.push({
        ...base, title: "Payment amount differs",
        explanation: got !== null && asked !== null
          ? `The screenshot shows ${formatRupees(got)}, but the advance you asked for was ${formatRupees(asked)}. Check the screenshot.`
          : "The screenshot doesn't match the advance you asked for. Check the screenshot.",
        attachmentId: att?.id, imageUrl: att ? input.imageUrls[att.message_id] : undefined,
      });
    } else if (flag.type === "which_order") {
      const candidates = (flag.data?.candidate_order_ids as string[] | undefined) ?? [];
      const msg = msgById.get(String(flag.data?.message_id ?? flag.message_id));
      const label = (id: string) => {
        const s = input.siblings.find((x) => x.id === id) ?? (id === order.id ? { items: f.items_summary?.value ?? null, dueDate: f.due_date?.value ?? null } : undefined);
        const due = s?.dueDate && isIsoDate(s.dueDate) ? ` · due ${dayOfMonth(s.dueDate)} ${monthShort(s.dueDate)}` : "";
        return `${s?.items ?? "Order"}${due}`;
      };
      review.push({
        ...base, title: "Which order is this about?",
        explanation: `${msg?.body ? `“${msg.body}” ` : "A message "}could belong to more than one order. Pick one and Pakka will add its details there.`,
        orderChoices: candidates.map((id) => ({ orderId: id, label: label(id) })),
        sourceKey: `flag:${flag.id}`,
      });
    } else if (flag.type === "low_confidence") {
      const dropped = flag.data?.reason === "quote_not_found";
      review.push({
        ...base, title: p ? `Check ${p.short_label}` : "Check a detail",
        explanation: dropped
          ? `Pakka couldn't match ${p ? `the ${p.short_label}` : "a detail"} to the customer's words, so it wasn't added.`
          : `Pakka wasn't sure about ${p ? `the ${p.short_label}` : "a detail"}${flag.data?.value ? ` (${String(flag.data.value)})` : ""}. Check it in the chat.`,
        sourceKey: p && sources[p.key] ? p.key : undefined,
      });
    } else if (flag.type === "message_deleted") {
      review.push({ ...base, title: "A message was deleted", explanation: "The customer deleted a message. Details that came from it may be out of date. Check WhatsApp." });
    } else if (flag.type === "message_unreadable") {
      review.push({ ...base, title: "A message couldn't be read", explanation: "Pakka couldn't read one message. Check WhatsApp." });
    }
  }
  // "View messages" for conflicts and "which order": the field's source plus the message that raised the flag.
  for (const item of review) {
    if (!item.sourceKey?.startsWith("flag:")) continue;
    const flag = openFlags.find((x) => x.id === item.id)!;
    const key = flag.data?.field as string | undefined;
    const ids = [f[key ?? ""]?.source_message_id, String(flag.data?.message_id ?? flag.message_id)].filter((x): x is string => !!x);
    const list = bubbles(ids, () => null);
    if (list.length === 0) { delete item.sourceKey; continue; }
    sources[item.sourceKey] = {
      title: key ? `Messages about "${labelOf(key)}"` : "The message in question",
      subtitle: `${customerName} · WhatsApp chat`, bubbles: list, agreed: null,
    };
  }

  // ---- payments
  const price = f.price_agreed ? shown("price_agreed", f.price_agreed.value) : null;
  const advance = f.advance_requested ? shown("advance_requested", f.advance_requested.value) : null;
  const balanceNum = computeBalance(f, input.attachments);
  const screenshots = input.attachments.filter((a) => a.kind === "payment_screenshot").map((a) => {
    const n = parseMoney(a.extracted?.amount as number | null);
    return { id: a.id, amount: n === null ? "amount unreadable" : formatRupees(n), received: a.marked_received, imageUrl: input.imageUrls[a.message_id] ?? null };
  });

  // ---- history (newest first)
  const eventTime = (e: OrderEvent) => (e.source_message_id && msgById.get(e.source_message_id)?.sent_at) || e.created_at;
  const history: HistoryEntry[] = [...events]
    .sort((a, b) => eventTime(b).localeCompare(eventTime(a)))
    .map((e) => {
      const p = e.field ? field(e.field) : undefined;
      const from = e.old_value && p ? displayValue(p, e.old_value) : e.old_value;
      const to = e.new_value && p ? displayValue(p, e.new_value) : e.new_value;
      const srcMsg = e.source_message_id ? msgById.get(e.source_message_id) : undefined;
      let text: string;
      if (e.note && e.actor !== "owner" && p) text = `${p.label}: ${e.note}${to ? ` (${to})` : ""}`;
      else if (e.note && !p) text = e.note;
      else if (p && from) text = `${p.label} changed from ${from} to ${to}`;
      else if (p) text = `${p.label} set to ${to}`;
      else text = e.note ?? "Updated";
      const source =
        e.actor === "owner" ? (p ? "Edited by you" : "By you")
        : e.actor === "system" ? "By Pakka"
        : srcMsg?.direction === "out" && from ? "Agreed in chat by your business"
        : "From chat";
      return { id: e.id, at: formatChatStamp(eventTime(e)), text, source };
    });

  // ---- confirm footer
  const closed = order.status === "delivered" || order.status === "cancelled";
  const missing = missingRequiredFields(profile, f);
  let reason: string | null = null;
  if (order.status === "confirmed") reason = "This order is confirmed.";
  else if (closed) reason = `This order is ${order.status}.`;
  else if (missing.length > 0) {
    // Money first ("the price and the address"), otherwise the profile's own order.
    const ordered = [...missing].sort((a, b) => Number(b.type === "money") - Number(a.type === "money"));
    reason = `Add ${listWithThe(ordered.map((m) => lower(m.short_label)))} to confirm.`;
  }
  else if (openFlags.length > 0) reason = "Sort out the items under Needs review to confirm.";

  const unseen = input.notes.filter((n) => !n.seen);
  const due = f.due_date?.value;
  const hasDate = isIsoDate(due);
  const occasion = f.occasion?.value?.trim();
  return {
    id: order.id,
    status: order.status,
    closed,
    pill: closed
      ? { tone: "ready", label: cap(order.status) }
      : { tone: pillTone({ status: order.status, updatedAfterConfirmation: order.updated_after_confirmation, unseenNotes: unseen.length }) },
    header: {
      weekday: hasDate ? weekdayShort(due) : null, day: hasDate ? dayOfMonth(due) : null, month: hasDate ? monthShort(due) : null,
      time: formatTime12(f.due_time?.value), fulfilment: f.fulfilment ? cap(f.fulfilment.value) : null,
      title: occasion ? `${customerName} · ${occasion}` : customerName,
    },
    whatsappUrl: waUrl,
    notes: unseen.map((n) => ({ id: n.id, text: n.text })),
    pending: input.pending.filter((p) => p.resolved === null).map((p) => ({
      id: p.id, fieldLabel: labelOf(p.field), requested: shown(p.field, p.requested_value),
      current: f[p.field] ? shown(p.field, f[p.field].value) : null,
    })),
    review, fields, sources,
    payments: { price, advance, screenshots, balance: balanceNum === null ? null : formatRupees(balanceNum) },
    history,
    footer: { canConfirm: reason === null, reason },
    needsClearUpdated: order.status === "confirmed" && order.updated_after_confirmation,
  };
}

