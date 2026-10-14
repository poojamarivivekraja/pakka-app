import "server-only";
import type { Customer, Order } from "@/types/db";
import { getSupabase } from "@/lib/supabase";
import { mediaUrl } from "@/lib/media-url";
import { formatPhone } from "@/lib/orders-data";
import { customerPill, initialOf, listDate, previewOf, type ChatMessage } from "@/lib/chats-view";
import type { PillTone } from "@/components/StatusPill";

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

const MESSAGE_COLUMNS = "id, customer_id, direction, type, body, media_path, sent_at, status";
type ChatRowMessage = ChatMessage & { customer_id: string };

export const displayName = (c: Pick<Customer, "name" | "wa_id">) => c.name?.trim() || formatPhone(c.wa_id);

export type ChatListRow = {
  id: string; name: string; initial: string; preview: string; date: string; tone: PillTone | null;
};

/** Customers, most recent conversation first. `today` is the app's demo date (YYYY-MM-DD). */
export async function loadChatList(today: string): Promise<ChatListRow[]> {
  const db = getSupabase();
  const [customers, messages, orders] = await Promise.all([
    db.from("customers").select("id, name, wa_id").then((r) => rows<Pick<Customer, "id" | "name" | "wa_id">>(r, "customers")),
    db.from("messages").select(MESSAGE_COLUMNS).neq("type", "edit").neq("type", "revoke")
      .order("sent_at", { ascending: false }).limit(3000).then((r) => rows<ChatRowMessage>(r, "messages")),
    db.from("orders").select("customer_id, status").not("status", "in", "(delivered,cancelled)").then((r) => rows<Pick<Order, "customer_id" | "status">>(r, "orders")),
  ]);

  const last = new Map<string, ChatRowMessage>();
  for (const m of messages) if (!last.has(m.customer_id)) last.set(m.customer_id, m);

  return customers
    .map((c) => {
      const m = last.get(c.id);
      const name = displayName(c);
      return {
        sortKey: m?.sent_at ?? "",
        row: {
          id: c.id, name, initial: initialOf(name), preview: previewOf(m), date: m ? listDate(m.sent_at, today) : "",
          tone: customerPill(orders.filter((o) => o.customer_id === c.id).map((o) => o.status)),
        },
      };
    })
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    .map((x) => x.row);
}

export type ChatPage = {
  customer: { id: string; name: string; phone: string; waId: string };
  messages: ChatMessage[];
  imageUrls: Record<string, string>;
};

export async function loadChat(customerId: string): Promise<ChatPage | null> {
  const db = getSupabase();
  const { data: customer, error } = await db.from("customers").select("id, name, wa_id").eq("id", customerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!customer) return null;
  const c = customer as Pick<Customer, "id" | "name" | "wa_id">;
  const messages = rows<ChatMessage>(
    await db.from("messages").select(MESSAGE_COLUMNS).eq("customer_id", customerId).order("sent_at"), "messages",
  );
  const imageUrls: Record<string, string> = {};
  await Promise.all(
    messages.filter((m) => m.type === "image" && m.media_path).map(async (m) => {
      const url = await mediaUrl(m.media_path!);
      if (url) imageUrls[m.id] = url;
    }),
  );
  return { customer: { id: c.id, name: displayName(c), phone: formatPhone(c.wa_id), waId: c.wa_id }, messages, imageUrls };
}
