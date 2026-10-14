"use client";

import { useState } from "react";
import { useSyncPaused } from "@/lib/sync-store";

export function ConnectionCard() {
  const [paused] = useSyncPaused();
  const [note, setNote] = useState(false);
  return (
    <section className="mx-5 mt-4 rounded-2xl border border-border bg-surface p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink">WhatsApp Business</h2>
      <p className={`mt-3 text-sm font-semibold ${paused ? "text-review-fg" : "text-confirmed-fg"}`}>
        {paused ? "● Disconnected · sync paused" : "● Connected · synced just now"}
      </p>
      <p className="mt-2 text-sm text-muted">
        Pakka only reads your business chats to keep orders up to date. It never sends messages to your customers.
      </p>
      <button
        type="button"
        onClick={() => {
          if (window.confirm("Disconnect WhatsApp and delete all synced data? In this prototype, nothing will actually be deleted.")) setNote(true);
        }}
        className="tap mt-2 text-left text-sm font-semibold text-review-fg"
      >
        Disconnect and delete synced data
      </button>
      {note && <p role="status" className="mt-2 text-xs text-muted">Nothing was changed. This is a prototype, so no data is deleted.</p>}
    </section>
  );
}
