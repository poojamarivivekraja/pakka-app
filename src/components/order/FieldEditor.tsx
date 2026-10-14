"use client";

import { useState, useTransition } from "react";
import { saveField } from "@/app/(app)/orders/[id]/actions";
import type { FieldType } from "@/types/profile";

export type EditableField = {
  key: string; label: string; shortLabel: string; type: FieldType; options?: string[]; raw: string | null;
};

/** Inline editor for one field. The server tidies the value (e.g. "5 pm" -> 17:00) and checks it. */
export function FieldEditor({ orderId, field, onDone }: { orderId: string; field: EditableField; onDone: () => void }) {
  const [value, setValue] = useState(field.raw ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const input = "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-[15px] text-ink";
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await saveField(orderId, field.key, value);
          if (result.error) setError(result.error);
          else onDone();
        });
      }}
    >
      <label className="sr-only" htmlFor={`edit-${field.key}`}>{field.label}</label>
      {field.type === "enum" ? (
        <select id={`edit-${field.key}`} value={value} onChange={(e) => setValue(e.target.value)} autoFocus className={input}>
          <option value="" disabled>Choose…</option>
          {field.options?.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
      ) : (
        <input
          id={`edit-${field.key}`} autoFocus value={value} onChange={(e) => setValue(e.target.value)} className={input}
          type={field.type === "date" ? "date" : field.type === "time" ? "time" : "text"}
          inputMode={field.type === "money" ? "decimal" : undefined}
          placeholder={field.type === "money" ? "Amount in ₹" : `Enter the ${field.shortLabel}`}
        />
      )}
      {error && <p role="alert" className="text-xs text-review-fg">{error}</p>}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending || !value.trim()} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface disabled:opacity-40">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-sm font-medium text-muted">Cancel</button>
      </div>
    </form>
  );
}
