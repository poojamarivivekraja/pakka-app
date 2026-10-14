"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import type { OrderDetailModel } from "@/lib/order-detail-model";
import { clearUpdated } from "@/app/(app)/orders/[id]/actions";
import { BottomSheet } from "./BottomSheet";
import { ConfirmFooter } from "./ConfirmFooter";
import { FieldsCard } from "./FieldsCard";
import { HistoryCard } from "./HistoryCard";
import { NotesAndPending } from "./NotesAndPending";
import { PaymentsCard } from "./PaymentsCard";
import { ReviewCard } from "./ReviewCard";
import { SourceSheet } from "./SourceSheet";

export function OrderScreen({ model }: { model: OrderDetailModel }) {
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const closeSource = useCallback(() => setSourceKey(null), []);
  const closeImage = useCallback(() => setImageUrl(null), []);

  // Opening a confirmed order clears "updated after confirmation" (this view still shows what changed).
  useEffect(() => {
    if (model.needsClearUpdated) clearUpdated(model.id);
  }, [model.id, model.needsClearUpdated]);

  const h = model.header;
  return (
    <>
      <header className="px-5 pt-5">
        <Link href="/" className="tap text-[15px] font-semibold text-primary">‹ Orders</Link>
        <div className="mt-4 flex gap-4">
          <div className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center rounded-2xl bg-dateblock">
            {h.day ? (
              <>
                <span className="text-xs font-bold text-muted">{h.weekday}</span>
                <span className="text-[30px] font-bold leading-none text-ink">{h.day}</span>
                <span className="text-[13px] text-muted">{h.month}</span>
              </>
            ) : (
              <>
                <span className="text-xs font-bold text-muted">Due</span>
                <span className="text-[30px] font-bold leading-none text-ink">–</span>
                <span className="text-[13px] text-muted">date</span>
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-ink">
              {h.time ? <span className="text-[18px] font-bold">{h.time}</span> : <span className="text-[18px] font-bold text-review-fg">Time missing</span>}
              {h.fulfilment && <span className="text-[18px] font-bold"> · {h.fulfilment}</span>}
            </p>
            <p className="mt-0.5 break-words text-[16px] font-semibold text-ink">{h.title}</p>
            <div className="mt-2"><StatusPill tone={model.pill.tone} label={model.pill.label} /></div>
          </div>
        </div>
      </header>

      <NotesAndPending model={model} />
      <ReviewCard model={model} onViewSource={setSourceKey} onViewImage={setImageUrl} />
      <FieldsCard model={model} onViewSource={setSourceKey} />
      <PaymentsCard model={model} onViewImage={setImageUrl} />
      <HistoryCard history={model.history} />
      <ConfirmFooter model={model} />

      <SourceSheet source={sourceKey ? model.sources[sourceKey] ?? null : null} whatsappUrl={model.whatsappUrl} onClose={closeSource} />
      <BottomSheet open={!!imageUrl} onClose={closeImage} label="Payment screenshot">
        <h2 className="text-[17px] font-bold text-ink">Screenshot received</h2>
        <p className="mt-0.5 text-sm text-muted">Not verified. Check your own payment records before marking it received.</p>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Screenshot sent by the customer" className="mx-auto mt-4 h-auto max-w-full rounded-xl border border-border" />
        )}
        <button type="button" onClick={closeImage} className="mt-4 min-h-11 w-full rounded-xl border border-border bg-surface px-4 py-3 text-[15px] font-semibold text-ink">
          Close
        </button>
      </BottomSheet>
    </>
  );
}
