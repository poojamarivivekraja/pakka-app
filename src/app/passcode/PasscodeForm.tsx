"use client";

import { useActionState } from "react";
import { submitPasscode } from "./actions";

export function PasscodeForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(submitPasscode, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="passcode" className="text-sm font-semibold text-ink">
        Passcode
      </label>
      <input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="off"
        autoFocus
        required
        className="rounded-lg border border-border bg-surface px-3 py-3 text-base text-ink outline-none focus:border-primary"
      />
      {state?.error && (
        <p role="alert" className="text-sm text-review-fg">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-3 text-base font-semibold text-surface disabled:opacity-60"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
