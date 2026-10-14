"use client";

import { useState } from "react";
import { ActionButton } from "./ActionButton";
import { Card } from "./Card";
import { FieldEditor } from "./FieldEditor";
import { chooseConflict, chooseOrder, markChecked, markReceived } from "@/app/(app)/orders/[id]/actions";
import type { OrderDetailModel, ReviewItem } from "@/lib/order-detail-model";

type Props = {
  model: OrderDetailModel;
  onViewSource: (key: string) => void;
  onViewImage: (url: string) => void;
};

function Item({ item, model, onViewSource, onViewImage }: Props & { item: ReviewItem }) {
  const [editing, setEditing] = useState(false);
  const link = "text-sm font-semibold text-primary";
  const openWhatsApp = (label: string) => (
    <a href={model.whatsappUrl} target="_blank" rel="noopener noreferrer" className={link}>{label}</a>
  );

  return (
    <div className="py-3 first:pt-0 last:pb-0 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border">
      <p className="text-[15px] font-semibold text-ink">{item.title}</p>
      <p className="mt-0.5 text-sm text-muted">{item.explanation}</p>

      {item.choices && (
        <div className="mt-3 flex flex-col gap-2">
          {item.choices.map((c) => (
            <ActionButton key={c.value} variant="ghost" label={c.label} action={() => chooseConflict(model.id, item.id, c.value)} />
          ))}
        </div>
      )}
      {item.orderChoices && (
        <div className="mt-3 flex flex-col gap-2">
          {item.orderChoices.map((c) => (
            <ActionButton key={c.orderId} variant="ghost" label={c.label} action={() => chooseOrder(item.id, c.orderId)} />
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {item.type === "missing_field" && item.field && (
          <>
            <button type="button" className={link} onClick={() => setEditing((v) => !v)}>Add {item.field.shortLabel}</button>
            {openWhatsApp("Ask in WhatsApp")}
          </>
        )}
        {item.type === "payment_mismatch" && (
          <>
            {item.imageUrl && <button type="button" className={link} onClick={() => onViewImage(item.imageUrl!)}>View screenshot</button>}
            {item.attachmentId && <ActionButton label="Mark as received" action={() => markReceived(model.id, item.attachmentId!)} />}
          </>
        )}
        {item.type === "low_confidence" && (
          <>
            {item.field && <button type="button" className={link} onClick={() => setEditing((v) => !v)}>{item.field.raw ? `Edit ${item.field.shortLabel}` : `Add ${item.field.shortLabel}`}</button>}
            {item.sourceKey && <button type="button" className={link} onClick={() => onViewSource(item.sourceKey!)}>View messages</button>}
            <ActionButton variant="mutedLink" label={item.field?.raw ? "Looks right" : "Dismiss"} action={() => markChecked(model.id, item.id)} />
          </>
        )}
        {(item.type === "conflict" || item.type === "which_order") && item.sourceKey && (
          <button type="button" className={link} onClick={() => onViewSource(item.sourceKey!)}>View messages</button>
        )}
        {(item.type === "message_unreadable" || item.type === "message_deleted") && (
          <>
            {openWhatsApp("Open in WhatsApp")}
            <ActionButton variant="mutedLink" label="Mark as checked" action={() => markChecked(model.id, item.id)} />
          </>
        )}
      </div>

      {editing && item.field && (
        <FieldEditor orderId={model.id} field={item.field} onDone={() => setEditing(false)} />
      )}
    </div>
  );
}

export function ReviewCard(props: Props) {
  if (props.model.review.length === 0) return null;
  return (
    <Card className="border-l-[5px] border-l-review-fg">
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-review-fg">Needs review</h2>
      {props.model.review.map((item) => <Item key={item.id} item={item} {...props} />)}
    </Card>
  );
}
