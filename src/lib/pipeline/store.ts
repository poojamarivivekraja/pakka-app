import "server-only";
import type { Attachment, Customer, Flag, Message, Order, PendingRequest, Settings } from "@/types/db";
import type { Profile } from "@/types/profile";
import { getSupabase } from "@/lib/supabase";
import { createWorkspace, draftFromRows, type Workspace } from "./draft";
import { hasChanges } from "./rules-order";
import type { ChatLine } from "./extraction-prompt";

// The only place the pipeline touches the database.

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export async function loadSettings(): Promise<Settings> {
  const db = getSupabase();
  return check(await db.from("settings").select("*").eq("id", 1).single(), "load settings") as Settings;
}

export async function loadCustomer(customerId: string): Promise<Customer> {
  return check(await getSupabase().from("customers").select("*").eq("id", customerId).single(), "load customer") as Customer;
}

export type NewMessage = {
  customerId: string;
  direction: "in" | "out";
  type: Message["type"];
  body: string | null;
  mediaPath: string | null;
  sentAt: string;
  waMessageId: string | null;
  raw: unknown;
};

/** Saves the incoming message. A repeated WhatsApp message id returns the existing row. */
export async function insertMessage(m: NewMessage): Promise<{ message: Message; duplicate: boolean }> {
  const db = getSupabase();
  if (m.waMessageId) {
    const existing = check(await db.from("messages").select("*").eq("wa_message_id", m.waMessageId).maybeSingle(), "check duplicate");
    if (existing) return { message: existing as Message, duplicate: true };
  }
  const inserted = await db.from("messages").insert({
    wa_message_id: m.waMessageId, customer_id: m.customerId, direction: m.direction, type: m.type,
    body: m.body, media_path: m.mediaPath, sent_at: m.sentAt, status: "received", raw: m.raw ?? null,
  }).select("*").single();
  if (inserted.error && inserted.error.code === "23505" && m.waMessageId) {
    // The same WhatsApp message arrived twice at the same moment: the other copy won.
    const winner = check(await db.from("messages").select("*").eq("wa_message_id", m.waMessageId).single(), "find duplicate");
    return { message: winner as Message, duplicate: true };
  }
  return { message: check(inserted, "save message") as Message, duplicate: false };
}

export async function loadMessage(id: string): Promise<Message> {
  return check(await getSupabase().from("messages").select("*").eq("id", id).single(), "load message") as Message;
}

export async function setMessageStatus(id: string, status: Message["status"], body?: string) {
  const patch: Record<string, unknown> = { status };
  if (body !== undefined) patch.body = body;
  check(await getSupabase().from("messages").update(patch).eq("id", id), "update message");
}

/** The last 15 messages before this one, oldest first. */
export async function loadRecentMessages(customerId: string, beforeIso: string, excludeId: string): Promise<ChatLine[]> {
  const rows = check(
    await getSupabase().from("messages").select("id, direction, body, type")
      .eq("customer_id", customerId).neq("id", excludeId).lte("sent_at", beforeIso)
      .order("sent_at", { ascending: false }).order("created_at", { ascending: false }).limit(15),
    "load recent messages",
  ) as ChatLine[];
  return rows.reverse();
}

/** The customer's open orders with their open flags, open pending requests and attachments. */
export async function loadWorkspace(customerId: string, profile: Profile): Promise<Workspace> {
  const db = getSupabase();
  const orders = check(
    await db.from("orders").select("*").eq("customer_id", customerId).not("status", "in", "(delivered,cancelled)").order("created_at"),
    "load orders",
  ) as Order[];
  const ids = orders.map((o) => o.id);
  const [flags, pending, attachments] = ids.length === 0 ? [[], [], []] : await Promise.all([
    db.from("flags").select("*").in("order_id", ids).eq("resolved", false).then((r) => check(r, "load flags") as Flag[]),
    db.from("pending_requests").select("*").in("order_id", ids).is("resolved", null).then((r) => check(r, "load pending") as PendingRequest[]),
    db.from("attachments").select("*").in("order_id", ids).then((r) => check(r, "load attachments") as Attachment[]),
  ]);
  const drafts = orders.map((o) =>
    draftFromRows(o, {
      flags: flags.filter((f) => f.order_id === o.id),
      pending: pending.filter((p) => p.order_id === o.id),
      attachments: attachments.filter((a) => a.order_id === o.id),
    }),
  );
  return createWorkspace(customerId, profile, drafts);
}

/** Writes everything the rules changed. Not one transaction: fine for a prototype. */
export async function saveWorkspace(ws: Workspace) {
  const db = getSupabase();
  const changed = ws.orders.filter(hasChanges);

  const created = changed.filter((d) => d.isNew).map((d) => d.order);
  if (created.length) check(await db.from("orders").insert(created), "create orders");
  for (const d of changed.filter((d) => !d.isNew)) {
    const o = d.order;
    check(
      await db.from("orders").update({
        fields: o.fields, status: o.status, updated_after_confirmation: o.updated_after_confirmation,
        updated_at: o.updated_at, confirmed_at: o.confirmed_at,
      }).eq("id", o.id),
      "update order",
    );
  }

  const insert = async (table: string, rows: object[]) => {
    if (rows.length) check(await db.from(table).insert(rows), `insert ${table}`);
  };
  await insert("order_events", changed.flatMap((d) => d.newEvents));
  await insert("update_notes", changed.flatMap((d) => d.newNotes));
  await insert("pending_requests", changed.flatMap((d) => d.newPending));
  await insert("flags", [...changed.flatMap((d) => d.newFlags), ...ws.customerFlags]);
  await insert("attachments", [...changed.flatMap((d) => d.newAttachments), ...ws.orphanAttachments]);

  for (const d of changed) {
    const flagIds = [...d.touchedFlagIds];
    if (flagIds.length) check(await db.from("flags").update({ resolved: true }).in("id", flagIds), "resolve flags");
    for (const p of d.pending.filter((p) => d.touchedPendingIds.has(p.id))) {
      check(await db.from("pending_requests").update({ resolved: p.resolved }).eq("id", p.id), "resolve pending");
    }
  }
}

/** Has the business sent any message to this customer after `sentAt`? */
export async function businessRepliedAfter(customerId: string, sentAt: string): Promise<boolean> {
  const rows = check(
    await getSupabase().from("messages").select("id").eq("customer_id", customerId)
      .eq("direction", "out").gt("sent_at", sentAt).limit(1),
    "check business replies",
  ) as { id: string }[];
  return rows.length > 0;
}
