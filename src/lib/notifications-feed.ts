import "server-only";
import { getSupabase } from "@/lib/supabase";
import { displayName } from "@/lib/chats-data";
import { buildToasts, type ToastItem } from "@/lib/notifications";

/**
 * Toasts for flags created since `since`. Without a usable `since` it only returns the server's
 * clock, so a freshly opened page never shows old items.
 */
export async function loadNotifications(since: string | null): Promise<{ now: string; toasts: ToastItem[] }> {
  const now = new Date().toISOString();
  if (!since || Number.isNaN(Date.parse(since))) return { now, toasts: [] };

  const db = getSupabase();
  const { data: flags, error } = await db.from("flags").select("id, order_id, customer_id, created_at")
    .gt("created_at", new Date(since).toISOString()).eq("resolved", false).order("created_at").limit(50);
  if (error) throw new Error(error.message);
  if (!flags?.length) return { now, toasts: [] };

  const { data: customers } = await db.from("customers").select("id, name, wa_id").in("id", [...new Set(flags.map((f) => f.customer_id))]);
  const names = Object.fromEntries((customers ?? []).map((c) => [c.id, displayName(c)]));
  return { now, toasts: buildToasts(flags, names).slice(0, 5) };
}
