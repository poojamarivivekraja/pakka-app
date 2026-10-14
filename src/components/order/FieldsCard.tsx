"use client";

import { useState } from "react";
import { Card, CardTitle } from "./Card";
import { FieldEditor } from "./FieldEditor";
import type { FieldRowModel, OrderDetailModel } from "@/lib/order-detail-model";

function Row({ f, orderId, locked, onViewSource }: { f: FieldRowModel; orderId: string; locked: boolean; onViewSource: (key: string) => void }) {
  const [editing, setEditing] = useState(false);
  const plaque = f.exactText && f.display;

  const links = (
    <div className="flex shrink-0 items-center gap-3 pt-0.5">
      {f.hasSource && <button type="button" onClick={() => onViewSource(f.key)} className="text-[13px] font-semibold text-primary">Source ↗</button>}
      {!locked && <button type="button" onClick={() => setEditing((v) => !v)} className="text-[13px] font-medium text-muted">{editing ? "Close" : "Edit"}</button>}
    </div>
  );
  const pills = (
    <>
      {f.updated && <span className="rounded-full bg-updated-bg px-2 py-0.5 text-[10px] font-semibold text-updated-fg">Updated</span>}
      {f.editedByOwner && <span className="rounded-full bg-ready-bg px-2 py-0.5 text-[10px] font-semibold text-ready-fg">Edited by you</span>}
      {f.lowConfidence && <span className="text-[11px] font-medium text-review-fg">Low confidence</span>}
    </>
  );

  return (
    <div className="border-t border-border py-3 first:border-t-0 first:pt-0">
      {plaque ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{f.label}</p>
            {links}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-dateblock px-4 py-3 text-[17px] font-medium text-ink">{f.display}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {f.editedByOwner ? "Entered by you." : "Spelling kept exactly as the customer wrote it."} {pills}
          </p>
          {f.note && <p className="mt-0.5 text-xs text-muted">{f.note}</p>}
        </>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-muted">{f.label}</p>
            {f.display ? (
              <p className="mt-0.5 break-words text-[15px] font-medium text-ink">{f.display}</p>
            ) : (
              <p className={`mt-0.5 text-[15px] ${f.required ? "font-medium text-review-fg" : "text-muted"}`}>{f.required ? "Missing" : "–"}</p>
            )}
            {(f.note || f.updated || f.editedByOwner || f.lowConfidence) && (
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">{f.note} {pills}</p>
            )}
          </div>
          {links}
        </div>
      )}
      {editing && (
        <FieldEditor orderId={orderId} field={f} onDone={() => setEditing(false)} />
      )}
    </div>
  );
}

export function FieldsCard({ model, onViewSource }: { model: OrderDetailModel; onViewSource: (key: string) => void }) {
  // The exact-text plaque (e.g. the message on a cake) goes last, as in the design.
  const ordered = [...model.fields].sort((a, b) => Number(a.exactText && !!a.display) - Number(b.exactText && !!b.display));
  return (
    <Card>
      <CardTitle>The order</CardTitle>
      {ordered.map((f) => <Row key={f.key} f={f} orderId={model.id} locked={model.closed} onViewSource={onViewSource} />)}
    </Card>
  );
}
