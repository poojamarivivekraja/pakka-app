import "./load-env";
// npm run eval [-- --repeats=3 --delay=5000 --only=s1,s7 --out=docs/EVAL_RESULTS.md]
//
// Runs every scenario (s1, s7, s2, s6, s3, s4, s5) several times, resetting the scenario data
// before each repeat, and writes docs/EVAL_RESULTS.md. Synthetic data only.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resetAllScenarioData, runScenario, type ScenarioRun } from "./scenario-runner";

// ---------------------------------------------------------------------------
// EDIT ME: cost inputs. Prices are in US dollars per 1 million tokens.
// ---------------------------------------------------------------------------
const PRICE_INPUT_USD_PER_MILLION = 0.3;
const PRICE_OUTPUT_USD_PER_MILLION = 2.5;
/** Rupees per US dollar. Set this to see costs in ₹ (left unset, only dollars are shown). */
const USD_TO_INR: number | null = null;
// ---------------------------------------------------------------------------

const ORDER = ["s1", "s7", "s2", "s6", "s3", "s4", "s5"];

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}
const REPEATS = Number(arg("repeats") ?? 3);
const DELAY = Number(arg("delay") ?? 5000);
const SCENARIOS = (arg("only")?.split(",") ?? ORDER).filter((s) => ORDER.includes(s));
const OUT = path.resolve(arg("out") ?? "docs/EVAL_RESULTS.md");

const usd = (inputTokens: number, outputTokens: number) =>
  (inputTokens / 1e6) * PRICE_INPUT_USD_PER_MILLION + (outputTokens / 1e6) * PRICE_OUTPUT_USD_PER_MILLION;

