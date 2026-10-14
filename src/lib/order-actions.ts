import "server-only";
import type { Flag, Order } from "@/types/db";
import type { ProfileField } from "@/types/profile";
import { getProfile } from "@/config/profiles";
import { getSupabase } from "@/lib/supabase";
import { isIsoDate, normaliseTime24 } from "@/lib/dates";
import { formatRupees, newId, nowIso, normaliseText, parseMoney } from "@/lib/pipeline/helpers";
import { openFlags, resolveFlag, type MessageCtx, type OrderDraft, type Workspace } from "@/lib/pipeline/draft";
import { parseModelResult } from "@/lib/pipeline/extraction-prompt";
import { pushEvent } from "@/lib/pipeline/rules-fields";
import { applyToOrder, finaliseChanged } from "@/lib/pipeline/rules-apply";
import { finaliseOrder } from "@/lib/pipeline/rules-order";
import { loadMessage, loadWorkspace, saveWorkspace } from "@/lib/pipeline/store";

// What the owner can do to an order. Every action writes an order_events row (actor "owner"),
// resolves what it settles, and recomputes the status through the same rules as the pipeline.

export class ActionError extends Error {}

const db = () => getSupabase();

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function loadOrderRow(orderId: string): Promise<Order> {
  const { data, error } = await db().from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError("That order no longer exists.");
  return data as Order;
}

/** The order as a draft inside its customer's workspace. Closed orders can't be changed. */
async function openDraft(orderId: string): Promise<{ ws: Workspace; draft: OrderDraft }> {
  const order = await loadOrderRow(orderId);
  if (order.status === "delivered" || order.status === "cancelled") {
    throw new ActionError(`This order is ${order.status}, so it can't be changed.`);
  }
  const ws = await loadWorkspace(order.customer_id, getProfile(order.profile));
  const draft = ws.orders.find((d) => d.order.id === orderId);
  if (!draft) throw new ActionError("That order no longer exists.");
  return { ws, draft };
}

async function finish(ws: Workspace, draft: OrderDraft) {
  finaliseOrder(ws, draft, null);
  await saveWorkspace(ws);
}

function ownerEvent(draft: OrderDraft, field: string | null, oldValue: string | null, newValue: string | null, note: string) {
  pushEvent(draft, { field, old_value: oldValue, new_value: newValue, actor: "owner", note, source_message_id: null });
}

/** Checks and tidies what the owner typed, by the field's type. Throws ActionError with a plain message. */
export function cleanFieldInput(field: ProfileField, raw: string): string {
  const value = raw.trim();
  if (!value) throw new ActionError(`Enter the ${field.short_label}.`);
  if (value.length > 500) throw new ActionError("That is too long (500 characters at most).");
  switch (field.type) {
    case "date":
      if (!isIsoDate(value)) throw new ActionError("Pick a valid date.");
      return value;
    case "time": {
      const t = normaliseTime24(value);
      if (!t) throw new ActionError("Enter a time like 5 pm or 17:00.");
      return t;
    }
    case "money": {
      const n = parseMoney(value);
      if (n === null) throw new ActionError("Enter an amount in rupees, like 1800.");
      return `₹${n}`;
    }
    case "enum": {
      const match = field.options?.find((o) => normaliseText(o) === normaliseText(value));
      if (!match) throw new ActionError(`Choose one of: ${field.options?.join(", ")}.`);
      return match;
    }
    default:
      return value;
  }
}

/** Owner sets any field. Marked "Edited by you"; settles conflicts and checks on that field. */
export async function editField(orderId: string, key: string, raw: string) {
  const { ws, draft } = await openDraft(orderId);
  const field = ws.profile.fields.find((f) => f.key === key);
  if (!field) throw new ActionError("That field isn't tracked for this order.");
  const value = cleanFieldInput(field, raw);

  const existing = draft.order.fields[key];
  if (!existing || normaliseText(existing.value) !== normaliseText(value)) {
    draft.order.fields[key] = {
      value, source_message_id: null, confidence: "high", updated_at: nowIso(),
      previous_value: existing?.value ?? null, edited_by_owner: true, quote: null,
    };
    ownerEvent(draft, key, existing?.value ?? null, value, "Edited by you");
  }
  for (const f of openFlags(draft)) {
    if ((f.type === "conflict" || f.type === "low_confidence") && f.data?.field === key) resolveFlag(draft, f);
  }
  await finish(ws, draft);
}

/** Conflict: the owner picks which value is right. */
export async function chooseConflictValue(orderId: string, flagId: string, value: string) {
  const { draft } = await openDraft(orderId);
  const flag = draft.flags.find((f) => f.id === flagId && f.type === "conflict" && !f.resolved);
  if (!flag) throw new ActionError("That item has already been dealt with.");
  await editField(orderId, String(flag.data?.field), value);
}

