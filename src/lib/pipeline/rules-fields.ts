import type { Profile } from "@/types/profile";
import type { Confidence, OrderEvent, PendingRequest, UpdateNote } from "@/types/db";
import type { FieldUpdate, ModelResult } from "./extraction-prompt";
import {
  type MessageCtx, type OrderDraft, type Workspace,
  openFlags, openPending, raiseFlag,
} from "./draft";
import { formatChatTime, newId, nowIso, normaliseText, quoteAppearsIn } from "./helpers";

// Rules 1 and 3-7 of section 6: what happens to each field the model reported.

const labelOf = (profile: Profile, key: string) =>
  profile.fields.find((f) => f.key === key)?.label ?? key;

/** Rule 1: drop updates whose quote isn't in a text message. Image messages can't be checked. */
export function verifyQuotes(updates: FieldUpdate[], message: MessageCtx) {
  if (message.type === "image") return { kept: updates, dropped: [] as FieldUpdate[] };
  const kept: FieldUpdate[] = [];
  const dropped: FieldUpdate[] = [];
  for (const u of updates) {
    (u.quote && message.body && quoteAppearsIn(u.quote, message.body) ? kept : dropped).push(u);
  }
  return { kept, dropped };
}

/** The model must use only the profile's field keys. */
export function dropUnknownFields(updates: FieldUpdate[], profile: Profile): FieldUpdate[] {
  const keys = new Set(profile.fields.map((f) => f.key));
  return updates.filter((u) => keys.has(u.field));
}

/** Rule 1 follow-up: tell the owner an update was dropped because it couldn't be quoted. */
export function flagDroppedUpdates(
  ws: Workspace, draft: OrderDraft | null, dropped: FieldUpdate[], message: MessageCtx,
) {
  for (const u of dropped) {
    raiseFlag(ws, draft, {
      type: "low_confidence",
      detail: `Couldn't confirm "${labelOf(ws.profile, u.field)}" from the message, so it wasn't applied.`,
      messageId: message.id,
      data: { field: u.field, value: u.value, reason: "quote_not_found" },
    });
  }
}

function pushEvent(draft: OrderDraft, e: Pick<OrderEvent, "field" | "old_value" | "new_value" | "actor" | "note" | "source_message_id">) {
  draft.newEvents.push({ id: newId(), order_id: draft.order.id, created_at: nowIso(), ...e });
}

function pushNote(draft: OrderDraft, text: string, sourceMessageId: string | null) {
  const note: UpdateNote = {
    id: newId(), order_id: draft.order.id, text, source_message_id: sourceMessageId,
    seen: false, created_at: nowIso(),
  };
  draft.newNotes.push(note);
}

/** Rule 3: store the value, its source message and confidence. */
export function fillEmptyField(
  draft: OrderDraft, key: string, value: string, sourceMessageId: string | null,
  confidence: Confidence, sentAt: string, eventSourceId = sourceMessageId,
) {
  draft.order.fields[key] = {
    value, source_message_id: sourceMessageId, confidence,
    updated_at: sentAt, previous_value: null, edited_by_owner: false,
  };
  pushEvent(draft, { field: key, old_value: null, new_value: value, actor: "chat", note: null, source_message_id: eventSourceId });
}

/** Replace an existing value, keeping the old one as previous_value and writing history. */
export function replaceFieldValue(
  draft: OrderDraft, key: string, value: string, sourceMessageId: string | null,
  confidence: Confidence, sentAt: string, eventSourceId = sourceMessageId,
) {
  const old = draft.order.fields[key].value;
  draft.order.fields[key] = {
    value, source_message_id: sourceMessageId, confidence,
    updated_at: sentAt, previous_value: old, edited_by_owner: false,
  };
  pushEvent(draft, { field: key, old_value: old, new_value: value, actor: "chat", note: null, source_message_id: eventSourceId });
}

/** Rule 4 (agreed): apply, keep previous_value, write the event, add the update note. Rule 14: flag confirmed orders. */
export function applyAgreedChange(
  draft: OrderDraft, profile: Profile, key: string, value: string,
  sourceMessageId: string | null, confidence: Confidence, agreement: MessageCtx,
) {
  replaceFieldValue(draft, key, value, sourceMessageId, confidence, agreement.sentAt, agreement.id);
  pushNote(
    draft,
    `${labelOf(profile, key)} is now ${value}. Agreed in chat by your business on ${formatChatTime(agreement.sentAt)}.`,
    agreement.id,
  );
  if (draft.order.status === "confirmed") draft.order.updated_after_confirmation = true;
  resolvePendingMatching(draft, key, value, "agreed");
}

/** Rule 4 (not agreed): keep the current value and remember the request. */
export function queuePendingRequest(draft: OrderDraft, key: string, value: string, message: MessageCtx) {
  const duplicate = openPending(draft).some(
    (p) => p.field === key && normaliseText(p.requested_value) === normaliseText(value),
  );
  if (duplicate) return;
  const row: PendingRequest = {
    id: newId(), order_id: draft.order.id, field: key, requested_value: value,
    source_message_id: message.id, resolved: null, created_at: nowIso(),
  };
  draft.pending.push(row);
  draft.newPending.push(row);
}

