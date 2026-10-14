import type {
  Attachment, Flag, FlagType, Order, OrderEvent, PendingRequest, UpdateNote,
} from "@/types/db";
import type { Profile } from "@/types/profile";
import { newId, nowIso } from "./helpers";

// In-memory working copies. The rules below change drafts only; store.ts reads them
// from, and writes them back to, the database. That keeps every rule testable offline.

export type MessageCtx = {
  id: string;
  customerId: string;
  direction: "in" | "out";
  type: "text" | "image" | "edit" | "revoke" | "unsupported";
  body: string | null;
  sentAt: string;
};

export type OrderDraft = {
  order: Order;
  isNew: boolean;
  /** Every flag on this order: existing and new. */
  flags: Flag[];
  pending: PendingRequest[];
  attachments: Attachment[];
  newFlags: Flag[];
  newPending: PendingRequest[];
  newEvents: OrderEvent[];
  newNotes: UpdateNote[];
  newAttachments: Attachment[];
  /** Existing rows whose resolved state changed in this run. */
  touchedFlagIds: Set<string>;
  touchedPendingIds: Set<string>;
};

export type Workspace = {
  customerId: string;
  profile: Profile;
  /** The customer's open orders, plus any created by this message. */
  orders: OrderDraft[];
  /** Flags that belong to no order (new rows only). */
  customerFlags: Flag[];
  /** Attachments with no order (new rows only). */
  orphanAttachments: Attachment[];
};

export function createWorkspace(customerId: string, profile: Profile, orders: OrderDraft[] = []): Workspace {
  return { customerId, profile, orders, customerFlags: [], orphanAttachments: [] };
}

export function draftFromRows(
  order: Order,
  rows: { flags?: Flag[]; pending?: PendingRequest[]; attachments?: Attachment[] } = {},
  isNew = false,
): OrderDraft {
  return {
    order: structuredClone(order),
    isNew,
    flags: rows.flags ? structuredClone(rows.flags) : [],
    pending: rows.pending ? structuredClone(rows.pending) : [],
    attachments: rows.attachments ? structuredClone(rows.attachments) : [],
    newFlags: [], newPending: [], newEvents: [], newNotes: [], newAttachments: [],
    touchedFlagIds: new Set(),
    touchedPendingIds: new Set(),
  };
}

export function createOrder(ws: Workspace, customerId: string, sentAt: string): OrderDraft {
  const now = nowIso();
  const order: Order = {
    id: newId(),
    customer_id: customerId,
    profile: ws.profile.id,
    status: "needs_review",
    fields: {},
    updated_after_confirmation: false,
    created_at: sentAt,
    updated_at: now,
    confirmed_at: null,
  };
  const draft = draftFromRows(order, {}, true);
  ws.orders.push(draft);
  return draft;
}

export function findDraft(ws: Workspace, orderId: string): OrderDraft | undefined {
  return ws.orders.find((d) => d.order.id === orderId);
}

export const isOpenOrder = (d: OrderDraft) =>
  d.order.status !== "delivered" && d.order.status !== "cancelled";

export function raiseFlag(
  ws: Workspace,
  draft: OrderDraft | null,
  flag: { type: FlagType; detail: string; messageId: string | null; data?: Record<string, unknown> | null },
): Flag {
  const row: Flag = {
    id: newId(),
    order_id: draft?.order.id ?? null,
    customer_id: ws.customerId,
    message_id: flag.messageId,
    type: flag.type,
    detail: flag.detail,
    data: flag.data ?? null,
    resolved: false,
    created_at: nowIso(),
  };
  if (draft) {
    draft.flags.push(row);
    draft.newFlags.push(row);
  } else {
    ws.customerFlags.push(row);
  }
  return row;
}

export function resolveFlag(draft: OrderDraft, flag: Flag) {
  if (flag.resolved) return;
  flag.resolved = true;
  if (!draft.newFlags.includes(flag)) draft.touchedFlagIds.add(flag.id);
}

export const openFlags = (d: OrderDraft) => d.flags.filter((f) => !f.resolved);
export const openPending = (d: OrderDraft) => d.pending.filter((p) => p.resolved === null);
