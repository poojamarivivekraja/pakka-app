import type { Flag } from "@/types/db";

// The "Rahul's order needs review" toast: which new flags become which toasts. Pure.

export type ToastItem = {
  /** Stable key, so the browser never shows the same toast twice. */
  key: string;
  text: string;
  href: string;
  flagIds: string[];
};

type FlagRow = Pick<Flag, "id" | "order_id" | "customer_id" | "created_at">;

/** One toast per order (or per customer, for a flag that belongs to no order). */
export function buildToasts(flags: FlagRow[], customerNames: Record<string, string>): ToastItem[] {
  const groups = new Map<string, { flags: FlagRow[]; order: string | null; customer: string }>();
  for (const f of [...flags].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const key = f.order_id ?? `customer-${f.customer_id}`;
    const g = groups.get(key) ?? { flags: [], order: f.order_id, customer: f.customer_id };
    g.flags.push(f);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const name = customerNames[g.customer] ?? "A customer";
    return {
      key: g.flags.map((f) => f.id).join("+"),
      text: g.order ? `${name}'s order needs review` : `A message from ${name} needs review`,
      href: g.order ? `/orders/${g.order}` : `/chats/${g.customer}`,
      flagIds: g.flags.map((f) => f.id),
    };
  });
}
