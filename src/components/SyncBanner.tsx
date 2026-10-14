"use client";

import { StatusPill } from "@/components/StatusPill";
import { useSyncPaused } from "@/lib/sync-store";

/** Persistent banner while sync is paused. "Reconnect" turns the simulation off. */
export function SyncBanner() {
  const [paused, setPaused] = useSyncPaused();
  if (!paused) return null;
  return (
    <div role="status" className="mx-5 mt-3 rounded-2xl border border-border border-l-[5px] border-l-review-fg bg-surface p-3">
      <StatusPill tone="review" label="Sync paused" />
      <p className="mt-2 text-[15px] font-semibold text-ink">WhatsApp disconnected</p>
      <p className="mt-0.5 text-sm text-muted">Orders may be out of date. Reconnect to keep them up to date.</p>
      <button type="button" onClick={() => setPaused(false)} className="tap mt-1 text-sm font-semibold text-primary">Reconnect</button>
    </div>
  );
}
