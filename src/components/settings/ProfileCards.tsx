"use client";

import { useState, useTransition } from "react";
import { chooseProfile } from "@/app/(app)/settings/actions";

export type ProfileOption = { id: string; name: string; available: boolean };

/** Business type cards. One is selected; "Coming soon" ones are muted and can't be chosen. */
export function ProfileCards({ options, activeId }: { options: ProfileOption[]; activeId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div role="radiogroup" aria-label="Business type" className="flex flex-col gap-2.5">
      {options.map((o) => {
        const selected = o.id === activeId;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={!o.available}
            disabled={!o.available || pending}
            onClick={() => {
              if (selected) return;
              setError(null);
              start(async () => setError((await chooseProfile(o.id)).error ?? null));
            }}
            className={`flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left ${
              selected ? "border-2 border-ink" : "border border-border"
            } ${o.available ? "" : "opacity-60"}`}
          >
            <span className={`text-[15px] font-semibold ${o.available ? "text-ink" : "text-muted"}`}>{o.name}</span>
            {o.available ? (
              <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? "border-ink" : "border-border"}`}>
                {selected && <span className="h-2.5 w-2.5 rounded-full bg-ink" />}
              </span>
            ) : (
              <span className="rounded-full bg-ready-bg px-2.5 py-1 text-[11px] font-semibold leading-none text-ready-fg">Coming soon</span>
            )}
          </button>
        );
      })}
      {error && <p role="alert" className="text-xs text-review-fg">{error}</p>}
    </div>
  );
}
