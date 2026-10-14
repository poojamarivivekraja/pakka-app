import "server-only";
import type { Attachment, Flag, Order, OrderEvent, PendingRequest, UpdateNote } from "@/types/db";
import { getSupabase } from "@/lib/supabase";

// Everything stored about one customer's orders, loaded in one go.
// Used by the simulator's side panel and by the scenario runner.

export type OrderSnap = {
  order: Order;
  flags: Flag[];
  pending: PendingRequest[];
  notes: UpdateNote[];
  events: OrderEvent[];
  attachments: Attachment[];
};

export type Snapshot = { orders: OrderSnap[]; customerFlags: Flag[] };

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

export async function loadSnapshot(customerId: string): Promise<Snapshot> {
  const db = getSupabase();
  const orders = rows<Order>(await db.from("orders").select("*").eq("customer_id", customerId).order("created_at"), "orders");
  const ids = orders.map((o) => o.id);
  const none = ids.length === 0;
  const [flags, pending, notes, events, attachments] = await Promise.all([
    db.from("flags").select("*").eq("customer_id", customerId).order("created_at").then((r) => rows<Flag>(r, "flags")),
    none ? [] : db.from("pending_requests").select("*").in("order_id", ids).order("created_at").then((r) => rows<PendingRequest>(r, "pending")),
    none ? [] : db.from("update_notes").select("*").in("order_id", ids).order("created_at").then((r) => rows<UpdateNote>(r, "notes")),
    none ? [] : db.from("order_events").select("*").in("order_id", ids).order("created_at").then((r) => rows<OrderEvent>(r, "events")),
    none ? [] : db.from("attachments").select("*").in("order_id", ids).order("created_at").then((r) => rows<Attachment>(r, "attachments")),
  ]);
  return {
    orders: orders.map((order) => ({
      order,
      flags: flags.filter((f) => f.order_id === order.id),
      pending: pending.filter((p) => p.order_id === order.id),
      notes: notes.filter((n) => n.order_id === order.id),
      events: events.filter((e) => e.order_id === order.id),
      attachments: attachments.filter((a) => a.order_id === order.id),
    })),
    customerFlags: flags.filter((f) => !f.order_id),
  };
}