function money(dollars: number): string {
  const d = dollars >= 1 ? `$${dollars.toFixed(2)}` : `$${dollars.toFixed(dollars < 0.01 ? 5 : 4)}`;
  return USD_TO_INR ? `${d} (₹${(dollars * USD_TO_INR).toFixed(dollars * USD_TO_INR < 1 ? 4 : 2)})` : d;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

type Run = { repeat: number; scenario: ScenarioRun };

async function main() {
  const model = `${process.env.LLM_PROVIDER} / ${process.env.LLM_MODEL}`;
  const thinking = process.env.LLM_THINKING || "off, the lowest the model allows";
  const started = new Date();
  const runs: Run[] = [];
  console.log(`Eval: ${SCENARIOS.join(", ")} x ${REPEATS}, pause ${DELAY} ms, model ${model}\n`);

  for (let repeat = 1; repeat <= REPEATS; repeat++) {
    console.log(`=== Repeat ${repeat} of ${REPEATS}: resetting scenario data ===`);
    await resetAllScenarioData();
    for (const id of SCENARIOS) {
      const t = Date.now();
      let scenario: ScenarioRun;
      try {
        scenario = await runScenario(id, { delay: DELAY });
      } catch (err) {
        // A scenario that can't start (e.g. its prerequisite was filtered out) counts as a crash, not a silent skip.
        const msg = err instanceof Error ? err.message : String(err);
        scenario = { id, name: id, customerName: "", continues: null, messages: [], checks: [], summary: "", crashed: msg, ordersCreated: 0 };
      }
      const passed = scenario.checks.filter((c) => c.ok).length;
      console.log(`  ${id}: ${passed}/${scenario.checks.length} checks${scenario.crashed ? `  CRASHED: ${scenario.crashed}` : ""}  (${((Date.now() - t) / 1000).toFixed(0)} s)`);
      runs.push({ repeat, scenario });
    }
  }
  const finished = new Date();

  // ---------- aggregate ----------
  const byScenario = new Map<string, Run[]>();
  for (const r of runs) byScenario.set(r.scenario.id, [...(byScenario.get(r.scenario.id) ?? []), r]);

  let totalChecks = 0;
  let totalPassed = 0;
  const failures: { id: string; repeat: number; run: ScenarioRun; failing: ScenarioRun["checks"] }[] = [];
  const tableRows: string[] = [];
  const perScenarioRate: string[] = [];

  for (const id of SCENARIOS) {
    const rs = byScenario.get(id) ?? [];
    const labels = rs[0]?.scenario.checks.map((c) => `${c.label}${c.after ? ` (after message ${c.after})` : ""}`) ?? [];
    let sp = 0;
    let st = 0;
    labels.forEach((label, i) => {
      const passes = rs.filter((r) => r.scenario.checks[i]?.ok).length;
      sp += passes;
      st += rs.length;
      tableRows.push(`| ${id.toUpperCase()} | ${cell(label)} | ${passes}/${rs.length}${passes < rs.length ? " ⚠" : ""} |`);
    });
    totalChecks += st;
    totalPassed += sp;
    perScenarioRate.push(`| ${id.toUpperCase()} | ${rs[0]?.scenario.name ?? ""} | ${sp}/${st} |`);
    for (const r of rs) {
      const failing = r.scenario.checks.filter((c) => !c.ok);
      if (failing.length || r.scenario.crashed) failures.push({ id, repeat: r.repeat, run: r.scenario, failing });
    }
  }

  const allMessages = runs.flatMap((r) => r.scenario.messages);
  const allCalls = allMessages.flatMap((m) => m.calls);
  const okCalls = allCalls.filter((c) => c.ok);
  const failedCalls = allCalls.length - okCalls.length;
  const inputTotal = allCalls.reduce((a, c) => a + c.inputTokens, 0);
  const outputTotal = allCalls.reduce((a, c) => a + c.outputTokens, 0);
  const messageCount = allMessages.length;
  const orderCount = runs.reduce((a, r) => a + r.scenario.ordersCreated, 0);
  const latencies = okCalls.map((c) => c.latencyMs).sort((a, b) => a - b);

  const perMsgIn = messageCount ? inputTotal / messageCount : 0;
  const perMsgOut = messageCount ? outputTotal / messageCount : 0;
  const perOrdIn = orderCount ? inputTotal / orderCount : 0;
  const perOrdOut = orderCount ? outputTotal / orderCount : 0;
  const costMsg = usd(perMsgIn, perMsgOut);
  const costOrder = usd(perOrdIn, perOrdOut);

  // ---------- write ----------
  const md: string[] = [];
  md.push("# Pakka eval results", "");
  md.push(`- **Model:** ${model} (thinking: ${thinking})`);
  md.push(`- **Run date:** ${started.toISOString().slice(0, 10)} (started ${started.toISOString().slice(11, 19)} UTC, took ${((finished.getTime() - started.getTime()) / 60000).toFixed(1)} min)`);
  md.push(`- **Scenarios:** ${SCENARIOS.map((s) => s.toUpperCase()).join(", ")}, in that order, repeated ${REPEATS} ${REPEATS === 1 ? "time" : "times"}. Scenario data was reset before each repeat.`);
  md.push(`- **Pause between messages:** ${DELAY / 1000} s. Rate limits and overloads are retried by the model adapter (up to 5 attempts with backoff).`);
  md.push("- **Data:** synthetic only. Generated by `npm run eval`; edit the cost constants at the top of `scripts/eval.ts`.", "");

  md.push("## Overall pass rate", "");
  md.push(`**${totalPassed}/${totalChecks} checks passed (${totalChecks ? ((totalPassed / totalChecks) * 100).toFixed(1) : "0"}%)** across ${runs.length} scenario runs.`, "");
  md.push("| Scenario | Name | Checks passed |", "|---|---|---|", ...perScenarioRate, "");

  md.push("## Every expected check", "", "Pass rate across the repeats. ⚠ marks a check that failed at least once.", "");
  md.push("| Scenario | Check | Passed |", "|---|---|---|", ...tableRows, "");

  md.push("## Checks that failed", "");
  if (failures.length === 0) md.push("None. Every check passed in every run.", "");
  for (const f of failures) {
    md.push(`### ${f.id.toUpperCase()}, repeat ${f.repeat}`, "");
    if (f.run.crashed) md.push(`The scenario stopped with an error: \`${f.run.crashed}\``, "");
    for (const c of f.failing) md.push(`- **FAIL** ${c.label}${c.after ? ` (after message ${c.after})` : ""}: ${c.detail}`);
    md.push("", "Output of that run:", "", "```");
    for (const m of f.run.messages) {
      const tok = m.calls.map((c) => `${c.inputTokens} in / ${c.outputTokens} out, ${c.latencyMs} ms`).join("; ") || "no model call";
      md.push(`[${m.n}] ${m.description}`, `    -> ${m.error ? `ERROR: ${m.error}` : `${m.messageType ?? "event"}; ${m.newFlags} new flag(s); ${tok}`}`);
    }
    md.push("", f.run.summary.trimEnd(), "```", "");
  }

  md.push("## Tokens", "");
  md.push(`${fmt(messageCount)} ${messageCount === 1 ? "message" : "messages"} and ${fmt(orderCount)} ${orderCount === 1 ? "order" : "orders"} were processed in total (${fmt(allCalls.length)} model calls, ${fmt(failedCalls)} of them failed).`, "");
  md.push("| | Input tokens | Output tokens | Total |", "|---|---|---|---|");
  md.push(`| Average per message | ${fmt(perMsgIn)} | ${fmt(perMsgOut)} | ${fmt(perMsgIn + perMsgOut)} |`);
  md.push(`| Average per order | ${fmt(perOrdIn)} | ${fmt(perOrdOut)} | ${fmt(perOrdIn + perOrdOut)} |`);
  md.push(`| Total | ${fmt(inputTotal)} | ${fmt(outputTotal)} | ${fmt(inputTotal + outputTotal)} |`, "");
  md.push("A message here is any scripted message, including the shop's own replies. An order is each order the scenarios create (S6 and S7 add to existing orders).", "");

  md.push("## Latency per model call", "");
  md.push(`Successful calls only (${fmt(okCalls.length)}). Retry waits are not included.`, "");
  md.push("| Average | Median | 95th percentile | Slowest |", "|---|---|---|---|");
  md.push(`| ${fmt(avg(latencies))} ms | ${fmt(percentile(latencies, 50))} ms | ${fmt(percentile(latencies, 95))} ms | ${fmt(latencies[latencies.length - 1] ?? 0)} ms |`, "");

  md.push("## Estimated cost", "");
  md.push(`Prices: $${PRICE_INPUT_USD_PER_MILLION} per 1M input tokens, $${PRICE_OUTPUT_USD_PER_MILLION} per 1M output tokens.${USD_TO_INR ? ` Exchange rate: ₹${USD_TO_INR} per $1.` : " Set `USD_TO_INR` in `scripts/eval.ts` to add rupees."}`, "");
  md.push("| | Cost |", "|---|---|");
  md.push(`| Per message | ${money(costMsg)} |`);
  md.push(`| Per order | ${money(costOrder)} |`);
  md.push(`| Per 100 orders | ${money(costOrder * 100)} |`, "");
  md.push("Per order is the whole conversation that builds one order (about " + fmt(messageCount / Math.max(orderCount, 1), 1) + " messages here). Real chats with more small talk will cost more per order.", "");

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, md.join("\n"));
  console.log(`\nWrote ${path.relative(process.cwd(), OUT)}: ${totalPassed}/${totalChecks} checks passed.`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
