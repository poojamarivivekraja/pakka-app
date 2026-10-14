import "server-only";
import type { Attachment, Customer, Flag, Message, Order, OrderEvent, PendingRequest, UpdateNote } from "@/types/db";
import { getProfile } from "@/config/profiles";
import { getSupabase } from "@/lib/supabase";
import { buildOrderDetail, type OrderDetailModel } from "@/lib/order-detail-model";

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

/** An address the browser can show: sample images from /public, private storage via a short-lived signed URL. */
async function imageUrl(mediaPath: string): Promise<string | null> {
  if (mediaPath.startsWith("samples/")) return `/${mediaPath}`;
  const { data } = await getSupabase().storage.from("media").createSignedUrl(mediaPath, 3600);
  return data?.signedUrl ?? null;
}

/** Everything the order page shows, or null when the order doesn't exist. */
export async function loadOrderDetail(orderId: string): Promise<OrderDetailModel | null> {
  const db = getSupabase();
  const { data: orderRow, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!orderRow) return null;
  const order = orderRow as Order;

  const [customer, ownFlags, customerFlags, notes, pending, attachments, events, messages, others] = await Promise.all([
    db.from("customers").select("*").eq("id", order.customer_id).single().then((r) => {
      if (r.error) throw new Error(r.error.message);
      return r.data as Customer;
    }),
    db.from("flags").select("*").eq("order_id", orderId).then((r) => rows<Flag>(r, "flags")),
    // A "which order?" question lives on one order but concerns every candidate.
    db.from("flags").select("*").eq("customer_id", order.customer_id).eq("type", "which_order").eq("resolved", false).then((r) => rows<Flag>(r, "which-order flags")),
    db.from("update_notes").select("*").eq("order_id", orderId).order("created_at").then((r) => rows<UpdateNote>(r, "notes")),
    db.from("pending_requests").select("*").eq("order_id", orderId).order("created_at").then((r) => rows<PendingRequest>(r, "pending")),
    db.from("attachments").select("*").eq("order_id", orderId).order("created_at").then((r) => rows<Attachment>(r, "attachments")),
    db.from("order_events").select("*").eq("order_id", orderId).order("created_at").then((r) => rows<OrderEvent>(r, "events")),
    db.from("messages").select("id, direction, type, body, media_path, sent_at").eq("customer_id", order.customer_id).order("sent_at").then((r) => rows<Pick<Message, "id" | "direction" | "type" | "body" | "media_path" | "sent_at">>(r, "messages")),
    db.from("orders").select("id, fields").eq("customer_id", order.customer_id).neq("id", orderId).not("status", "in", "(delivered,cancelled)").then((r) => rows<Pick<Order, "id" | "fields">>(r, "other orders")),
  ]);

  const flags = [...ownFlags];
  for (const f of customerFlags) {
    const candidates = (f.data?.candidate_order_ids as string[] | undefined) ?? [];
    if (candidates.includes(orderId) && !flags.some((x) => x.id === f.id)) flags.push(f);
  }

  const imageUrls: Record<string, string> = {};
  await Promise.all(
    messages.filter((m) => m.type === "image" && m.media_path).map(async (m) => {
      const url = await imageUrl(m.media_path!);
      if (url) imageUrls[m.id] = url;
    }),
  );

  return buildOrderDetail({
    order, customer: { name: customer.name, waId: customer.wa_id }, profile: getProfile(order.profile),
    flags, notes, pending, attachments, events, messages, imageUrls,
    siblings: others.map((o) => ({ id: o.id, items: o.fields.items_summary?.value ?? null, dueDate: o.fields.due_date?.value ?? null })),
  });
}
