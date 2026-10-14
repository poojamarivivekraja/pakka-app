"use client";

import { ActionButton } from "./ActionButton";
import { Card } from "./Card";
import { gotIt } from "@/app/(app)/orders/[id]/actions";
import type { OrderDetailModel } from "@/lib/order-detail-model";
import { StatusPill } from "@/components/StatusPill";

export function NotesAndPending({ model }: { model: OrderDetailModel }) {
  return (
    <>
      {model.notes.map((n) => (
        <Card key={n.id}>
          <StatusPill tone="updated" />
          <p className="mt-2 text-[15px] text-ink">{n.text}</p>
          <div className="mt-2">
            <ActionButton label="Got it" action={() => gotIt(n.id)} />
          </div>
        </Card>
      ))}
      {model.pending.map((p) => (
        <Card key={p.id}>
          <span className="inline-block rounded-full bg-ready-bg px-2.5 py-1 text-[11px] font-semibold leading-none text-ready-fg">Waiting for your reply</span>
          <p className="mt-2 text-[15px] font-semibold text-ink">Requested: {p.fieldLabel} → {p.requested}</p>
          <p className="mt-1 text-sm text-muted">
            {p.current ? `The order still says ${p.current} until you reply in WhatsApp.` : "The order has no value for this yet. Reply in WhatsApp to settle it."}
          </p>
          <a href={model.whatsappUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-primary">
            Reply in WhatsApp
          </a>
        </Card>
      ))}
    </>
  );
}
