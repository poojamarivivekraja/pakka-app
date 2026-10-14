"use client";

import { useSyncPaused } from "@/lib/sync-store";

/** The small status at the top right of the Orders header. */
export function SyncStatus() {
  const [paused] = useSyncPaused();
  return paused
    ? <span className="text-xs font-semibold text-review-fg">● Sync paused</span>
    : <span className="text-xs font-semibold text-confirmed-fg">● Synced just now</span>;
}
