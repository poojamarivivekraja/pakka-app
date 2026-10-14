// Offline checks for the Orders screen's date and grouping logic. No database, no AI.
import { addDays, formatRange, formatTime12, formatToday, isIsoDate, weekStart, weekdayShort } from "@/lib/dates";
import { buildOrdersView, issueSummary, parseFilter, pillTone, type OrderRow } from "@/lib/orders-view";
import type { OrderStatus } from "@/types/db";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}

const TODAY = "2026-10-26"; // a Monday
let n = 0;
function row(over: Partial<OrderRow> & { due?: string; time?: string; status?: OrderStatus; items?: string; occasion?: string; customer?: string; fulfilment?: string }): OrderRow {
  const f = (value: string) => ({ value, source_message_id: null, confidence: "high" as const, updated_at: "", previous_value: null, edited_by_owner: false });
  const fields: OrderRow["fields"] = {};
  if (over.due) fields.due_date = f(over.due);
  if (over.time) fields.due_time = f(over.time);
  if (over.items) fields.items_summary = f(over.items);
  if (over.occasion) fields.occasion = f(over.occasion);
  if (over.fulfilment) fields.fulfilment = f(over.fulfilment);
  return {
    id: `o${++n}`, profileId: "bakery", status: over.status ?? "ready", fields, updatedAfterConfirmation: false,
    customerName: over.customer ?? "Asha", openFlags: [], unseenNotes: 0, ...("openFlags" in over ? { openFlags: over.openFlags! } : {}),
    ...("unseenNotes" in over ? { unseenNotes: over.unseenNotes! } : {}),
    ...("updatedAfterConfirmation" in over ? { updatedAfterConfirmation: over.updatedAfterConfirmation! } : {}),
  };
}

// ---- dates
check("dates: weekStart of a Monday is itself", weekStart("2026-10-26") === "2026-10-26");
check("dates: weekStart of a Sunday is the Monday before", weekStart("2026-11-01") === "2026-10-26");
check("dates: addDays crosses a month", addDays("2026-10-30", 3) === "2026-11-02");
check("dates: weekday and today label", weekdayShort("2026-10-26") === "Mon" && formatToday("2026-10-26") === "Mon 26 Oct");
check("dates: range across months", formatRange("2026-10-26", "2026-11-01") === "26 Oct – 1 Nov");
check("dates: range inside a month", formatRange("2026-11-02", "2026-11-08") === "2 – 8 Nov");
check("dates: bad dates are rejected", !isIsoDate("2026-02-30") && !isIsoDate("tomorrow") && isIsoDate("2026-02-28"));
check("dates: 24-hour time to 12-hour", formatTime12("17:00") === "5:00 pm" && formatTime12("09:05") === "9:05 am" && formatTime12("00:30") === "12:30 am" && formatTime12("12:00") === "12:00 pm");
check("dates: other time spellings", formatTime12("5 pm") === "5:00 pm" && formatTime12("5:30PM") === "5:30 pm" && formatTime12("soon") === null && formatTime12("") === null);

// ---- grouping
const rows = [
  row({ due: "2026-10-24", time: "17:00", customer: "Priya" }),            // before today
  row({ due: "2026-10-26", time: "10:00", customer: "Today" }),             // today
  row({ due: "2026-10-31", time: "19:00", status: "needs_review" }),        // this week
  row({ due: "2026-11-01", time: "09:00" }),                                // Sunday, still this week
  row({ due: "2026-11-02", time: "11:00", status: "confirmed" }),           // next week
  row({ due: "2026-11-12", time: "11:00" }),                                // later
  row({ customer: "NoDate" }),                                              // no due date
];
const view = buildOrdersView(rows, TODAY, "all");
const labels = view.groups.map((g) => `${g.label} · ${g.range}`);
check("groups: this week comes first with its date range", labels[0] === "THIS WEEK · 26 Oct – 1 Nov", labels[0]);
check("groups: next week second", labels[1] === "NEXT WEEK · 2 – 8 Nov", labels[1]);
check("groups: later weeks follow", labels[2] === "LATER · 9 – 15 Nov", labels[2]);
check("groups: orders with no date have their own group", labels[3]?.startsWith("DATE MISSING"), labels[3]);
check("groups: Earlier is last", labels[labels.length - 1] === "EARLIER · before today", labels.join(" | "));
check("groups: Earlier holds only orders before today", view.groups.at(-1)!.cards.length === 1 && view.groups.at(-1)!.cards[0].title.startsWith("Priya"));
check("groups: an order due today is in This week", view.groups[0].cards.some((c) => c.title.startsWith("Today")));
check("groups: cards are sorted by date then time", view.groups[0].cards.map((c) => c.day).join() === "26,31,1");

