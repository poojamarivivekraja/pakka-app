"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill, type PillTone } from "@/components/StatusPill";
import { SyncBanner } from "@/components/SyncBanner";
import { useSyncPaused } from "@/lib/sync-store";
import { formatChatStamp, formatRupees } from "@/lib/format";
import type { SimBubble, SimOrder, SimState } from "@/lib/simulator-types";

type ScenarioOption = { id: string; name: string; continues: string | null };

const STATUS_TONE: Record<string, PillTone> = {
  needs_review: "review", ready: "ready", confirmed: "confirmed",
};

class PasscodeRequired extends Error {}

async function call(path: string, body?: object): Promise<SimState> {
  const res = await fetch(path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  if (res.status === 401) throw new PasscodeRequired();
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
  return json as SimState;
}

export function SimulatorClient({ scenarios }: { scenarios: ScenarioOption[] }) {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [state, setState] = useState<SimState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sender, setSender] = useState<"customer" | "business">("customer");
  const [text, setText] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [syncPaused, setSyncPaused] = useSyncPaused();
  const loading = !state || state.scenario.id !== scenarioId;

  const run = useCallback(async (label: string, fn: () => Promise<SimState>) => {
    setBusy(label);
    setError(null);
    try {
      setState(await fn());
      window.dispatchEvent(new Event("pakka:poll")); // let the toast check for new Needs review items now
    } catch (e) {
      if (e instanceof PasscodeRequired) {
        router.push("/passcode?next=/simulator");
        return;
      }
      setError(e instanceof Error ? e.message : "Something went wrong.");
      // Refresh so a failed message still shows in the chat.
      call(`/api/simulator/state?scenario=${scenarioId}`).then(setState).catch(() => {});
    } finally {
      setBusy(null);
    }
  }, [scenarioId, router]);

  // Load the chosen scenario's current state (also runs once on first render).
  useEffect(() => {
    let cancelled = false;
    call(`/api/simulator/state?scenario=${scenarioId}`)
      .then((next) => { if (!cancelled) setState(next); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof PasscodeRequired) router.push("/passcode?next=/simulator");
        else setError(e instanceof Error ? e.message : "Something went wrong.");
      });
    return () => { cancelled = true; };
  }, [scenarioId, router]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.chat.length]);

  const s = loading ? undefined : state?.scenario;
  const canSendNext = !!s && !busy && !s.blocked && s.next !== null;

  return (
    <main className="mx-auto w-full max-w-[1100px] p-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-primary">Pakka <span className="text-base font-semibold text-ink">simulator</span></h1>
        <p className="text-xs text-muted">Test tool, not part of the product. Messages go through the same pipeline as live WhatsApp.</p>
      </header>

      <SyncBanner />

      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* Left: controls and chat */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
            <label htmlFor="scenario" className="text-xs font-semibold uppercase tracking-wide text-muted">Scenario</label>
            <select
              id="scenario" value={scenarioId} disabled={!!busy}
              onChange={(e) => setScenarioId(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
            >
              {scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>{sc.id.toUpperCase()} · {sc.name}</option>
              ))}
            </select>
            {s && (
              <p className="text-xs text-muted">
                {s.sent} of {s.total} scripted messages sent.
                {s.blocked ? <span className="text-review-fg"> {s.blocked}</span> : s.next ? <> Next: <span className="text-ink">{s.next}</span></> : " All sent."}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => run("Sending", () => call("/api/simulator/send", { scenario: scenarioId }))}
                disabled={!canSendNext}
                className="flex-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-surface disabled:opacity-40"
              >
                {busy === "Sending" ? "Sending…" : "Send next message"}
              </button>
              <button
                onClick={() => {
                  const warn = s?.continues
                    ? `This clears the whole chat, including ${s.continues.toUpperCase()}. Continue?`
                    : "Clear this scenario's customer, orders and chat?";
                  if (confirm(warn)) run("Resetting", () => call("/api/simulator/reset", { scenario: scenarioId }));
                }}
                disabled={!!busy || loading}
                className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
              >
                Reset scenario
              </button>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-border pt-3 text-sm text-ink">
              <span>
                <span className="font-semibold">Simulate sync paused</span>
                <span className="block text-xs text-muted">Shows the “Sync paused” banner on every screen.</span>
              </span>
              <input
                type="checkbox" role="switch" checked={syncPaused} onChange={(e) => setSyncPaused(e.target.checked)}
                className="h-5 w-5 accent-[var(--color-ink)]"
              />
            </label>
            {error && <p role="alert" className="rounded-lg bg-review-bg px-3 py-2 text-xs text-review-fg">{error}</p>}
          </div>

          <div className="flex h-[460px] flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-dateblock p-3">
            {loading && <p className="m-auto text-sm text-muted">Loading…</p>}
            {!loading && state && state.chat.length === 0 && <p className="m-auto text-sm text-muted">No messages yet. Press “Send next message”.</p>}
            {!loading && state?.chat.map((b) => <Bubble key={b.id} bubble={b} />)}
            {busy === "Sending" && <p className="self-center text-xs text-muted">Reading the message…</p>}
            <div ref={chatEnd} />
          </div>

          <form
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const message = text;
              setText("");
              run("Sending", () => call("/api/simulator/send", { scenario: scenarioId, custom: { sender, text: message } }));
            }}
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wide text-muted">Custom message from</span>
              {(["customer", "business"] as const).map((who) => (
                <button
                  type="button" key={who} onClick={() => setSender(who)}
                  className={`rounded-full px-3 py-1 font-semibold ${sender === who ? "bg-ink text-surface" : "border border-border bg-surface text-ink"}`}
                >
                  {who === "customer" ? "Customer" : "Business"}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={text} onChange={(e) => setText(e.target.value)} maxLength={1000}
                placeholder={sender === "customer" ? "Type what the customer says…" : "Type what the business replies…"}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
              <button
                type="submit" disabled={!!busy || loading || !text.trim()}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </form>
        </section>

        {/* Right: what the app now holds */}
        <aside className="flex flex-col gap-3">
          <div className="rounded-xl border border-border bg-surface p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">What Pakka holds now</p>
            {!loading && state?.customer && <p className="mt-1 text-ink">{state.customer.name} · {state.customer.waId}</p>}
            {!loading && state?.lastResult ? (
              <p className="mt-1 text-xs text-muted">
                Last message was read as <span className="font-semibold text-ink">{state.lastResult.messageType ?? "an event"}</span>
                {state.lastResult.newFlags.length ? `; new flags: ${state.lastResult.newFlags.join(", ")}` : "; no new flags"}.
              </p>
            ) : <p className="mt-1 text-xs text-muted">Send a message to see what changes.</p>}
          </div>
          {!loading && state?.orders.length === 0 && <p className="text-sm text-muted">No orders yet.</p>}
          {!loading && state?.orders.map((o, i) => (
            <OrderPanel key={o.id} order={o} index={i} changed={!!state.lastResult?.orderIds.includes(o.id)} />
          ))}
          {!loading && !!state?.customerFlags.length && (
            <div className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Flags not tied to an order</p>
              <ul className="mt-1 list-disc pl-5 text-review-fg">
                {state.customerFlags.map((f) => <li key={f.id}>{f.type}: {f.detail}</li>)}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function Bubble({ bubble: b }: { bubble: SimBubble }) {
  const out = b.direction === "out";
  let content: React.ReactNode = b.body;
  if (b.type === "image") {
    content = b.mediaPath?.startsWith("samples/")
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={`/${b.mediaPath}`} alt="Sent image" className="max-h-56 rounded-lg" />
      : "[image]";
  } else if (b.type === "edit") content = <span className="italic">Edited a message to: “{b.body}”</span>;
  else if (b.type === "revoke") content = <span className="italic">Deleted a message</span>;
  else if (b.type === "unsupported") content = <span className="italic">Sent something Pakka can’t read</span>;
  return (
    <div className={`max-w-[85%] rounded-xl border border-border px-3 py-2 text-sm text-ink ${out ? "self-end bg-confirmed-bg" : "self-start bg-surface"}`}>
      <p className="whitespace-pre-wrap break-words">{content}</p>
      <p className="mt-1 text-right text-[10px] text-muted">
        {formatChatStamp(b.sentAt)}{b.status === "failed" ? " · failed to process" : ""}
      </p>
    </div>
  );
}

function OrderPanel({ order: o, index, changed }: { order: SimOrder; index: number; changed: boolean }) {
  const openFlags = o.flags.filter((f) => !f.resolved);
  const payments = o.attachments.filter((a) => a.kind === "payment_screenshot");
  const refs = o.attachments.filter((a) => a.kind === "reference_image");
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-ink">Order {index + 1}{changed && <span className="ml-2 text-xs font-normal text-updated-fg">changed by the last message</span>}</p>
        <StatusPill tone={STATUS_TONE[o.status] ?? "ready"} />
      </div>

      <Section title="Fields">
        {o.fields.length === 0 ? <p className="text-muted">Nothing filled in yet.</p> : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {o.fields.map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-muted">{f.label}</dt>
                <dd className="text-ink">
                  {f.value}
                  {f.previous && <span className="text-muted"> · was {f.previous}</span>}
                  {f.confidence === "low" && <span className="text-review-fg"> · low confidence</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title={`Flags (${openFlags.length} open)`}>
        {openFlags.length === 0 ? <p className="text-muted">None.</p> : (
          <ul className="list-disc pl-5 text-review-fg">{openFlags.map((f) => <li key={f.id}>{f.type}: {f.detail}</li>)}</ul>
        )}
      </Section>

      <Section title="Update notes">
        {o.notes.length === 0 ? <p className="text-muted">None.</p> : (
          <ul className="list-disc pl-5 text-ink">{o.notes.map((n) => <li key={n.id}>{n.text}</li>)}</ul>
        )}
      </Section>

      <Section title="Pending requests">
        {o.pending.length === 0 ? <p className="text-muted">None.</p> : (
          <ul className="list-disc pl-5 text-ink">
            {o.pending.map((p) => (
              <li key={p.id}>{p.field}: {p.requestedValue} <span className="text-muted">({p.resolved ?? "waiting for your reply"})</span></li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Images and payments">
        {refs.map((r) => <p key={r.id} className="text-ink">Reference image: {r.description ?? "no description"}</p>)}
        {payments.map((p) => (
          <p key={p.id} className="text-ink">
            Screenshot received · {p.markedReceived ? "marked received" : "not verified"}: {p.amount === null ? "amount unreadable" : formatRupees(p.amount)}
            {p.reference && <span className="text-muted"> · ref {p.reference}</span>}
          </p>
        ))}
        {refs.length + payments.length === 0 && <p className="text-muted">None.</p>}
        <p className="mt-1 text-ink">
          Balance: {o.balance === null ? "needs a price first" : formatRupees(o.balance)}
          <span className="text-muted"> · calculated by the app</span>
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-border pt-2">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}
