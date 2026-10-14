import "./load-env";
// Usage: npm run scenario -- s1 [--delay=5000]
import { getProfile } from "@/config/profiles";
import { loadSettings } from "@/lib/pipeline/store";
import { runScenario } from "./scenario-runner";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

async function main() {
  const id = process.argv[2];
  if (!id || id.startsWith("--")) throw new Error("Usage: npm run scenario -- s1");
  const delay = Number(arg("delay") ?? process.env.SCENARIO_DELAY_MS ?? 5000);
  const profile = getProfile((await loadSettings()).active_profile);
  const model = `${process.env.LLM_PROVIDER} / ${process.env.LLM_MODEL}`;

  const run = await runScenario(id, {
    delay,
    hooks: {
      onStart: (s, kept) => {
        console.log(`=== ${s.id.toUpperCase()}: ${s.name} (${s.customer.name}, ${s.customer.wa_id}) ===`);
        console.log(`Model: ${model}   Profile: ${profile.name}   Pause: ${delay} ms\n`);
        if (kept) console.log(`(${s.id.toUpperCase()} continues ${s.continues!.toUpperCase()}: existing data is kept, nothing is cleared.)\n`);
      },
      onSend: (n, total, m) => console.log(`[${n}/${total}] ${m.timestamp}  ${m.sender === "customer" ? "C" : "B"}: ${m.event ? `[${m.event}${m.text ? `: ${m.text}` : ""}]` : m.image ? `[image: ${m.image}]` : m.text}`),
      onDone: (r) => {
        if (r.error) return console.log(`      -> ERROR: ${r.error}`);
        const tok = r.calls.map((c) => `${c.inputTokens} in / ${c.outputTokens} out tokens, ${c.latencyMs} ms`).join("; ") || "no model call";
        console.log(`      -> ${r.messageType ?? "event"}; ${r.newFlags} new flag(s); ${tok}`);
      },
    },
  });

  console.log("\n--- Result ---\n");
  console.log(run.summary);
  console.log("--- Checks ---");
  let failed = 0;
  for (const c of run.checks) {
    if (!c.ok) failed++;
    const when = c.after ? ` (after message ${c.after})` : "";
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.label}${when}${c.ok ? "" : c.ran ? `  [${c.detail}]` : "  (not run: scenario stopped early)"}`);
  }

  const calls = run.messages.flatMap((m) => m.calls);
  const input = calls.reduce((a, c) => a + c.inputTokens, 0);
  const output = calls.reduce((a, c) => a + c.outputTokens, 0);
  const latency = calls.reduce((a, c) => a + c.latencyMs, 0);
  console.log(`\n${run.checks.length - failed}/${run.checks.length} checks passed${run.crashed ? "  (stopped by an error)" : ""}`);
  console.log(`Model: ${model}`);
  console.log(`Model calls: ${calls.length}   Tokens: ${input + output} total (${input} in, ${output} out)   Latency: ${(latency / 1000).toFixed(1)} s total, ${calls.length ? Math.round(latency / calls.length) : 0} ms average`);
  process.exit(failed || run.crashed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
