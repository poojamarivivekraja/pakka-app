"use client";

import { useState, useTransition } from "react";
import { ErrorText } from "@/components/ErrorText";
import type { ActionResult } from "@/app/(app)/orders/[id]/actions";

type Variant = "link" | "mutedLink" | "ghost" | "primary";

const STYLES: Record<Variant, string> = {
  link: "tap text-sm font-semibold text-primary",
  mutedLink: "tap text-sm font-medium text-muted",
  ghost: "min-h-11 w-full rounded-xl border border-border bg-surface px-4 py-3 text-[15px] font-semibold text-ink",
  primary: "w-full rounded-xl bg-primary px-4 py-3.5 text-base font-semibold text-surface",
};

/** A button that runs a server action, shows "…" while it works, and shows the action's error under itself. */
export function ActionButton({ label, pendingLabel, action, variant = "link", confirmText, disabled }: {
  label: string;
  pendingLabel?: string;
  action: () => Promise<ActionResult>;
  variant?: Variant;
  confirmText?: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const block = variant === "ghost" || variant === "primary";
  return (
    <span className={block ? "block w-full" : "inline-block"}>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          setError(null);
          start(async () => setError((await action()).error ?? null));
        }}
        className={`${STYLES[variant]} disabled:opacity-40`}
      >
        {pending ? (pendingLabel ?? "Working…") : label}
      </button>
      {error && <ErrorText message={error} className="mt-1 block text-xs text-review-fg" />}
    </span>
  );
}
