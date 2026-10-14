// Calendar-date helpers on "YYYY-MM-DD" strings. Everything is done in UTC on plain dates,
// so the user's timezone can never shift a day. Safe in server and browser code.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string | undefined | null): value is string {
  if (!value) return false;
  const m = ISO.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function toUtc(iso: string): Date {
  const m = ISO.exec(iso)!;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** The Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const day = toUtc(iso).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((day + 6) % 7));
}

export const weekdayShort = (iso: string) => WEEKDAYS[toUtc(iso).getUTCDay()];
export const dayOfMonth = (iso: string) => String(toUtc(iso).getUTCDate());
export const monthShort = (iso: string) => MONTHS[toUtc(iso).getUTCMonth()];

/** "26 Oct" */
export const formatDayMonth = (iso: string) => `${dayOfMonth(iso)} ${monthShort(iso)}`;

/** "Mon 26 Oct" */
export const formatToday = (iso: string) => `${weekdayShort(iso)} ${formatDayMonth(iso)}`;

/** "2 – 8 Nov" within a month, "26 Oct – 1 Nov" across months. */
export function formatRange(startIso: string, endIso: string): string {
  return monthShort(startIso) === monthShort(endIso)
    ? `${dayOfMonth(startIso)} – ${dayOfMonth(endIso)} ${monthShort(endIso)}`
    : `${formatDayMonth(startIso)} – ${formatDayMonth(endIso)}`;
}

/** "17:00" -> "5:00 pm". Also accepts "5 pm" / "5:30pm". Returns null if it isn't a time. */
export function formatTime12(value: string | undefined | null): string | null {
  const m = value?.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ?? "00";
  if (hour > 23 || Number(minute) > 59) return null;
  if (m[3] === "pm" && hour < 12) hour += 12;
  if (m[3] === "am" && hour === 12) hour = 0;
  const suffix = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${minute} ${suffix}`;
}

/** Minutes since midnight for sorting; unknown times sort last. */
export function timeSortKey(value: string | undefined | null): number {
  const t = formatTime12(value);
  if (!t) return 24 * 60;
  const m = t.match(/^(\d+):(\d+) (am|pm)$/)!;
  let hour = Number(m[1]) % 12;
  if (m[3] === "pm") hour += 12;
  return hour * 60 + Number(m[2]);
}

/** "5 pm" / "5:30pm" / "17:00" -> "17:00" (24-hour, as stored). Returns null if it isn't a time. */
export function normaliseTime24(value: string | undefined | null): string | null {
  const m = value?.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ?? "00";
  if (hour > 23 || Number(minute) > 59) return null;
  if (m[3] === "pm" && hour < 12) hour += 12;
  if (m[3] === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}
