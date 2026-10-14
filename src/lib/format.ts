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
