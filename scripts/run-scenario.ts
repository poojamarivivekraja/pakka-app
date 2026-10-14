import "./load-env";
// Usage: npm run scenario -- s1 [--delay=5000]
import { getProfile } from "@/config/profiles";
import { getSupabase } from "@/lib/supabase";
import { processMessage, type ProcessInput } from "@/lib/pipeline";
import { loadSettings } from "@/lib/pipeline/store";
import {
  evaluateCheck, formatSummary, loadScenario, loadSnapshot, signature,
  type Scenario, type ScenarioMessage,
} from "./scenario-lib";

const db = getSupabase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

const describe = (m: ScenarioMessage) =>
  `${m.sender === "customer" ? "C" : "B"}: ${m.event ? `[${m.event}${m.text ? `: ${m.text}` : ""}]` : m.image ? `[image: ${m.image}]` : m.text}`;

/** Clears this scenario's synthetic customer and creates it fresh. */
async function startFresh(s: Scenario): Promise<string> {
  const del = await db.from("customers").delete().eq("wa_id", s.customer.wa_id);
  if (del.error) throw new Error(`clear customer: ${del.error.message}`);
  const ins = await db.from("customers").insert({ wa_id: s.customer.wa_id, name: s.customer.name }).select("id").single();
  if (ins.error) throw new Error(`create customer: ${ins.error.message}`);
  return ins.data.id;
}

/** S6 and S7 continue earlier scenarios: never clear, and refuse if the earlier one wasn't run (or this one already was). */
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
  const already = s.messages.filter((m) => have.has(new Date(m.timestamp).getTime()));
  if (already.length) {
    throw new Error(`${s.id.toUpperCase()} has already been run on this data. Run "npm run scenario -- ${s.continues}" again to reset, then ${s.id}.`);
  }
  console.log(`(${need}: existing data is kept, nothing is cleared.)\n`);
  return customer.id;
}

async function main() {
  const id = process.argv[2];
  if (!id || id.startsWith("--")) throw new Error("Usage: npm run scenario -- s1");
  const s = await loadScenario(id);
  const delay = Number(arg("delay") ?? process.env.SCENARIO_DELAY_MS ?? 5000);
  const settings = await loadSettings();
  const profile = getProfile(settings.active_profile);

  console.log(`=== ${s.id.toUpperCase()}: ${s.name} (${s.customer.name}, ${s.customer.wa_id}) ===`);
  console.log(`Model: ${process.env.LLM_PROVIDER} / ${process.env.LLM_MODEL}   Profile: ${profile.name}   Pause: ${delay} ms\n`);

  const customerId = s.continues ? await continueExisting(s) : await startFresh(s);

  const messageIds: string[] = [];
  const messageTypes: (string | null)[] = [];
  const sigBefore: string[] = [];
  const sigAfter: string[] = [];
  const verdicts = new Map<number, { label: string; ok: boolean; detail: string; after: number }>();
  const stats = { input: 0, output: 0, latencyMs: 0, calls: 0 };
  let crashed: string | null = null;

  for (let i = 0; i < s.messages.length; i++) {
    const m = s.messages[i];
    const n = i + 1;
    console.log(`[${n}/${s.messages.length}] ${m.timestamp}  ${describe(m)}`);
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
    try {
      const out = await processMessage(input);
      messageIds[i] = out.messageId;
      messageTypes[i] = out.messageType;
      const { data: calls } = await db.from("llm_calls").select("input_tokens, output_tokens, latency_ms").eq("message_id", out.messageId);
      let tok = "no model call";
      for (const c of calls ?? []) {
        stats.input += c.input_tokens ?? 0; stats.output += c.output_tokens ?? 0; stats.latencyMs += c.latency_ms ?? 0; stats.calls++;
        tok = `${c.input_tokens ?? 0} in / ${c.output_tokens ?? 0} out tokens, ${c.latency_ms ?? 0} ms`;
      }
      console.log(`      -> ${out.messageType ?? "event"}; ${out.newFlags.length} new flag(s); ${tok}`);
    } catch (err) {
      crashed = err instanceof Error ? err.message : String(err);
      console.log(`      -> ERROR: ${crashed}`);
      break;
    }

    const snap = await loadSnapshot(customerId);
    sigAfter[i] = signature(snap);
    s.expected.forEach((c, k) => {
      if ((c.after ?? s.messages.length) !== n) return;
      const v = evaluateCheck(c, { profile, snap, messageTypes, sigBefore, sigAfter, messageNumber: n });
      verdicts.set(k, { label: c.label, after: n, ...v });
    });
    if (i < s.messages.length - 1) await sleep(delay);
  }

  console.log("\n--- Result ---\n");
  console.log(formatSummary(await loadSnapshot(customerId), profile));

  console.log("--- Checks ---");
  let failed = 0;
  s.expected.forEach((c, k) => {
    const v = verdicts.get(k);
    const when = c.after && c.after < s.messages.length ? ` (after message ${c.after})` : "";
    if (!v) { failed++; console.log(`FAIL  ${c.label}${when}  (not run: scenario stopped early)`); return; }
    if (!v.ok) failed++;
    console.log(`${v.ok ? "PASS" : "FAIL"}  ${c.label}${when}${v.ok ? "" : `  [${v.detail}]`}`);
  });

  const total = s.expected.length;
  console.log(`\n${total - failed}/${total} checks passed${crashed ? "  (stopped by an error)" : ""}`);
  console.log(`Model: ${process.env.LLM_PROVIDER} / ${process.env.LLM_MODEL}`);
  console.log(`Model calls: ${stats.calls}   Tokens: ${stats.input + stats.output} total (${stats.input} in, ${stats.output} out)   Latency: ${(stats.latencyMs / 1000).toFixed(1)} s total, ${stats.calls ? Math.round(stats.latencyMs / stats.calls) : 0} ms average`);
  process.exit(failed || crashed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