// ---- counts
check("counts: open = every order passed in", view.counts.open === 7);
check("counts: needs review", view.counts.needsReview === 1);
check("counts: due this week excludes earlier and later weeks", view.counts.dueThisWeek === 3, String(view.counts.dueThisWeek));

// ---- next up
const flat = view.groups.flatMap((g) => g.cards);
const next = flat.filter((c) => c.isNextUp);
check("next up: exactly one card", next.length === 1);
check("next up: it is the soonest order from today on", next[0]?.title.startsWith("Today"), next[0]?.title);
check("next up: not an order before today or without a date",
  !flat.find((c) => c.title.startsWith("Priya"))!.isNextUp && !flat.find((c) => c.title.startsWith("NoDate"))!.isNextUp);

// ---- filters
check("filter: needs_review", buildOrdersView(rows, TODAY, "needs_review").groups.flatMap((g) => g.cards).length === 1);
check("filter: confirmed", buildOrdersView(rows, TODAY, "confirmed").groups.flatMap((g) => g.cards).length === 1);
check("filter: ready", buildOrdersView(rows, TODAY, "ready").groups.flatMap((g) => g.cards).length === 5);
check("filter: counts ignore the filter", buildOrdersView(rows, TODAY, "confirmed").counts.open === 7);
check("filter: unknown values fall back to All", parseFilter("nonsense") === "all" && parseFilter(undefined) === "all" && parseFilter("ready") === "ready");
check("filter: next up is still found when its card is filtered out", buildOrdersView(rows, TODAY, "confirmed").groups.flatMap((g) => g.cards).every((c) => !c.isNextUp));

// ---- card content
const solo = buildOrdersView([row({ due: "2026-10-28", time: "17:00", fulfilment: "pickup", customer: "Meera", occasion: "baby shower", items: "a box of 12 brownies" })], TODAY, "all").groups[0].cards[0];
check("card: date block parts", solo.weekday === "Wed" && solo.day === "28" && solo.month === "Oct");
check("card: time and fulfilment", solo.time === "5:00 pm" && solo.fulfilment === "Pickup");
check("card: customer · occasion and items", solo.title === "Meera · baby shower" && solo.items === "a box of 12 brownies");
const bare = buildOrdersView([row({ due: "2026-10-28", customer: "Meera" })], TODAY, "all").groups[0].cards[0];
check("card: a missing time is null so the screen can say 'Time missing'", bare.time === null);
check("card: no occasion means just the customer", bare.title === "Meera");

// ---- pills
check("pill: needs review", pillTone(row({ status: "needs_review" })) === "review");
check("pill: ready to confirm", pillTone(row({ status: "ready" })) === "ready");
check("pill: confirmed", pillTone(row({ status: "confirmed" })) === "confirmed");
check("pill: confirmed and then changed in chat", pillTone(row({ status: "confirmed", updatedAfterConfirmation: true })) === "updated");
check("pill: ready with an unread change from chat", pillTone(row({ status: "ready", unseenNotes: 1 })) === "updated");
check("pill: needs review wins over an unread change", pillTone(row({ status: "needs_review", unseenNotes: 2 })) === "review");

// ---- issue summary
const flagged = (flags: OrderRow["openFlags"]) => issueSummary(row({ status: "needs_review", openFlags: flags }));
check("issue: none when there are no flags", issueSummary(row({})) === null);
check("issue: missing fields are listed with their labels", flagged([{ type: "missing_field", data: { field: "price_agreed" } }, { type: "missing_field", data: { field: "address" } }]) === "Missing: price agreed, address");
check("issue: conflict names the field", flagged([{ type: "conflict", data: { field: "price_agreed" } }]) === "Price agreed conflict");
check("issue: payment mismatch", flagged([{ type: "payment_mismatch", data: null }]) === "Payment differs from advance asked");
check("issue: never says 'paid'", !/paid/i.test(flagged([{ type: "payment_mismatch", data: null }]) ?? ""));
check("issue: most urgent first, then '+N more'",
  flagged([{ type: "missing_field", data: { field: "address" } }, { type: "conflict", data: { field: "price_agreed" } }, { type: "payment_mismatch", data: null }]) === "Price agreed conflict · Payment differs from advance asked · +1 more");

process.exit(failed ? 1 : 0);
