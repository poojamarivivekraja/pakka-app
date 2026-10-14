import "./load-env";
// Runs one scenario through processMessage() and returns structured results.
// Shared by run-scenario.ts (prints them) and eval.ts (aggregates them).
import { getProfile } from "@/config/profiles";
import { getSupabase } from "@/lib/supabase";
import { processMessage, type ProcessInput } from "@/lib/pipeline";
import { loadSettings } from "@/lib/pipeline/store";
import { SCENARIOS } from "@/lib/scenarios";
import {
  evaluateCheck, formatSummary, loadScenario, loadSnapshot, signature,
  type Scenario, type ScenarioMessage,
} from "./scenario-lib";

const db = getSupabase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const describeMessage = (m: ScenarioMessage) =>
  `${m.sender === "customer" ? "C" : "B"}: ${m.event ? `[${m.event}${m.text ? `: ${m.text}` : ""}]` : m.image ? `[image: ${m.image}]` : m.text}`;

export type CallStat = { inputTokens: number; outputTokens: number; latencyMs: number; ok: boolean };

export type MessageResult = {
  n: number;
  timestamp: string;
  description: string;
  messageType: string | null;
  newFlags: number;
  calls: CallStat[];
  error: string | null;
};

export type CheckResult = { label: string; after: number | null; ran: boolean; ok: boolean; detail: string };

export type ScenarioRun = {
  id: string;
  name: string;
  customerName: string;
  continues: string | null;
  messages: MessageResult[];
  checks: CheckResult[];
  /** Final orders, flags, notes, pending requests, payments and balance, as text. */
  summary: string;
  crashed: string | null;
  /** Orders this scenario created (0 for scenarios that continue another). */
  ordersCreated: number;
};

/** Deletes every scenario customer (and so their messages, orders, flags, notes...). Synthetic data only. */
export async function resetAllScenarioData() {
  const waIds = [...new Set(SCENARIOS.map((s) => s.customer.wa_id))];
  const { error } = await db.from("customers").delete().in("wa_id", waIds);
  if (error) throw new Error(`reset scenario data: ${error.message}`);
}

async function startFresh(s: Scenario): Promise<string> {
  const del = await db.from("customers").delete().eq("wa_id", s.customer.wa_id);
  if (del.error) throw new Error(`clear customer: ${del.error.message}`);
  const ins = await db.from("customers").insert({ wa_id: s.customer.wa_id, name: s.customer.name }).select("id").single();
  if (ins.error) throw new Error(`create customer: ${ins.error.message}`);
  return ins.data.id;
}

/** Scenarios that continue another never clear data, and refuse if the earlier one wasn't run (or this one already was). */
async function continueExisting(s: Scenario): Promise<string> {
  const need = `${s.id.toUpperCase()} continues ${s.continues!.toUpperCase()}`;
  const { data: customer } = await db.from("customers").select("id").eq("wa_id", s.customer.wa_id).maybeSingle();
  if (!customer) throw new Error(`${need}. Run "npm run scenario -- ${s.continues}" first (nothing has been run for ${s.customer.name} yet).`);

  const { data: msgs } = await db.from("messages").select("sent_at").eq("customer_id", customer.id);
  const have = new Set((msgs ?? []).map((m) => new Date(m.sent_at).getTime()));
  const prior = await loadScenario(s.continues!);
  const missing = prior.messages.filter((m) => !have.has(new Date(m.timestamp).getTime()));
  if (missing.length) {
    throw new Error(`${need}, but ${prior.id.toUpperCase()} is incomplete here (${missing.length} of its ${prior.messages.length} messages are missing). Run "npm run scenario -- ${s.continues}" first.`);
  }
  if (s.messages.some((m) => have.has(new Date(m.timestamp).getTime()))) {
    throw new Error(`${s.id.toUpperCase()} has already been run on this data. Run "npm run scenario -- ${s.continues}" again to reset, then ${s.id}.`);
  }
  return customer.id;
}

export type RunHooks = {
  /** Called before a message is sent. */
  onSend?: (n: number, total: number, m: ScenarioMessage) => void;
  /** Called after a message was processed (or failed). */
  onDone?: (r: MessageResult) => void;
  /** Called once the customer is ready; `kept` is true for scenarios that continue another. */
  onStart?: (s: Scenario, kept: boolean) => void;
};

export async function runScenario(id: string, opts: { delay: number; hooks?: RunHooks }): Promise<ScenarioRun> {
  const s = await loadScenario(id);
  const settings = await loadSettings();
  const profile = getProfile(settings.active_profile);
  const customerId = s.continues ? await continueExisting(s) : await startFresh(s);
  opts.hooks?.onStart?.(s, !!s.continues);

  const messageIds: string[] = [];
  const messageTypes: (string | null)[] = [];
  const sigBefore: string[] = [];
  const sigAfter: string[] = [];
  const results: MessageResult[] = [];
  const verdicts = new Map<number, { ok: boolean; detail: string }>();
  let crashed: string | null = null;

  for (let i = 0; i < s.messages.length; i++) {
    const m = s.messages[i];
    const n = i + 1;
    opts.hooks?.onSend?.(n, s.messages.length, m);
    sigBefore[i] = signature(await loadSnapshot(customerId));

    const input: ProcessInput = {
      customerId,
      direction: m.sender === "customer" ? "in" : "out",
      type: m.event ?? (m.image ? "image" : "text"),
      body: m.text ?? null,
      mediaPath: m.image ?? null,
      sentAt: m.timestamp,
      targetMessageId: m.target ? messageIds[m.target - 1] : null,
    };
    const result: MessageResult = { n, timestamp: m.timestamp, description: describeMessage(m), messageType: null, newFlags: 0, calls: [], error: null };
    try {
      const out = await processMessage(input);
      messageIds[i] = out.messageId;
      messageTypes[i] = out.messageType;
      result.messageType = out.messageType;
      result.newFlags = out.newFlags.length;
      const { data: calls } = await db.from("llm_calls").select("input_tokens, output_tokens, latency_ms, ok").eq("message_id", out.messageId);
      result.calls = (calls ?? []).map((c) => ({ inputTokens: c.input_tokens ?? 0, outputTokens: c.output_tokens ?? 0, latencyMs: c.latency_ms ?? 0, ok: !!c.ok }));
    } catch (err) {
      crashed = err instanceof Error ? err.message : String(err);
      result.error = crashed;
      results.push(result);
      opts.hooks?.onDone?.(result);
      break;
    }
    results.push(result);
    opts.hooks?.onDone?.(result);

    const snap = await loadSnapshot(customerId);
    sigAfter[i] = signature(snap);
    s.expected.forEach((c, k) => {
      if ((c.after ?? s.messages.length) !== n) return;
      verdicts.set(k, evaluateCheck(c, { profile, snap, messageTypes, sigBefore, sigAfter, messageNumber: n }));
    });
    if (i < s.messages.length - 1) await sleep(opts.delay);
  }

  const finalSnap = await loadSnapshot(customerId);
  const checks: CheckResult[] = s.expected.map((c, k) => {
    const v = verdicts.get(k);
    return { label: c.label, after: c.after && c.after < s.messages.length ? c.after : null, ran: !!v, ok: !!v?.ok, detail: v ? v.detail : "not run: scenario stopped early" };
  });
  return {
    id: s.id, name: s.name, customerName: s.customer.name, continues: s.continues ?? null,
    messages: results, checks, summary: formatSummary(finalSnap, profile), crashed,
    ordersCreated: s.continues ? 0 : finalSnap.orders.length,
  };
}
