// Offline check: every route that can reach the model is gated: by the passcode, or (for the
// WhatsApp webhook, which Meta calls and which can't send a passcode) by Meta's request signature.
// It follows imports from each route, page and server action under src/app; anything that can
// reach src/lib/llm.ts must go through the passcode check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}

const ROOT = path.resolve("src");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
const files = walk(ROOT);

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (files.includes(c)) return c;
  return null;
}

const graph = new Map<string, string[]>();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
  graph.set(f, specs.map((s) => resolveImport(f, s)).filter((x): x is string => !!x));
}

const LLM = path.join(ROOT, "lib", "llm.ts");
const reachesModel = (start: string, seen = new Set<string>()): boolean => {
  if (start === LLM) return true;
  if (seen.has(start)) return false;
  seen.add(start);
  return (graph.get(start) ?? []).some((n) => reachesModel(n, seen));
};

const entries = files.filter((f) => f.startsWith(path.join(ROOT, "app")) && /(route|page|actions|layout)\.tsx?$/.test(f));
const aiEntries = entries.filter((f) => reachesModel(f));
const rel = (f: string) => path.relative(ROOT, f);

check("at least one route reaches the model (the check is looking at the right thing)", aiEntries.length > 0);
for (const f of aiEntries) {
  const text = readFileSync(f, "utf8");
  const isRoute = /route\.tsx?$/.test(f);
  const passcode = /simulatorRoute|refuseWithoutPasscode/.test(text);
  const signature = /receiveWebhook/.test(text) && rel(f) === path.join("app", "api", "webhook", "route.ts");
  check(`${rel(f)} reaches the model and is ${isRoute ? (signature ? "signature-gated" : "passcode-gated") : "NOT a page or action (not allowed)"}`, isRoute && (passcode || signature));
}
const webhook = readFileSync(path.join(ROOT, "lib", "whatsapp", "webhook.ts"), "utf8");
const receive = webhook.slice(webhook.indexOf("export async function receiveWebhook"));
check("receiveWebhook() refuses an unsigned request before it parses or processes anything",
  receive.indexOf("verifySignature(") !== -1 && receive.indexOf("verifySignature(") < receive.indexOf("JSON.parse") && receive.indexOf("JSON.parse") < receive.indexOf("handleEvent"));
check("receiveWebhook() returns 403 for a bad signature and 503 when no secret is set", /status: 403/.test(receive) && /status: 503/.test(receive));
// The shared wrapper itself must do the check.
const wrapper = readFileSync(path.join(ROOT, "lib", "simulator-route.ts"), "utf8");
check("simulatorRoute() calls refuseWithoutPasscode() before running anything", /refuseWithoutPasscode\(\)[\s\S]*?return refused[\s\S]*?await run\(\)/.test(wrapper));
const passcode = readFileSync(path.join(ROOT, "lib", "passcode.ts"), "utf8");
check("the check returns 401 without a valid cookie", /status:\s*401/.test(passcode));


// ---- Every way to change data is passcode-gated (or signature-gated for Meta's webhook) ----
const appFiles = files.filter((f) => f.startsWith(path.join(ROOT, "app")));
const routes = appFiles.filter((f) => /route\.tsx?$/.test(f));
const KNOWN_READ_ONLY = [path.join("app", "api", "notifications", "route.ts")];
for (const f of routes) {
  const text = readFileSync(f, "utf8");
  const writes = /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)|export\s+const\s+(POST|PUT|PATCH|DELETE)/.test(text);
  const gated = /simulatorRoute|refuseWithoutPasscode|receiveWebhook/.test(text);
  if (writes) check(`${rel(f)} accepts writes and is gated`, gated);
  else check(`${rel(f)} has no write method and is on the read-only list`, KNOWN_READ_ONLY.includes(rel(f)) || gated, "a new GET route? add it to KNOWN_READ_ONLY only if it changes nothing");
}
// Server actions: every exported action must do the passcode check before anything else.
for (const f of appFiles.filter((x) => /actions\.tsx?$/.test(x))) {
  const text = readFileSync(f, "utf8");
  if (!/^["']use server["']/m.test(text)) continue;
  if (rel(f) === path.join("app", "passcode", "actions.ts")) continue; // the login itself: it writes nothing
  check(`${rel(f)} imports the passcode check`, /refuseActionWithoutPasscode/.test(text));
  const exported = [...text.matchAll(/export\s+(?:async\s+function\s+(\w+)[^{]*\{([\s\S]*?)\n\}|const\s+(\w+)\s*=\s*async[^\n]*\n?[^\n]*)/g)];
  for (const m of exported) {
    const name = m[1] ?? m[3];
    const body = m[0];
    const gated = /refuseActionWithoutPasscode\(\)|\brun\(/.test(body);
    check(`${rel(f)}: ${name}() is gated`, gated);
  }
  if (/const run\s*=|function run\(/.test(text) || /async function run\(/.test(text)) {
    const run = text.slice(text.indexOf("async function run("));
    check(`${rel(f)}: run() checks the passcode before it does anything`, run.indexOf("refuseActionWithoutPasscode()") !== -1 && run.indexOf("refuseActionWithoutPasscode()") < run.indexOf("await fn()"));
  }
}
const pc = readFileSync(path.join(ROOT, "lib", "passcode.ts"), "utf8");
check("refuseActionWithoutPasscode() returns 401 without a valid cookie", /refuseActionWithoutPasscode[\s\S]*status: 401/.test(pc));
check("/api/health is gone", !files.some((f) => f.includes(path.join("api", "health"))));

process.exit(failed ? 1 : 0);
