import type { ChatEntry } from "@/lib/chats-view";

// The read-only chat: business messages tinted green on the right, customer messages white on the left.
export function ChatThread({ entries, imageUrls }: { entries: ChatEntry[]; imageUrls: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-dateblock p-3">
      {entries.length === 0 && <p className="py-6 text-center text-sm text-muted">No messages yet.</p>}
      {entries.map((e) => {
        if (e.kind === "day") {
          return <p key={e.key} className="my-1 self-center rounded-full bg-surface px-3 py-1 text-[11px] font-semibold text-muted">{e.label}</p>;
        }
        const out = e.direction === "out";
        const image = e.mediaPath ? imageUrls[e.key] : null;
        return (
          <div
            key={e.key}
            className={`max-w-[85%] rounded-2xl border border-border px-3 py-2 text-[14px] text-ink ${out ? "self-end bg-confirmed-bg" : "self-start bg-surface"}`}
          >
            {e.mediaPath && (
              // eslint-disable-next-line @next/next/no-img-element
              image ? <img src={image} alt="Image sent in the chat" className="mb-1 max-h-56 rounded-lg" /> : <p className="italic text-muted">[image]</p>
            )}
            {e.text && <p className={`whitespace-pre-wrap break-words ${e.italic ? "italic text-muted" : ""}`}>{e.text}</p>}
            <p className="mt-1 text-right text-[10px] text-muted">{e.edited ? "Edited · " : ""}{e.time}</p>
          </div>
        );
      })}
    </div>
  );
}