function resolvePending(draft: OrderDraft, p: PendingRequest, resolved: "agreed" | "refused") {
  p.resolved = resolved;
  if (!draft.newPending.includes(p)) draft.touchedPendingIds.add(p.id);
}

function resolvePendingMatching(draft: OrderDraft, key: string, value: string, resolved: "agreed" | "refused") {
  for (const p of openPending(draft)) {
    if (p.field === key && normaliseText(p.requested_value) === normaliseText(value)) resolvePending(draft, p, resolved);
  }
}

/** Rule 7: a low-confidence value is applied, but the owner is asked to check it. */
export function flagLowConfidence(ws: Workspace, draft: OrderDraft, key: string, value: string, message: MessageCtx) {
  const already = openFlags(draft).some((f) => f.type === "low_confidence" && f.data?.field === key);
  if (already) return;
  raiseFlag(ws, draft, {
    type: "low_confidence",
    detail: `"${labelOf(ws.profile, key)}" might be wrong: ${value}. Check the chat.`,
    messageId: message.id,
    data: { field: key, value },
  });
}

export type ApplyOptions = {
  /** An edit supersedes what the customer wrote before: fields sourced from this message are replaced, not queued. */
  replaceSourceMessageId?: string;
};

/** Rules 3, 4 and 7 for every update that survived rule 1. */
export function applyFieldUpdates(
  ws: Workspace, draft: OrderDraft, updates: FieldUpdate[], message: MessageCtx, opts: ApplyOptions = {},
) {
  for (const u of updates) {
    const value = u.value.trim();
    if (!value) continue;
    const existing = draft.order.fields[u.field];
    let applied = false;

    if (!existing || !existing.value) {
      fillEmptyField(draft, u.field, value, message.id, u.confidence, message.sentAt);
      applied = true;
    } else if (normaliseText(existing.value) === normaliseText(value)) {
      continue;
    } else if (opts.replaceSourceMessageId && existing.source_message_id === opts.replaceSourceMessageId) {
      replaceFieldValue(draft, u.field, value, message.id, u.confidence, message.sentAt);
      applied = true;
    } else if (u.agreed_by_business) {
      applyAgreedChange(draft, ws.profile, u.field, value, message.id, u.confidence, message);
      applied = true;
    } else {
      queuePendingRequest(draft, u.field, value, message);
    }

    if (applied && u.confidence === "low") flagLowConfidence(ws, draft, u.field, value, message);
  }
}

/** Rule 5 (agrees): apply each agreed pending value as an agreed change. Only a business message can agree. */
export function applyAgreedPending(ws: Workspace, ids: string[], message: MessageCtx) {
  if (message.direction !== "out") return;
  for (const id of ids) {
    const draft = ws.orders.find((d) => openPending(d).some((p) => p.id === id));
    const pending = draft && openPending(draft).find((p) => p.id === id);
    if (!draft || !pending) continue;
    const current = draft.order.fields[pending.field]?.value;
    if (current && normaliseText(current) === normaliseText(pending.requested_value)) {
      resolvePending(draft, pending, "agreed"); // already applied by a field update in this same message
    } else if (!current) {
      fillEmptyField(draft, pending.field, pending.requested_value, pending.source_message_id, "high", message.sentAt, message.id);
      resolvePending(draft, pending, "agreed");
    } else {
      applyAgreedChange(draft, ws.profile, pending.field, pending.requested_value, pending.source_message_id, "high", message);
      resolvePending(draft, pending, "agreed");
    }
  }
}

/** Rule 5 (refuses): the current value stays; the request is closed as refused. */
export function applyRefusedPending(ws: Workspace, ids: string[], message: MessageCtx) {
  if (message.direction !== "out") return;
  for (const id of ids) {
    const draft = ws.orders.find((d) => openPending(d).some((p) => p.id === id));
    const pending = draft && openPending(draft).find((p) => p.id === id);
    if (!draft || !pending) continue;
    resolvePending(draft, pending, "refused");
    pushEvent(draft, {
      field: pending.field,
      old_value: draft.order.fields[pending.field]?.value ?? null,
      new_value: pending.requested_value,
      actor: "chat",
      note: "Requested change was declined in chat",
      source_message_id: message.id,
    });
  }
}

/** Rule 6: a conflict flag, and nothing else changes. */
export function raiseConflicts(
  ws: Workspace, draft: OrderDraft | null, conflicts: ModelResult["conflicts"], message: MessageCtx,
) {
  for (const c of conflicts) {
    if (draft && openFlags(draft).some((f) => f.type === "conflict" && f.data?.field === c.field)) continue;
    raiseFlag(ws, draft, {
      type: "conflict",
      detail: `${labelOf(ws.profile, c.field)}: ${c.values.join(" vs ")}. Check the chat.`,
      messageId: message.id,
      data: { field: c.field, values: c.values },
    });
  }
}

