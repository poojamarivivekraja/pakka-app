"use client";

import { useState, useTransition } from "react";
import { confirmDisconnect } from "@/app/(app)/settings/actions";
import { ErrorText } from "@/components/ErrorText";
import { useSyncPaused } from "@/lib/sync-store";

export function ConnectionCard() {
  const [paused] = useSyncPaused();
  const [note, setNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
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
          if (!window.confirm("Disconnect WhatsApp and delete all synced data? In this prototype, nothing will actually be deleted.")) return;
          setError(null);
          start(async () => {
            const result = await confirmDisconnect();
            if (result.error) setError(result.error);
            else setNote(true);
          });
        }}
        disabled={pending}
        className="tap mt-2 text-left text-sm font-semibold text-review-fg"
      >
        Disconnect and delete synced data
      </button>
      {error && <ErrorText message={error} className="mt-2 block text-xs text-review-fg" />}
      {note && <p role="status" className="mt-2 text-xs text-muted">Nothing was changed. This is a prototype, so no data is deleted.</p>}
    </section>
  );
}
