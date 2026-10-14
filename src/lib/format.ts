// Small formatting helpers that are safe to use in the browser.

const BUSINESS_TIMEZONE = "Asia/Kolkata";

/** "22 Oct, 9:20 am" in the business timezone. */
export function formatChatStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: BUSINESS_TIMEZONE, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

const parts = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: BUSINESS_TIMEZONE, ...opts }).formatToParts(new Date(iso));
const pick = (p: Intl.DateTimeFormatPart[], t: string) => p.find((x) => x.type === t)?.value ?? "";

/** "9:20 am" in the business timezone. */
export function formatClock(iso: string): string {
  const p = parts(iso, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${pick(p, "hour")}:${pick(p, "minute")} ${pick(p, "dayPeriod").toLowerCase()}`;
}

/** "22 Oct" in the business timezone. */
export function formatShortDate(iso: string): string {
  const p = parts(iso, { day: "numeric", month: "short" });
  return `${pick(p, "day")} ${pick(p, "month")}`;
}

/** "Thu 22 Oct" in the business timezone. */
export function formatDayLabel(iso: string): string {
  const p = parts(iso, { weekday: "short", day: "numeric", month: "short" });
  return `${pick(p, "weekday")} ${pick(p, "day")} ${pick(p, "month")}`;
}

/** The calendar day (YYYY-MM-DD) of a timestamp in the business timezone. */
export function businessDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE }).format(new Date(iso));
}
