"use client";

import { ActionButton } from "./ActionButton";
import { Card, CardTitle } from "./Card";
import { markReceived } from "@/app/(app)/orders/[id]/actions";
import type { OrderDetailModel } from "@/lib/order-detail-model";

export function PaymentsCard({ model, onViewImage }: { model: OrderDetailModel; onViewImage: (url: string) => void }) {
  const { price, advance, screenshots, balance } = model.payments;
  const row = "flex items-baseline justify-between gap-3 py-1.5";
  return (
    <Card>
      <CardTitle>Payments</CardTitle>
      <div className={row}>
        <span className="text-[13px] text-muted">Price agreed</span>
        <span className={`text-[15px] font-medium ${price ? "text-ink" : "text-review-fg"}`}>{price ?? "Missing"}</span>
      </div>
      {advance && (
        <div className={row}>
          <span className="text-[13px] text-muted">Advance requested</span>
          <span className="text-[15px] font-medium text-ink">{advance}</span>
        </div>
      )}
      {screenshots.map((s) => (
        <div key={s.id} className="py-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-muted">Screenshot received</span>
            <span className="text-[15px] font-medium text-ink">
              {s.amount}{" "}
              {s.received
                ? <span className="text-[13px] font-medium text-confirmed-fg">· marked received</span>
                : <span className="text-[13px] font-medium text-review-fg">· not verified</span>}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-end gap-4">
            {s.imageUrl && <button type="button" onClick={() => onViewImage(s.imageUrl!)} className="text-[13px] font-semibold text-primary">View screenshot</button>}
            {!s.received && !model.closed && <ActionButton label="Mark as received" action={() => markReceived(model.id, s.id)} />}
          </div>
        </div>
      ))}
      <hr className="my-2 border-border" />
      <div className="flex items-baseline justify-between gap-3 py-1">
        <span className="text-[15px] font-bold text-ink">Balance</span>
        <span className="text-[17px] font-bold text-ink">{balance ?? "Add the price first"}</span>
      </div>
      <p className="text-xs text-muted">Calculated by the app, not read from chat.</p>
    </Card>
  );
}
