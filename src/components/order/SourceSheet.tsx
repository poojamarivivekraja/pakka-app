"use client";

import { BottomSheet } from "./BottomSheet";
import type { SourceBubble, SourceModel } from "@/lib/order-detail-model";

/** Bold + underline the supporting words inside a message. */
function Highlighted({ body, highlight }: { body: string; highlight: string | null }) {
  const at = highlight ? body.toLowerCase().indexOf(highlight.toLowerCase()) : -1;
  if (!highlight || at === -1) return <>{body}</>;
  return (
    <>
      {body.slice(0, at)}
      <strong className="font-bold underline">{body.slice(at, at + highlight.length)}</strong>
      {body.slice(at + highlight.length)}
    </>
  );
}

function Bubble({ b }: { b: SourceBubble }) {
  const out = b.direction === "out";
  let content: React.ReactNode;
  if (b.type === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    content = b.imageUrl ? <img src={b.imageUrl} alt="Image sent in the chat" className="max-h-48 rounded-lg" /> : "[image]";
  } else if (b.type === "edit") content = <em>Edited: {b.body}</em>;
  else if (b.type === "revoke") content = <em>Deleted a message</em>;
  else if (b.type === "unsupported") content = <em>Something Pakka couldn’t read</em>;
  else content = <Highlighted body={b.body ?? ""} highlight={b.highlight} />;
  return (
    <div
      className={`max-w-[88%] rounded-2xl px-3 py-2 text-[14px] text-ink ${out ? "self-end bg-confirmed-bg" : "self-start bg-surface"} ${
        b.supporting ? "border-[1.5px] border-ink" : "border border-border"
      }`}
    >
      <p className="whitespace-pre-wrap break-words">{content}</p>
      <p className="mt-1 text-right text-[10px] text-muted">{b.at}</p>
    </div>
  );
}

export function SourceSheet({ source, whatsappUrl, onClose }: { source: SourceModel | null; whatsappUrl: string; onClose: () => void }) {
  return (
    <BottomSheet open={!!source} onClose={onClose} label={source?.title ?? "Source"}>
      {source && (
        <>
          <h2 className="text-[17px] font-bold text-ink">{source.title}</h2>
          <p className="mt-0.5 text-sm text-muted">{source.subtitle}</p>
          <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-dateblock p-3">
            {source.bubbles.map((b) => <Bubble key={b.id} b={b} />)}
          </div>
          {source.agreed && (
            <p className="mt-3 rounded-xl bg-confirmed-bg px-3 py-2 text-[13px] font-medium text-confirmed-fg">
              Agreed in chat by your business at {source.agreed.at}
              {source.agreed.alsoUsedFor.length > 0 && ` · also used for ${source.agreed.alsoUsedFor.join(", ")}`}
            </p>
          )}
          <div className="mt-5 flex flex-col gap-2">
            <a
              href={whatsappUrl} target="_blank" rel="noopener noreferrer"
              className="block w-full rounded-xl bg-primary px-4 py-3.5 text-center text-base font-semibold text-surface"
            >
              Open in WhatsApp
            </a>
            <button type="button" onClick={onClose} className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-[15px] font-semibold text-ink">
              Close
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
