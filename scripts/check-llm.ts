import "./load-env";
import { callLlm, withRetry } from "@/lib/llm";
import { getSupabase } from "@/lib/supabase";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

async function main() {
  // 1. Retry logic, offline: no real waiting.
  const rateLimited = () => Object.assign(new Error("rate limited"), { status: 429 });
  let calls = 0;
  const waits: number[] = [];
  const result = await withRetry(async () => {
    if (++calls < 3) throw rateLimited();
    return "ok";
  }, async (ms) => void waits.push(ms));
  check("retry: succeeds after two 429s", result === "ok" && calls === 3);
  check("retry: backoff grows", waits.length === 2 && waits[1] > waits[0]);

  let overloaded = 0;
  await withRetry(async () => {
    if (++overloaded < 2) throw Object.assign(new Error("high demand"), { status: 503 });
    return "ok";
  }, async () => {});
  check("retry: 503 (high demand) is retried", overloaded === 2);

  let other = 0;
  await withRetry(async () => {
    other++;
    throw Object.assign(new Error("bad request"), { status: 400 });
  }, async () => {}).catch(() => {});
  check("retry: other errors are not retried", other === 1);

  let always = 0;
  await withRetry(async () => {
    always++;
    throw rateLimited();
  }, async () => {}).catch(() => {});
  check("retry: gives up after 5 attempts", always === 5);

  // 2. One real model call.
  const r = await callLlm({
    system: "You output JSON only.",
    prompt: 'Reply with {"greeting": "<a one-word greeting>", "sum": <2+2>}.',
  });
  console.log("\nModel answer:", JSON.stringify(r.json));
  console.log(`Provider/model: ${r.provider} / ${r.model}`);
  console.log(`Input tokens: ${r.inputTokens}  Output tokens: ${r.outputTokens}  Latency: ${r.latencyMs} ms\n`);
  check("model returned a JSON object", typeof r.json === "object" && r.json !== null);
  check("token counts reported", r.inputTokens > 0 && r.outputTokens > 0);

  // 3. The call was logged.
  const { data } = await getSupabase()
    .from("llm_calls")
    .select("provider, model, input_tokens, output_tokens, latency_ms, ok")
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  check("call logged in llm_calls", !!row && row.ok === true && row.input_tokens === r.inputTokens);

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL  check-llm crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
