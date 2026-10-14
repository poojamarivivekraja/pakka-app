import "server-only";
import type { Customer, Flag, Order } from "@/types/db";
import { getSupabase } from "@/lib/supabase";
import type { OrderRow } from "@/lib/orders-view";

/** "919900000001" -> "+91 99000 00001"; anything else is shown as "+<digits>". */
export function formatPhone(waId: string): string {
  const m = /^91(\d{5})(\d{5})$/.exec(waId);
  return m ? `+91 ${m[1]} ${m[2]}` : `+${waId}`;
}

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

/** Every open order (not delivered or cancelled) with what the Orders screen needs. */
export async function loadOrderRows(): Promise<OrderRow[]> {
  const db = getSupabase();
  const orders = rows<Order>(await db.from("orders").select("*").not("status", "in", "(delivered,cancelled)"), "orders");
  if (orders.length === 0) return [];
  const orderIds = orders.map((o) => o.id);
  const customerIds = [...new Set(orders.map((o) => o.customer_id))];

  const [customers, flags, notes] = await Promise.all([
    db.from("customers").select("id, name, wa_id").in("id", customerIds).then((r) => rows<Pick<Customer, "id" | "name" | "wa_id">>(r, "customers")),
    db.from("flags").select("order_id, type, data").in("order_id", orderIds).eq("resolved", false)
      .then((r) => rows<Pick<Flag, "order_id" | "type" | "data">>(r, "flags")),
    db.from("update_notes").select("order_id").in("order_id", orderIds).eq("seen", false)
      .then((r) => rows<{ order_id: string }>(r, "notes")),
  ]);

  return orders.map((o) => {
    const c = customers.find((x) => x.id === o.customer_id);
    return {
      id: o.id,
      profileId: o.profile,
      status: o.status,
      fields: o.fields,
      updatedAfterConfirmation: o.updated_after_confirmation,
      customerName: c?.name?.trim() || (c ? formatPhone(c.wa_id) : "Unknown customer"),
      openFlags: flags.filter((f) => f.order_id === o.id).map((f) => ({ type: f.type, data: f.data })),
      unseenNotes: notes.filter((n) => n.order_id === o.id).length,
    };
  });
}
