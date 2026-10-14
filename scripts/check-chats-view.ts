// Offline checks for the Chats screens' logic and the toast builder. No database, no AI.
import { buildChat, customerPill, initialOf, listDate, previewOf, type ChatMessage } from "@/lib/chats-view";
import { buildToasts } from "@/lib/notifications";
import { businessDay, formatClock, formatDayLabel, formatShortDate } from "@/lib/format";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: `m${Math.random()}`, direction: "in", type: "text", body: "hi", media_path: null,
  sent_at: "2026-10-22T03:50:00Z", status: "processed", ...over,
});

// ---- time formatting (India time)
check("format: clock", formatClock("2026-10-22T03:50:00Z") === "9:20 am");
check("format: short date", formatShortDate("2026-10-22T03:50:00Z") === "22 Oct");
check("format: day label", formatDayLabel("2026-10-22T03:50:00Z") === "Thu 22 Oct");
check("format: late evening UTC is already the next day in India", businessDay("2026-10-22T20:00:00Z") === "2026-10-23");

// ---- previews
check("preview: customer text", previewOf(msg({ body: "Pickup at 5 pm is fine?" })) === "Pickup at 5 pm is fine?");
check("preview: business text is prefixed", previewOf(msg({ direction: "out", body: "Perfect." })) === "You: Perfect.");
check("preview: whitespace is collapsed", previewOf(msg({ body: "a\n\n  b" })) === "a b");
check("preview: image", previewOf(msg({ type: "image", body: null })) === "Photo");
check("preview: image with caption", previewOf(msg({ type: "image", body: "the design" })) === "Photo · the design");
check("preview: deleted, edited and unreadable", previewOf(msg({ status: "revoked" })) === "Deleted a message" && previewOf(msg({ type: "edit" })) === "Edited a message" && previewOf(msg({ type: "unsupported" })) === "Message couldn't be read");
check("preview: empty chat", previewOf(undefined) === "No messages yet");

// ---- pill, date, avatar
check("pill: needs review wins", customerPill(["ready", "needs_review", "confirmed"]) === "review");
check("pill: confirmed beats ready", customerPill(["ready", "confirmed"]) === "confirmed");
check("pill: ready", customerPill(["ready"]) === "ready");
check("pill: none without open orders", customerPill([]) === null);
check("list date: today shows the time, earlier shows the date", listDate("2026-10-26T04:30:00Z", "2026-10-26") === "10:00 am" && listDate("2026-10-22T03:50:00Z", "2026-10-26") === "22 Oct");
check("avatar: initial is upper-case; falls back to ?", initialOf("priya") === "P" && initialOf("  rahul") === "R" && initialOf("+91 99") === "9" && initialOf("") === "?");

// ---- read-only chat
const chat = buildChat([
  msg({ id: "b", direction: "out", body: "Reply", sent_at: "2026-10-19T04:45:00Z" }),
  msg({ id: "a", body: "Hello", sent_at: "2026-10-19T04:32:00Z" }),
  msg({ id: "c", body: "New day", sent_at: "2026-10-20T10:00:00Z" }),
  msg({ id: "e1", type: "edit", body: "edited text", sent_at: "2026-10-20T10:03:00Z" }),
  msg({ id: "r1", type: "revoke", body: null, sent_at: "2026-10-20T10:05:00Z" }),
]);
check("chat: sorted by time with a separator for each day", chat.map((e) => (e.kind === "day" ? `[${e.label}]` : e.key)).join(" ") === "[Mon 19 Oct] a b [Tue 20 Oct] c", chat.map((e) => e.key).join());
check("chat: edit and delete events are not shown as bubbles", !chat.some((e) => e.key === "e1" || e.key === "r1"));
const odd = buildChat([
  msg({ id: "x", body: "now fixed", status: "edited" }),
  msg({ id: "y", body: "secret", status: "revoked", sent_at: "2026-10-22T03:51:00Z" }),
  msg({ id: "z", type: "unsupported", body: null, sent_at: "2026-10-22T03:52:00Z" }),
  msg({ id: "i", type: "image", body: null, media_path: "samples/payment_700.png", sent_at: "2026-10-22T03:53:00Z", direction: "out" }),
]).filter((e) => e.kind === "message");
const by = (k: string) => odd.find((e) => e.key === k) as Extract<(typeof odd)[number], { kind: "message" }>;
check("chat: an edited message shows its new text and is marked edited", by("x").text === "now fixed" && by("x").edited);
check("chat: a deleted message hides its text", by("y").text === "This message was deleted" && by("y").italic && !JSON.stringify(by("y")).includes("secret"));
check("chat: an unreadable message is said so", by("z").unreadable && by("z").text === "A message Pakka couldn't read");
check("chat: images keep their path and direction", by("i").mediaPath === "samples/payment_700.png" && by("i").direction === "out");

// ---- toasts
const names = { c1: "Rahul", c2: "Priya" };
const t = buildToasts([
  { id: "f1", order_id: "o1", customer_id: "c1", created_at: "2026-10-22T04:00:00Z" },
  { id: "f2", order_id: "o1", customer_id: "c1", created_at: "2026-10-22T04:00:01Z" },
  { id: "f3", order_id: "o2", customer_id: "c2", created_at: "2026-10-22T04:00:02Z" },
  { id: "f4", order_id: null, customer_id: "c2", created_at: "2026-10-22T04:00:03Z" },
], names);
check("toast: one per order", t.length === 3);
check("toast: text and link", t[0].text === "Rahul's order needs review" && t[0].href === "/orders/o1");
check("toast: several flags on one order share a toast and a key", t[0].flagIds.join() === "f1,f2" && t[0].key === "f1+f2");
check("toast: a flag with no order points to the chat", t[2].text === "A message from Priya needs review" && t[2].href === "/chats/c2");
check("toast: unknown customer is still readable", buildToasts([{ id: "f", order_id: "o", customer_id: "zz", created_at: "x" }], {})[0].text === "A customer's order needs review");
check("toast: nothing in, nothing out", buildToasts([], names).length === 0);

process.exit(failed ? 1 : 0);
