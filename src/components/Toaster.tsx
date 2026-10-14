"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastItem } from "@/lib/notifications";

const POLL_MS = 3000;
const OVERLAP_MS = 15000; // re-ask for the last few seconds so a flag saved late is never missed
const SHOW_MS = 9000;

/**
 * "Rahul's order needs review". Polls for new flags on every screen (including the simulator),
 * so it works while messages are sent from another tab. Dispatch "pakka:poll" to check at once.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenFlags = useRef(new Set<string>());
  const since = useRef<string | null>(null);

  const dismiss = useCallback((key: string) => setToasts((t) => t.filter((x) => x.key !== key)), []);

  const poll = useCallback(async () => {
    try {
      const url = since.current ? `/api/notifications?since=${encodeURIComponent(since.current)}` : "/api/notifications";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { now: string; toasts: ToastItem[] };
      since.current = new Date(Date.parse(data.now) - OVERLAP_MS).toISOString();
      const fresh = data.toasts.filter((t) => t.flagIds.some((id) => !seenFlags.current.has(id)));
      data.toasts.forEach((t) => t.flagIds.forEach((id) => seenFlags.current.add(id)));
      if (fresh.length === 0) return;
      setToasts((current) => {
        const added = fresh.filter((t) => !current.some((c) => c.href === t.href));
        return [...current, ...added].slice(-3);
      });
      fresh.forEach((t) => setTimeout(() => dismiss(t.key), SHOW_MS));
    } catch {
      /* offline or the server is restarting: try again next time */
    }
  }, [dismiss]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const loop = async () => {
      if (!document.hidden) await poll();
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    };
    loop();
    const now = () => void poll();
    window.addEventListener("pakka:poll", now);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("pakka:poll", now);
    };
  }, [poll]);

  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" role="status" className="app-column-layer pointer-events-none top-3 z-[60] px-3">
      <div className="app-column flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.key} className="pointer-events-auto flex items-start justify-between gap-3 rounded-xl border border-border border-l-[5px] border-l-review-fg bg-surface px-4 py-3 shadow-lg">
          <div>
            <p className="text-[15px] font-semibold text-ink">{t.text}</p>
            <Link href={t.href} onClick={() => dismiss(t.key)} className="tap text-sm font-semibold text-primary">
              {t.href.startsWith("/orders") ? "View order" : "View chat"}
            </Link>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.key)} className="tap min-w-11 justify-center text-lg leading-none text-muted">×</button>
        </div>
      ))}
      </div>
    </div>
  );
}
