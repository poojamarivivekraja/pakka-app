import "server-only";
import type { Message } from "@/types/db";
import { getProfile } from "@/config/profiles";
import { getSupabase } from "@/lib/supabase";
import { getToday } from "@/lib/demo-date";
import { processMessage, type ProcessInput, type ProcessOutput } from "@/lib/pipeline";
import { loadSettings } from "@/lib/pipeline/store";
import { computeBalance } from "@/lib/pipeline/rules-order";
import { parseMoney } from "@/lib/pipeline/helpers";
import { loadSnapshot } from "@/lib/snapshot";
import { describeScriptedMessage, getScenario, type Scenario } from "@/lib/scenarios";
import type { SimBubble, SimOrder, SimState } from "@/lib/simulator-types";

// Server side of /simulator: scripted conversations and custom messages through processMessage().

export class SimError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const db = () => getSupabase();
const time = (iso: string) => new Date(iso).getTime();

function scenarioOrThrow(id: string): Scenario {
  const s = getScenario(id);
  if (!s) throw new SimError(404, `Unknown scenario "${id}"`);
  return s;
}

async function findCustomer(waId: string): Promise<{ id: string; name: string | null } | null> {
  const { data, error } = await db().from("customers").select("id, name").eq("wa_id", waId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function loadChat(customerId: string): Promise<Message[]> {
  const { data, error } = await db().from("messages").select("*").eq("customer_id", customerId)
    .order("sent_at").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Message[];
}

/** Index of the first scripted message not yet in the chat, or null when all were sent. */
function nextScriptedIndex(s: Scenario, chat: Message[]): number | null {
  const have = new Set(chat.map((m) => time(m.sent_at)));
  const i = s.messages.findIndex((m) => !have.has(time(m.timestamp)));
  return i === -1 ? null : i;
}

function blockedReason(s: Scenario, chat: Message[]): string | null {
  if (!s.continues) return null;
  const prior = getScenario(s.continues)!;
  const have = new Set(chat.map((m) => time(m.sent_at)));
  const complete = prior.messages.every((m) => have.has(time(m.timestamp)));
  return complete ? null : `${s.id.toUpperCase()} continues ${prior.id.toUpperCase()}. Run ${prior.id.toUpperCase()} to the end first.`;
}

function bubble(m: Message): SimBubble {
  return { id: m.id, direction: m.direction, type: m.type, body: m.body, mediaPath: m.media_path, sentAt: m.sent_at, status: m.status };
}

async function buildState(s: Scenario, last: ProcessOutput | null): Promise<SimState> {
  const customer = await findCustomer(s.customer.wa_id);
  const chat = customer ? await loadChat(customer.id) : [];
  const nextIdx = nextScriptedIndex(s, chat);
  const settings = await loadSettings();
  const profile = getProfile(settings.active_profile);
  const snap = customer ? await loadSnapshot(customer.id) : { orders: [], customerFlags: [] };

  const orders: SimOrder[] = snap.orders.map((o) => ({
    id: o.order.id,
    status: o.order.status,
    updatedAfterConfirmation: o.order.updated_after_confirmation,
    fields: profile.fields.flatMap((f) => {
      const v = o.order.fields[f.key];
      return v ? [{ key: f.key, label: f.label, value: v.value, confidence: v.confidence, previous: v.previous_value }] : [];
    }),
    flags: o.flags.map((f) => ({ id: f.id, type: f.type, detail: f.detail, resolved: f.resolved })),
    notes: o.notes.map((n) => ({ id: n.id, text: n.text })),
    pending: o.pending.map((p) => ({ id: p.id, field: p.field, requestedValue: p.requested_value, resolved: p.resolved })),
    attachments: o.attachments.map((a) => ({
      id: a.id, kind: a.kind, description: a.description,
      amount: parseMoney(a.extracted?.amount as number | null | undefined),
      reference: (a.extracted?.reference as string | null) ?? null,
      payee: (a.extracted?.payee as string | null) ?? null,
      markedReceived: a.marked_received,
    })),
    balance: computeBalance(o.order.fields, o.attachments),
  }));

  return {
    scenario: {
      id: s.id, name: s.name, continues: s.continues ?? null, total: s.messages.length,
      sent: nextIdx === null ? s.messages.length : nextIdx,
      next: nextIdx === null ? null : describeScriptedMessage(s.messages[nextIdx]),
      blocked: blockedReason(s, chat),
    },
    customer: customer ? { name: customer.name ?? s.customer.name, waId: s.customer.wa_id } : null,
    chat: chat.map(bubble),
    orders,
    customerFlags: snap.customerFlags.filter((f) => !f.resolved).map((f) => ({ id: f.id, type: f.type, detail: f.detail })),
    lastResult: last
      ? { messageType: last.messageType, orderIds: last.orderIds, newFlags: last.newFlags.map((f) => f.type) }
      : null,
  };
}

export const getSimState = async (scenarioId: string) => buildState(scenarioOrThrow(scenarioId), null);

async function ensureCustomer(s: Scenario) {
  const existing = await findCustomer(s.customer.wa_id);
  if (existing) return existing;
  const { data, error } = await db().from("customers").insert({ wa_id: s.customer.wa_id, name: s.customer.name }).select("id, name").single();
  if (error) throw new Error(error.message);
  return data;
}

/** Sends the next scripted message through processMessage(). */
export async function sendNextScripted(scenarioId: string): Promise<SimState> {
  const s = scenarioOrThrow(scenarioId);
  const customer = await ensureCustomer(s);
  const chat = await loadChat(customer.id);

  const blocked = blockedReason(s, chat);
  if (blocked) throw new SimError(409, blocked);
  const idx = nextScriptedIndex(s, chat);
  if (idx === null) throw new SimError(409, "All scripted messages of this scenario have been sent. Use Reset scenario to start over.");

  const m = s.messages[idx];
  let targetMessageId: string | null = null;
  if (m.target) {
    const targetStamp = time(s.messages[m.target - 1].timestamp);
    targetMessageId = chat.find((c) => time(c.sent_at) === targetStamp)?.id ?? null;
    if (!targetMessageId) throw new SimError(409, "The message this edit or deletion refers to hasn't been sent yet.");
  }
  const input: ProcessInput = {
    customerId: customer.id,
    direction: m.sender === "customer" ? "in" : "out",
    type: m.event ?? (m.image ? "image" : "text"),
    body: m.text ?? null,
    mediaPath: m.image ?? null,
    sentAt: m.timestamp,
    targetMessageId,
  };
  const out = await processMessage(input);
  return buildState(s, out);
}

/** Sends a free-text customer or business message, timed one minute after the last message in the chat. */
export async function sendCustomMessage(scenarioId: string, sender: "customer" | "business", text: string): Promise<SimState> {
  const s = scenarioOrThrow(scenarioId);
  const body = text.trim();
  if (!body) throw new SimError(400, "Type a message first.");
  if (body.length > 1000) throw new SimError(400, "That message is too long (1000 characters max).");

  const customer = await ensureCustomer(s);
  const chat = await loadChat(customer.id);
  const last = chat[chat.length - 1];
  const sentAt = last
    ? new Date(time(last.sent_at) + 60_000).toISOString()
    : new Date(`${getToday()}T12:00:00+05:30`).toISOString();

  const out = await processMessage({
    customerId: customer.id, direction: sender === "customer" ? "in" : "out", type: "text", body, sentAt,
  });
  return buildState(s, out);
}

/**
 * Clears this scenario's customer and everything under it (messages, orders, flags, notes...).
 * Scenarios that continue another share its customer, so this clears the whole thread.
 */
export async function resetScenario(scenarioId: string): Promise<SimState> {
  const s = scenarioOrThrow(scenarioId);
  const { error } = await db().from("customers").delete().eq("wa_id", s.customer.wa_id);
  if (error) throw new Error(error.message);
  return buildState(s, null);
}
