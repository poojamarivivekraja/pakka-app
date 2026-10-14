import type { ModelResult } from "./extraction-prompt";
import { type MessageCtx, type OrderDraft, type Workspace } from "./draft";
import {
  applyAgreedPending, applyFieldUpdates, applyRefusedPending, dropUnknownFields,
  flagDroppedUpdates, raiseConflicts, verifyQuotes, type ApplyOptions,
} from "./rules-fields";
import {
  finaliseOrder, hasChanges, linkToOrder, recordPaymentScreenshot, recordReferenceImage,
} from "./rules-order";
import { addEditNote, ordersUsingMessage } from "./rules-events";

/** Runs rules 1-9 and 11-14 on one model reply. Pure: changes the workspace's drafts only. */
export function applyExtraction(
  ws: Workspace, result: ModelResult, message: MessageCtx, opts: ApplyOptions = {},
): { draft: OrderDraft | null } {
  const { kept, dropped } = verifyQuotes(dropUnknownFields(result.field_updates, ws.profile), message);
  const link = linkToOrder(ws, result, message, kept);
  flagDroppedUpdates(ws, link.draft, dropped, message);

  if (!link.ambiguous) {
    if (link.draft) applyFieldUpdates(ws, link.draft, kept, message, opts);
    applyAgreedPending(ws, result.agrees_to_pending, message);
    applyRefusedPending(ws, result.refuses_pending, message);
    raiseConflicts(ws, link.draft, result.conflicts, message);
    recordPaymentScreenshot(ws, link.draft, result, message);
    recordReferenceImage(ws, link.draft, result, message);
  }

  finaliseChanged(ws, message.id);
  return { draft: link.draft };
}

/** Rules 11 and 13 for every order this message touched. */
export function finaliseChanged(ws: Workspace, messageId: string) {
  for (const d of ws.orders) if (hasChanges(d)) finaliseOrder(ws, d, messageId);
}

/**
 * Rule 10 (edit): reprocess the edited text in place of the original, then note the edit.
 * - An edit replaces the original, so it is applied to the one order that text filled in,
 *   whatever the model says about the link.
 * - A customer edit changes values directly only if the business has not replied since the
 *   original. After a reply the business has seen the old text, so each changed value
 *   becomes a pending request instead (an edit can never count as the business agreeing).
 */
export function applyEditedMessage(
  ws: Workspace, result: ModelResult, original: MessageCtx, opts: { businessRepliedSince?: boolean } = {},
) {
  const before = ordersUsingMessage(ws, original.id);
  const locked = original.direction === "in" && !!opts.businessRepliedSince;

  let adjusted: ModelResult = result;
  if (before.length === 1) {
    adjusted = { ...adjusted, order_ref: before[0].order.id, link_confidence: "high", candidate_order_ids: [] };
  }
  if (locked) {
    adjusted = { ...adjusted, field_updates: adjusted.field_updates.map((u) => ({ ...u, agreed_by_business: false })) };
  }

  const { draft } = applyExtraction(ws, adjusted, original, locked ? {} : { replaceSourceMessageId: original.id });
  const affected = new Set<OrderDraft>(before);
  if (draft) affected.add(draft);
  addEditNote([...affected], original.id, original.direction === "in");
}
