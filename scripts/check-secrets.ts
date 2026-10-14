import "./load-env";
// Offline check that no secret is in the repository or its history. Never prints a secret value:
// it only says which variable matched and in which file.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });

const SECRET_VARS = [
  "GEMINI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DEMO_PASSCODE",
  "WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN",
];
const PATTERNS: [string, RegExp][] = [
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/],
  ["JWT (e.g. a Supabase key)", /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ["secret-style key (sk-...)", /\bsk-[A-Za-z0-9]{20,}/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{10,}/],
];

const tracked = git("ls-files").split("\n").filter(Boolean);
const history = git("log", "-p", "--all", "--no-color");

// 1. Ignore rules and tracked files
check(".gitignore covers .env.local", git("check-ignore", ".env.local").trim() === ".env.local");
check("no .env file is tracked except .env.example", tracked.filter((f) => /(^|\/)\.env/.test(f) && !f.endsWith(".env.example")).length === 0);
check(".env.local was never committed", !git("log", "--all", "--name-only", "--pretty=format:").split("\n").some((f) => /(^|\/)\.env(?!\.example)/.test(f)));

// 2. Generic secret shapes, in files and history
for (const [label, re] of PATTERNS) {
  const files = tracked.filter((f) => { try { return re.test(readFileSync(f, "utf8")); } catch { return false; } });
  check(`no ${label} in tracked files`, files.length === 0, files.join(", "));
  check(`no ${label} anywhere in git history`, !re.test(history));
}

// 3. Your actual values, if .env.local is present
const present = SECRET_VARS.filter((n) => (process.env[n] ?? "").length >= 4);
if (present.length === 0) console.log("SKIP  actual values: no secrets in the environment to compare against");
for (const name of present) {
  const value = process.env[name]!;
  const inFiles = tracked.filter((f) => { try { return readFileSync(f, "utf8").includes(value); } catch { return false; } });
  check(`${name} does not appear in any tracked file`, inFiles.length === 0, inFiles.join(", "));
  const segments = history.split("diff --git ").filter((seg) => seg.includes(value));
  const where = segments.map((s) => s.split("\n")[0].replace(/^a\/(.*) b\/.*$/, "$1"));
  check(`${name} does not appear anywhere in git history`, segments.length === 0, where.join(", "));
}

// 4. .env.example lists every variable the code reads, with no values
const example = readFileSync(".env.example", "utf8");
const listed = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=(.*)$/gm)].map((m) => m[1]));
check(".env.example has no values", ![...example.matchAll(/^([A-Z][A-Z0-9_]+)=(.+)$/gm)].length);

const sources = tracked.filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !f.endsWith("check-secrets.ts"));
const used = new Set<string>();
for (const f of sources) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
  for (const m of text.matchAll(/required\("([A-Z][A-Z0-9_]+)"\)/g)) used.add(m[1]);
}
for (const builtin of ["NODE_ENV"]) used.delete(builtin);
const missing = [...used].filter((n) => !listed.has(n)).sort();
check(".env.example lists every variable the code reads", missing.length === 0, `missing: ${missing.join(", ")}`);
for (const n of ["DEMO_TODAY", "LLM_THINKING", "DEMO_PASSCODE", "GEMINI_API_KEY", "LLM_PROVIDER", "LLM_MODEL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  check(`.env.example lists ${n}`, listed.has(n));
}

void path;
process.exit(failed ? 1 : 0);
