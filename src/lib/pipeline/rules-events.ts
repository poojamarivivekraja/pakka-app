import type { UpdateNote } from "@/types/db";
import { type OrderDraft, type Workspace, isOpenOrder, openFlags, raiseFlag } from "./draft";
import { newId, nowIso } from "./helpers";

// Rule 10 of section 6: edit, revoke and unsupported events.

export const ordersUsingMessage = (ws: Workspace, messageId: string) =>
  ws.orders.filter((d) => Object.values(d.order.fields).some((f) => f.source_message_id === messageId));

/** Where an event with no obvious order should show up: the most recently updated open order. */
function fallbackOrder(ws: Workspace): OrderDraft | null {
  const open = ws.orders.filter(isOpenOrder);
  open.sort((a, b) => b.order.updated_at.localeCompare(a.order.updated_at));
  return open[0] ?? null;
}

/** Edit: tell the owner a message was edited. The new text is reprocessed by the pipeline. */
export function addEditNote(drafts: OrderDraft[], editedMessageId: string, byCustomer: boolean) {
  for (const draft of drafts) {
    const note: UpdateNote = {
      id: newId(),
      order_id: draft.order.id,
      text: byCustomer ? "Customer edited a message" : "Your business edited a message",
      source_message_id: editedMessageId,
      seen: false,
      created_at: nowIso(),
    };
    draft.newNotes.push(note);
  }
}

/** Revoke: flag it, and lower confidence on every field that came from the deleted message. */
export function flagRevokedMessage(ws: Workspace, revokedMessageId: string, eventMessageId: string) {
  const affected = ordersUsingMessage(ws, revokedMessageId);
  const targets: (OrderDraft | null)[] = affected.length > 0 ? affected : [fallbackOrder(ws)];
  for (const draft of targets) {
    if (draft) {
      for (const f of Object.values(draft.order.fields)) {
        if (f.source_message_id === revokedMessageId) f.confidence = "low";
      }
      if (openFlags(draft).some((f) => f.type === "message_deleted" && f.data?.deleted_message_id === revokedMessageId)) continue;
    }
    raiseFlag(ws, draft, {
      type: "message_deleted",
      detail: "The customer deleted a message. Details from it may be out of date. Check WhatsApp.",
      messageId: eventMessageId,
      data: { deleted_message_id: revokedMessageId },
    });
  }
}

/** Unsupported (WhatsApp error 131060): we can't read it, so say so. */
export function flagUnreadableMessage(ws: Workspace, messageId: string) {
  raiseFlag(ws, fallbackOrder(ws), {
    type: "message_unreadable",
    detail: "1 message couldn't be read. Check WhatsApp.",
    messageId,
  });
}
