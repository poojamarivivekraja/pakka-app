import "./load-env";
// Restores the Orders screen to the demo story: clears the scenario data, then replays
// s1, s7, s2, s6, s3, s4, s5 in order. Calls the model, so it takes a few minutes.
// Usage: npm run seed:demo [-- --delay=5000]
import { resetAllScenarioData, runScenario } from "./scenario-runner";

const ORDER = ["s1", "s7", "s2", "s6", "s3", "s4", "s5"];
const delay = Number(process.argv.find((a) => a.startsWith("--delay="))?.split("=")[1] ?? process.env.SCENARIO_DELAY_MS ?? 5000);

async function main() {
  console.log("Clearing the scenario data...");
  await resetAllScenarioData();
  let problems = 0;
  for (const id of ORDER) {
    console.log(`\n=== ${id.toUpperCase()} ===`);
    const run = await runScenario(id, {
      delay,
      hooks: {
        onSend: (n, total, m) => console.log(`[${n}/${total}] ${m.sender === "customer" ? "C" : "B"}: ${m.event ? `[${m.event}]` : m.image ? `[image: ${m.image}]` : m.text}`),
        onDone: (r) => r.error && console.log(`      -> ERROR: ${r.error}`),
      },
    });
    const failed = run.checks.filter((c) => !c.ok).length;
    if (failed || run.crashed) problems++;
    console.log(`${run.checks.length - failed}/${run.checks.length} checks passed${run.crashed ? " (stopped by an error)" : ""}`);
  }
  console.log(problems ? `\nDone, but ${problems} scenario(s) had failed checks. Run npm run scenario -- <id> to look closer.` : "\nDone. The Orders screen shows the demo story.");
  process.exit(problems ? 1 : 0);
}
main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
