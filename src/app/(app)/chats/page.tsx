import { Suspense } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/StatusPill";
import { getToday } from "@/lib/demo-date";
import { loadChatList } from "@/lib/chats-data";

export default function ChatsPage() {
  return (
    <>
      <header className="px-5 pt-5">
        <span className="text-[22px] font-bold text-primary">Pakka</span>
        <h1 className="mt-4 text-[28px] font-bold leading-tight text-ink">Chats</h1>
        <p className="mt-1 text-sm text-muted">Read-only. Reply to customers in WhatsApp.</p>
      </header>
      <Suspense fallback={<p className="px-5 pt-6 text-sm text-muted">Loading chats…</p>}>
        <ChatList />
      </Suspense>
    </>
  );
}

async function ChatList() {
  const rows = await loadChatList(getToday());
  if (rows.length === 0) {
    return <p className="px-5 pt-8 text-center text-sm text-muted">No chats yet. Customers appear here when they message you.</p>;
  }
  return (
    <ul className="mt-4 flex flex-col gap-2.5 px-5">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={`/chats/${c.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
            <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-dateblock text-[15px] font-semibold text-ink">
              {c.initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[15px] font-semibold text-ink">{c.name}</span>
                <span className="shrink-0 text-xs text-muted">{c.date}</span>
              </span>
              <span className="mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate text-sm text-muted">{c.preview}</span>
                {c.tone && <span className="shrink-0"><StatusPill tone={c.tone} /></span>}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
