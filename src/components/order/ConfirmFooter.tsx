"use client";

import { ActionButton } from "./ActionButton";
import { cancelOrder, confirm, markDelivered } from "@/app/(app)/orders/[id]/actions";
import type { OrderDetailModel } from "@/lib/order-detail-model";

export function ConfirmFooter({ model }: { model: OrderDetailModel }) {
  const { status, closed, footer } = model;
  return (
    <div className="mx-5 mt-5 flex flex-col gap-3">
      {status === "confirmed" ? (
        <ActionButton variant="ghost" label="Mark as delivered" action={() => markDelivered(model.id)} confirmText="Mark this order as delivered?" />
      ) : !closed ? (
        <>
          <ActionButton variant="primary" label="Confirm order" pendingLabel="Confirming…" action={() => confirm(model.id)} disabled={!footer.canConfirm} />
          {footer.reason && <p className="text-center text-sm text-muted">{footer.reason}</p>}
        </>
      ) : (
        <p className="text-center text-sm text-muted">{footer.reason}</p>
      )}
      <p className="text-center text-xs text-muted">Built from synced messages; check the chat if something looks missing.</p>
      {!closed && (
        <div className="flex justify-center gap-6 pb-2">
          {status !== "confirmed" && (
            <ActionButton variant="mutedLink" label="Mark as delivered" action={() => markDelivered(model.id)} confirmText="Mark this order as delivered?" />
          )}
          <ActionButton variant="mutedLink" label="Cancel order" action={() => cancelOrder(model.id)} confirmText="Cancel this order? You can't undo this." />
        </div>
      )}
    </div>
  );
}
