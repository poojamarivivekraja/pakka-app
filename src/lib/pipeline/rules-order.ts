import type { Attachment, OrderFields, OrderStatus } from "@/types/db";
import type { Profile } from "@/types/profile";
import { missingRequiredFields } from "@/config/profiles";
import type { FieldUpdate, ModelResult } from "./extraction-prompt";
import {
  type MessageCtx, type OrderDraft, type Workspace,
  createOrder, isOpenOrder, openFlags, raiseFlag, resolveFlag,
} from "./draft";
import { formatRupees, newId, nowIso, parseMoney } from "./helpers";

// Rules 2 and 8-13 of section 6: which order, attachments, missing fields, balance, status.

export type LinkOutcome = {
  /** The order to apply this message to, or null when nothing should be applied. */
  draft: OrderDraft | null;
  /** True when the owner must pick the order first (which_order flag raised). */
  ambiguous: boolean;
};

/** Rule 2: link to an existing order, create a NEW one, or stop and ask the owner. */
export function linkToOrder(
  ws: Workspace, result: ModelResult, message: MessageCtx, keptUpdates: FieldUpdate[],
): LinkOutcome {
  const open = ws.orders.filter(isOpenOrder);
  const ref = result.order_ref.trim();
  const named = open.find((d) => d.order.id === ref);

  let candidates = result.candidate_order_ids.filter((id) => open.some((d) => d.order.id === id));
  if (candidates.length === 0 && named) candidates = [named.order.id];
  const unknownRef = ref !== "NEW" && ref !== "NONE" && !named;
  if (unknownRef && candidates.length === 0) candidates = open.map((d) => d.order.id);

  if ((result.link_confidence === "low" || unknownRef) && candidates.length > 0) {
    const home = open.find((d) => d.order.id === candidates[0]) ?? null;
    raiseFlag(ws, home, {
      type: "which_order",
      detail: "Which order is this message about?",
      messageId: message.id,
      data: {
        candidate_order_ids: candidates,
        message_id: message.id,
        // Everything the model found (quote-checked updates only), so choosing an order can apply it all.
        result: { ...result, field_updates: keptUpdates },
      },
    });
    return { draft: null, ambiguous: true };
  }
  if (ref === "NEW") return { draft: createOrder(ws, message.customerId, message.sentAt), ambiguous: false };
  return { draft: named ?? null, ambiguous: false };
}

function addAttachment(ws: Workspace, draft: OrderDraft | null, a: Omit<Attachment, "id" | "order_id" | "created_at" | "marked_received">) {
  const row: Attachment = {
    id: newId(), order_id: draft?.order.id ?? null, marked_received: false, created_at: nowIso(), ...a,
  };
  if (draft) {
    draft.attachments.push(row);
    draft.newAttachments.push(row);
  } else {
    ws.orphanAttachments.push(row);
  }
  return row;
}

/** Rule 8: record what the screenshot shows (never "paid"), and flag a wrong advance amount. */
export function recordPaymentScreenshot(ws: Workspace, draft: OrderDraft | null, result: ModelResult, message: MessageCtx) {
  if (result.image_role !== "payment_screenshot") return;
  const p = result.payment;
  const amount = parseMoney(p?.amount);
  addAttachment(ws, draft, {
    message_id: message.id,
    kind: "payment_screenshot",
    description: null,
    extracted: {
      amount,
      amount_text: p?.amount ?? null,
      reference: p?.reference ?? null,
      payee: p?.payee ?? null,
      date: p?.date ?? null,
    },
  });
  const asked = parseMoney(draft?.order.fields.advance_requested?.value);
  if (draft && asked !== null && amount !== null && asked !== amount) {
    raiseFlag(ws, draft, {
      type: "payment_mismatch",
      detail: `Screenshot shows ${formatRupees(amount)}, but the advance asked was ${formatRupees(asked)}.`,
      messageId: message.id,
      data: { amount, advance_requested: asked },
    });
  }
}

/** Rule 9: keep the reference image with its one-line description. */
export function recordReferenceImage(ws: Workspace, draft: OrderDraft | null, result: ModelResult, message: MessageCtx) {
  if (result.image_role !== "reference_image") return;
  addAttachment(ws, draft, {
    message_id: message.id,
    kind: "reference_image",
    description: result.image_description,
    extracted: null,
  });
}

/** Rule 11: exactly one open missing_field flag per missing required field; resolve it once filled. */
export function syncMissingFieldFlags(ws: Workspace, draft: OrderDraft, messageId: string | null) {
  const missing = new Set(missingRequiredFields(ws.profile, draft.order.fields).map((f) => f.key));
  const seen = new Set<string>();
  for (const flag of openFlags(draft).filter((f) => f.type === "missing_field")) {
    const key = String(flag.data?.field);
    if (!missing.has(key) || seen.has(key)) resolveFlag(draft, flag);
    else seen.add(key);
  }
  for (const f of ws.profile.fields) {
    if (!missing.has(f.key) || seen.has(f.key)) continue;
    raiseFlag(ws, draft, { type: "missing_field", detail: `${f.label} is missing.`, messageId, data: { field: f.key } });
  }
}

/** Rule 12: price agreed minus the screenshot amounts. Always computed here, never read from chat. */
export function computeBalance(fields: OrderFields, attachments: Attachment[]): number | null {
  const price = parseMoney(fields.price_agreed?.value);
  if (price === null) return null;
  const received = attachments
    .filter((a) => a.kind === "payment_screenshot")
    .reduce((sum, a) => sum + (parseMoney(a.extracted?.amount as number | null) ?? 0), 0);
  return price - received;
}

/** Rule 13: confirmed, delivered and cancelled orders keep their status; otherwise flags decide. */
export function computeStatus(draft: OrderDraft, profile: Profile): OrderStatus {
  const { status, fields } = draft.order;
  if (status === "confirmed" || status === "delivered" || status === "cancelled") return status;
  if (openFlags(draft).length > 0) return "needs_review";
  return missingRequiredFields(profile, fields).length === 0 ? "ready" : "needs_review";
}

export function hasChanges(d: OrderDraft): boolean {
  return (
    d.isNew || d.newFlags.length > 0 || d.newPending.length > 0 || d.newEvents.length > 0 ||
    d.newNotes.length > 0 || d.newAttachments.length > 0 ||
    d.touchedFlagIds.size > 0 || d.touchedPendingIds.size > 0
  );
}

/** After every update: recompute missing-field flags (rule 11) and status (rule 13). */
export function finaliseOrder(ws: Workspace, draft: OrderDraft, messageId: string | null) {
  syncMissingFieldFlags(ws, draft, messageId);
  draft.order.status = computeStatus(draft, ws.profile);
  draft.order.updated_at = nowIso();
}
