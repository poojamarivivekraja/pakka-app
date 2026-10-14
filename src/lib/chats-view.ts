import type { Message, OrderStatus } from "@/types/db";
import type { PillTone } from "@/components/StatusPill";
import { businessDay, formatClock, formatDayLabel, formatShortDate } from "@/lib/format";

// Logic for the Chats screens, kept pure so it can be tested offline.

export type ChatMessage = Pick<Message, "id" | "direction" | "type" | "body" | "media_path" | "sent_at" | "status">;

/** One-line preview for the list: "You: ..." for the business, plain text for the customer. */
export function previewOf(m: ChatMessage | undefined): string {
  if (!m) return "No messages yet";
  let text: string;
  if (m.status === "revoked") text = "Deleted a message";
  else if (m.type === "image") text = m.body ? `Photo · ${m.body}` : "Photo";
  else if (m.type === "edit") text = "Edited a message";
  else if (m.type === "revoke") text = "Deleted a message";
  else if (m.type === "unsupported") text = "Message couldn't be read";
  else text = (m.body ?? "").replace(/\s+/g, " ").trim();
  return m.direction === "out" ? `You: ${text}` : text;
}

/** The pill for a customer in the list, from their open orders: Needs review beats Confirmed beats Ready. */
export function customerPill(statuses: OrderStatus[]): PillTone | null {
  if (statuses.includes("needs_review")) return "review";
  if (statuses.includes("confirmed")) return "confirmed";
  if (statuses.includes("ready")) return "ready";
  return null;
}

/** Time for today's messages, "22 Oct" for older ones (today = the app's demo date). */
export function listDate(iso: string, today: string): string {
  return businessDay(iso) === today ? formatClock(iso) : formatShortDate(iso);
}

export const initialOf = (name: string) => (name.trim().match(/\p{L}|\p{N}/u)?.[0] ?? "?").toUpperCase();

export type ChatEntry =
  | { kind: "day"; key: string; label: string }
  | {
      kind: "message"; key: string; direction: "in" | "out"; time: string;
      text: string | null; mediaPath: string | null; italic: boolean; edited: boolean; unreadable: boolean;
    };

/**
 * The read-only chat as the owner sees it: day separators, and only real messages.
 * Edit and delete events are not shown as bubbles; they change the original message instead.
 */
export function buildChat(messages: ChatMessage[]): ChatEntry[] {
  const sorted = [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const out: ChatEntry[] = [];
  let day = "";
  for (const m of sorted) {
    if (m.type === "edit" || m.type === "revoke") continue;
    const d = businessDay(m.sent_at);
    if (d !== day) {
      day = d;
      out.push({ kind: "day", key: `day-${d}`, label: formatDayLabel(m.sent_at) });
    }
    const deleted = m.status === "revoked";
    out.push({
      kind: "message", key: m.id, direction: m.direction, time: formatClock(m.sent_at),
      text: deleted ? "This message was deleted" : m.type === "unsupported" ? "A message Pakka couldn't read" : m.body,
      mediaPath: m.type === "image" && !deleted ? m.media_path : null,
      italic: deleted || m.type === "unsupported",
      edited: m.status === "edited",
      unreadable: m.type === "unsupported",
    });
  }
  return out;
}
