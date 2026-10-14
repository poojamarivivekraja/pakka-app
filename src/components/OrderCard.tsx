import Link from "next/link";
import { StatusPill } from "@/components/StatusPill";
import type { OrderCardData } from "@/lib/orders-view";

export function OrderCard({ card }: { card: OrderCardData }) {
  return (
    <Link
      href={`/orders/${card.id}`}
      className="mx-5 mb-3 flex gap-3 rounded-2xl border border-border bg-surface p-3"
    >
      {/* Neutral date block */}
      <div className="flex w-[60px] shrink-0 flex-col items-center justify-center rounded-xl bg-dateblock py-2">
        {card.day ? (
          <>
            <span className={`text-[11px] font-bold ${card.isNextUp ? "text-primary" : "text-muted"}`}>{card.weekday}</span>
            <span className="text-[26px] font-bold leading-tight text-ink">{card.day}</span>
            <span className="text-xs text-muted">{card.month}</span>
          </>
        ) : (
          <>
            <span className="text-[11px] font-bold text-muted">Due</span>
            <span className="text-[26px] font-bold leading-tight text-ink">–</span>
            <span className="text-xs text-muted">date</span>
          </>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            {card.isNextUp && <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Next up</p>}
            <p className="text-ink">
              {card.time ? (
                <span className="text-[17px] font-bold">{card.time}</span>
              ) : (
                <span className="text-[15px] font-bold text-review-fg">Time missing</span>
              )}
              {card.fulfilment && <span className="text-sm text-muted"> · {card.fulfilment}</span>}
            </p>
          </div>
          <StatusPill tone={card.tone} />
        </div>
        <p className="mt-1 truncate text-[15px] font-semibold text-ink">{card.title}</p>
        <p className={`truncate text-sm ${card.items ? "text-ink" : "text-muted"}`}>{card.items ?? "No item summary yet"}</p>
        {card.issue && <p className="mt-0.5 truncate text-xs text-review-fg">{card.issue}</p>}
      </div>
    </Link>
  );
}
