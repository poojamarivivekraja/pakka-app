import type { Flag, OrderFields, OrderStatus } from "@/types/db";
import { getProfile } from "@/config/profiles";
import type { PillTone } from "@/components/StatusPill";
import {
  addDays, dayOfMonth, formatRange, formatTime12, isIsoDate, monthShort,
  timeSortKey, weekStart, weekdayShort,
} from "./dates";

// Everything the Orders screen shows, worked out from plain rows. Pure, so it is tested offline.

export type OrderFilter = "all" | "needs_review" | "ready" | "confirmed";

export const FILTERS: { key: OrderFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "ready", label: "Ready" },
  { key: "confirmed", label: "Confirmed" },
];

export const parseFilter = (value: string | undefined): OrderFilter =>
  FILTERS.some((f) => f.key === value) ? (value as OrderFilter) : "all";

export type OrderRow = {
  id: string;
  profileId: string;
  status: OrderStatus;
  fields: OrderFields;
  updatedAfterConfirmation: boolean;
  customerName: string;
  /** Unresolved flags only. */
  openFlags: Pick<Flag, "type" | "data">[];
  /** Update notes the owner hasn't dismissed with "Got it". */
  unseenNotes: number;
};

export type OrderCardData = {
  id: string;
  /** Null when the order has no due date yet. */
  weekday: string | null;
  day: string | null;
  month: string | null;
  /** "5:00 pm", or null when the time is missing. */
  time: string | null;
  fulfilment: string | null;
  title: string;
  items: string | null;
  tone: PillTone;
  issue: string | null;
  isNextUp: boolean;
};

export type OrderGroup = { key: string; label: string; range: string; cards: OrderCardData[] };

export type OrdersView = {
  counts: { open: number; needsReview: number; dueThisWeek: number };
  groups: OrderGroup[];
};

const value = (row: OrderRow, key: string) => row.fields[key]?.value?.trim() || undefined;

export function pillTone(row: Pick<OrderRow, "status" | "updatedAfterConfirmation" | "unseenNotes">): PillTone {
  if (row.status === "needs_review") return "review";
  if (row.status === "confirmed") return row.updatedAfterConfirmation ? "updated" : "confirmed";
  return row.unseenNotes > 0 ? "updated" : "ready";
}

const ISSUE_ORDER = ["which_order", "conflict", "payment_mismatch", "message_deleted", "message_unreadable", "low_confidence", "missing_field"];

/** One short line about what needs the owner, e.g. "Missing: price agreed, address". */
export function issueSummary(row: OrderRow): string | null {
  if (row.openFlags.length === 0) return null;
  const profile = getProfile(row.profileId);
  const label = (key: unknown) => (profile.fields.find((f) => f.key === key)?.label ?? String(key)).toLowerCase();
  const parts: string[] = [];

  for (const type of ISSUE_ORDER) {
    const flags = row.openFlags.filter((f) => f.type === type);
    if (flags.length === 0) continue;
    if (type === "missing_field") parts.push(`Missing: ${flags.map((f) => label(f.data?.field)).join(", ")}`);
    else if (type === "conflict") parts.push(`${flags.map((f) => label(f.data?.field)).join(", ")} conflict`.replace(/^./, (c) => c.toUpperCase()));
    else if (type === "low_confidence") parts.push(`Check ${flags.map((f) => label(f.data?.field)).join(", ")}`);
    else if (type === "payment_mismatch") parts.push("Payment differs from advance asked");
    else if (type === "which_order") parts.push("Which order is this about?");
    else if (type === "message_deleted") parts.push("A message was deleted");
    else if (type === "message_unreadable") parts.push("A message couldn't be read");
  }
  return parts.length > 2 ? `${parts.slice(0, 2).join(" · ")} · +${parts.length - 2} more` : parts.join(" · ");
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sortKey(row: OrderRow): [string, number] {
  return [value(row, "due_date") ?? "9999-12-31", timeSortKey(value(row, "due_time"))];
}

const byDateTime = (a: OrderRow, b: OrderRow) => {
  const [da, ta] = sortKey(a);
  const [db, tb] = sortKey(b);
  return da === db ? ta - tb : da < db ? -1 : 1;
};

function toCard(row: OrderRow, nextUpId: string | null): OrderCardData {
  const due = value(row, "due_date");
  const hasDate = isIsoDate(due);
  const occasion = value(row, "occasion");
  const fulfilment = value(row, "fulfilment");
  return {
    id: row.id,
    weekday: hasDate ? weekdayShort(due) : null,
    day: hasDate ? dayOfMonth(due) : null,
    month: hasDate ? monthShort(due) : null,
    time: formatTime12(value(row, "due_time")),
    fulfilment: fulfilment ? cap(fulfilment) : null,
    title: occasion ? `${row.customerName} · ${occasion}` : row.customerName,
    items: value(row, "items_summary") ?? null,
    tone: pillTone(row),
    issue: issueSummary(row),
    isNextUp: row.id === nextUpId,
  };
}

/** Groups, counts and the "Next up" marker for the Orders screen. `today` is YYYY-MM-DD. */
export function buildOrdersView(rows: OrderRow[], today: string, filter: OrderFilter): OrdersView {
  const thisWeek = weekStart(today);
  const thisWeekEnd = addDays(thisWeek, 6);
  const dueOf = (r: OrderRow) => {
    const d = value(r, "due_date");
    return isIsoDate(d) ? d : null;
  };

  const counts = {
    open: rows.length,
    needsReview: rows.filter((r) => r.status === "needs_review").length,
    dueThisWeek: rows.filter((r) => {
      const d = dueOf(r);
      return d !== null && d >= today && d <= thisWeekEnd;
    }).length,
  };

  const upcoming = rows.filter((r) => { const d = dueOf(r); return d !== null && d >= today; }).sort(byDateTime);
  const nextUpId = upcoming[0]?.id ?? null;

  const shown = rows.filter((r) => filter === "all" || r.status === filter).sort(byDateTime);

  const groups: OrderGroup[] = [];
  const weekGroups = new Map<string, OrderRow[]>();
  const noDate: OrderRow[] = [];
  const earlier: OrderRow[] = [];

  for (const r of shown) {
    const d = dueOf(r);
    if (d === null) noDate.push(r);
    else if (d < today) earlier.push(r);
    else {
      const ws = weekStart(d);
      weekGroups.set(ws, [...(weekGroups.get(ws) ?? []), r]);
    }
  }

  for (const ws of [...weekGroups.keys()].sort()) {
    const label = ws === thisWeek ? "THIS WEEK" : ws === addDays(thisWeek, 7) ? "NEXT WEEK" : "LATER";
    groups.push({
      key: `week-${ws}`, label, range: formatRange(ws, addDays(ws, 6)),
      cards: weekGroups.get(ws)!.map((r) => toCard(r, nextUpId)),
    });
  }
  if (noDate.length) groups.push({ key: "no-date", label: "DATE MISSING", range: "add a due date", cards: noDate.map((r) => toCard(r, nextUpId)) });
  if (earlier.length) {
    groups.push({ key: "earlier", label: "EARLIER", range: "before today", cards: earlier.reverse().map((r) => toCard(r, nextUpId)) });
  }
  return { counts, groups };
}
