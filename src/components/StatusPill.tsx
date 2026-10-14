// Soft-tinted status pill (never a large filled area). Colours come from theme.css.

export type PillTone = "confirmed" | "updated" | "review" | "ready";

const TONE: Record<PillTone, { label: string; classes: string }> = {
  confirmed: { label: "Confirmed", classes: "bg-confirmed-bg text-confirmed-fg" },
  updated: { label: "Updated from chat", classes: "bg-updated-bg text-updated-fg" },
  review: { label: "Needs review", classes: "bg-review-bg text-review-fg" },
  ready: { label: "Ready to confirm", classes: "bg-ready-bg text-ready-fg" },
};

export const pillLabel = (tone: PillTone) => TONE[tone].label;

export function StatusPill({ tone }: { tone: PillTone }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${TONE[tone].classes}`}>
      {TONE[tone].label}
    </span>
  );
}
