import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatThread } from "@/components/chats/ChatThread";
import { loadChat } from "@/lib/chats-data";
import { buildChat, initialOf } from "@/lib/chats-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="px-5 pt-6 text-sm text-muted">Loading chat…</p>}>
      <Chat params={params} />
    </Suspense>
  );
}

async function Chat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const chat = await loadChat(id);
  if (!chat) notFound();
  const { customer } = chat;

  return (
    <>
      <header className="px-5 pt-5">
        <Link href="/chats" className="text-[15px] font-semibold text-primary">‹ Chats</Link>
        <div className="mt-4 flex items-center gap-3">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-dateblock text-[15px] font-semibold text-ink">
            {initialOf(customer.name)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-bold leading-tight text-ink">{customer.name}</h1>
            <p className="text-xs text-muted">{customer.phone} · WhatsApp chat · read-only</p>
          </div>
        </div>
      </header>
      <div className="mx-5 mt-4">
        <ChatThread entries={buildChat(chat.messages)} imageUrls={chat.imageUrls} />
      </div>
      <div className="mx-5 mt-4 text-center">
        <a href={`https://wa.me/${customer.waId}`} target="_blank" rel="noopener noreferrer" className="text-[15px] font-semibold text-primary">
          Reply in WhatsApp
        </a>
        <p className="mt-1 text-xs text-muted">Pakka never sends messages to your customers.</p>
      </div>
    </>
  );
}