/** Owner has looked at a flag (low confidence, deleted or unreadable message) and it's fine. */
export async function markFlagChecked(orderId: string, flagId: string) {
  const { ws, draft } = await openDraft(orderId);
  const flag = draft.flags.find((f) => f.id === flagId && !f.resolved);
  const allowed: Flag["type"][] = ["low_confidence", "message_deleted", "message_unreadable"];
  if (!flag || !allowed.includes(flag.type)) throw new ActionError("That item has already been dealt with.");
  resolveFlag(draft, flag);
  ownerEvent(draft, null, null, null, `Marked as checked: ${flag.detail}`);
  await finish(ws, draft);
}

/** The owner confirms they received this payment (never inferred from a screenshot). */
export async function markPaymentReceived(orderId: string, attachmentId: string) {
  const { ws, draft } = await openDraft(orderId);
  const att = draft.attachments.find((a) => a.id === attachmentId && a.kind === "payment_screenshot");
  if (!att) throw new ActionError("That screenshot no longer exists.");
  if (!att.marked_received) {
    must(await db().from("attachments").update({ marked_received: true }).eq("id", att.id), "mark received");
    att.marked_received = true;
  }
  const amount = parseMoney(att.extracted?.amount as number | null);
  for (const f of openFlags(draft)) {
    if (f.type === "payment_mismatch" && f.message_id === att.message_id) resolveFlag(draft, f);
  }
  ownerEvent(draft, null, null, null, `Marked ${amount === null ? "a payment screenshot" : `the ${formatRupees(amount)} screenshot`} as received`);
  await finish(ws, draft);
}

/** which_order: apply what the model found in that message to the order the owner picked. */
export async function chooseOrderForMessage(flagId: string, chosenOrderId: string) {
  const { data: flag, error } = await db().from("flags").select("*").eq("id", flagId).maybeSingle();
  if (error) throw new Error(error.message);
  const f = flag as Flag | null;
  if (!f || f.type !== "which_order" || f.resolved) throw new ActionError("That question has already been answered.");
  const candidates = (f.data?.candidate_order_ids as string[] | undefined) ?? [];
  if (!candidates.includes(chosenOrderId)) throw new ActionError("That isn't one of the possible orders.");

  const { ws, draft } = await openDraft(chosenOrderId);
  const home = ws.orders.find((d) => d.flags.some((x) => x.id === flagId));
  const stored = home?.flags.find((x) => x.id === flagId);
  if (!home || !stored) throw new ActionError("That question has already been answered.");

  const message = await loadMessage(String(f.data?.message_id ?? f.message_id));
  const ctx: MessageCtx = {
    id: message.id, customerId: message.customer_id!, direction: message.direction,
    type: message.type, body: message.body, sentAt: message.sent_at,
  };
  const data = f.data ?? {};
  const result = parseModelResult(data.result ?? { field_updates: data.field_updates ?? [] });

  resolveFlag(home, stored);
  applyToOrder(ws, draft, result, result.field_updates, ctx);
  ownerEvent(draft, null, null, null, "You chose this order for a message");
  finaliseChanged(ws, ctx.id);
  await saveWorkspace(ws);
}

/** Confirm: only when nothing is missing and nothing needs review. */
export async function confirmOrder(orderId: string) {
  const { ws, draft } = await openDraft(orderId);
  if (draft.order.status === "confirmed") throw new ActionError("This order is already confirmed.");
  finaliseOrder(ws, draft, null);
  if (draft.order.status !== "ready") throw new ActionError("This order can't be confirmed yet. Finish the items under Needs review first.");
  draft.order.status = "confirmed";
  draft.order.confirmed_at = nowIso();
  ownerEvent(draft, null, null, null, "Order confirmed");
  await saveWorkspace(ws);
}

/** Opening a confirmed order clears "updated after confirmation". */
export async function clearUpdatedAfterConfirmation(orderId: string) {
  must(await db().from("orders").update({ updated_after_confirmation: false }).eq("id", orderId).eq("updated_after_confirmation", true), "clear flag");
}

export async function closeOrder(orderId: string, status: "delivered" | "cancelled") {
  const order = await loadOrderRow(orderId);
  if (order.status === "delivered" || order.status === "cancelled") throw new ActionError(`This order is already ${order.status}.`);
  must(await db().from("orders").update({ status, updated_at: nowIso() }).eq("id", orderId), "close order");
  must(await db().from("order_events").insert({
    id: newId(), order_id: orderId, field: null, old_value: order.status, new_value: status, actor: "owner",
    note: status === "delivered" ? "Marked as delivered" : "Order cancelled", source_message_id: null,
  }), "log event");
}

export async function markNoteSeen(noteId: string) {
  must(await db().from("update_notes").update({ seen: true }).eq("id", noteId), "mark seen");
}
