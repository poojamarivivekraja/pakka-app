import { Suspense } from "react";
import Link from "next/link";
import { OrderCard } from "@/components/OrderCard";
import { SyncStatus } from "@/components/SyncStatus";
import { getToday } from "@/lib/demo-date";
import { formatToday } from "@/lib/dates";
import { loadOrderRows } from "@/lib/orders-data";
import { FILTERS, buildOrdersView, parseFilter } from "@/lib/orders-view";

export default function OrdersPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  return (
    <>
      <header className="flex items-center justify-between px-5 pt-5">
        <span className="text-[22px] font-bold text-primary">Pakka</span>
        <SyncStatus />
      </header>
      <Suspense fallback={<p className="px-5 pt-6 text-sm text-muted">Loading orders…</p>}>
        <OrdersContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function OrdersContent({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const filter = parseFilter((await searchParams).filter);
  const today = getToday();
  const view = buildOrdersView(await loadOrderRows(), today, filter);

  return (
    <>
      <div className="mt-4 flex items-baseline justify-between px-5">
        <h1 className="text-[28px] font-bold leading-tight text-ink">Orders</h1>
        <span className="text-sm text-muted">Today · {formatToday(today)}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 px-5">
        <Stat label="Open" value={view.counts.open} />
        <Stat label="Need review" value={view.counts.needsReview} tone="review" />
        <Stat label="Due this week" value={view.counts.dueThisWeek} />
      </div>

      <nav aria-label="Filter orders" className="mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
        {FILTERS.map((f) => {
          const selected = f.key === filter;
          return (
            <Link
              key={f.key}
              href={f.key === "all" ? "/" : `/?filter=${f.key}`}
              aria-current={selected ? "true" : undefined}
              className={`whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-semibold ${
                selected ? "bg-ink text-surface" : "border border-border bg-surface text-ink"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {view.groups.length === 0 && (
        <p className="px-5 pt-8 text-center text-sm text-muted">
          {filter === "all" ? "No orders yet. They appear here as customers message you." : "No orders in this view."}
        </p>
      )}
      {view.groups.map((g) => (
        <section key={g.key} className="mt-6">
          <h2 className="mb-2 px-5 text-[11px] uppercase tracking-wider">
            <span className="font-bold text-ink">{g.label}</span>
            <span className="text-muted"> · {g.range}</span>
          </h2>
          {g.cards.map((c) => <OrderCard key={c.id} card={c} />)}
        </section>
      ))}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "review" }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-3">
      <p className={`text-2xl font-bold leading-none ${tone === "review" ? "text-review-fg" : "text-ink"}`}>{value}</p>
      <p className="mt-1.5 text-xs text-muted">{label}</p>
    </div>
  );
}
