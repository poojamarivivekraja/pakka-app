import { randomUUID } from "node:crypto";

// Pure helpers shared by the pipeline rules. No database or network access here.

export const BUSINESS_TIMEZONE = "Asia/Kolkata";

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export function normaliseText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Rule 1 test: case-insensitive, whitespace-normalised containment. */
export function quoteAppearsIn(quote: string, body: string): boolean {
  const q = normaliseText(quote);
  return q.length > 0 && normaliseText(body).includes(q);
}

/** First number in a money string: "₹1,400", "Rs. 700/-", "900" -> 1400, 700, 900. */
export function parseMoney(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  const match = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/** "22 Oct, 9:20 am" in the business timezone. */
export function formatChatTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: BUSINESS_TIMEZONE,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}

/** "Thursday 2026-10-22 09:20" in the business timezone: the date context given to the model. */
export function describeTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE }).format(d);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIMEZONE, weekday: "long" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${weekday} ${date} ${time}`;
}
