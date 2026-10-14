import "./load-env";
// Needs the app running (npm run dev). Usage: npm run check:passcode [-- --base=http://localhost:3000]
// Confirms the AI routes refuse requests without the passcode cookie. No model call is made.
import { PASSCODE_COOKIE, passcodeIsCorrect, passcodeToken, safeNext } from "@/lib/passcode";

const base = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "http://localhost:3000";
let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}

const good = { Cookie: `${PASSCODE_COOKIE}=${passcodeToken()}` };
const wrong = { Cookie: `${PASSCODE_COOKIE}=not-the-passcode` };
const json = { "Content-Type": "application/json" };

async function main() {
  check("a wrong passcode is rejected", !passcodeIsCorrect("definitely-wrong") && !passcodeIsCorrect(""));
  check("the redirect target must be a same-site path", safeNext("https://evil.example") === "/simulator" && safeNext("//evil.example") === "/simulator" && safeNext("/simulator") === "/simulator");
  try {
    await fetch(`${base}/api/health`);
  } catch {
    console.error(`Can't reach ${base}. Start the app first with: npm run dev`);
    process.exit(1);
  }

  const send = (headers: Record<string, string>) =>
    fetch(`${base}/api/simulator/send`, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ scenario: "s5" }) });

  let r = await send({});
  check("AI route /api/simulator/send refuses a request with no cookie (401)", r.status === 401, String(r.status));
  r = await send(wrong);
  check("AI route refuses a wrong cookie (401)", r.status === 401, String(r.status));
  r = await fetch(`${base}/api/simulator/send`, { method: "POST", headers: { ...json, ...wrong }, body: JSON.stringify({ scenario: "s5", custom: { sender: "customer", text: "hi" } }) });
  check("AI route refuses a custom message with a wrong cookie (401)", r.status === 401, String(r.status));
  r = await fetch(`${base}/api/simulator/reset`, { method: "POST", headers: json, body: JSON.stringify({ scenario: "s5" }) });
  check("reset route refuses no cookie (401)", r.status === 401, String(r.status));
  r = await fetch(`${base}/api/simulator/state?scenario=s5`);
  check("state route refuses no cookie (401)", r.status === 401, String(r.status));

  r = await fetch(`${base}/api/simulator/state?scenario=s5`, { headers: good });
  const body = await r.json().catch(() => null);
  check("state route works with the right cookie (200)", r.status === 200 && body?.scenario?.id === "s5", String(r.status));

  r = await fetch(`${base}/simulator`, { redirect: "manual" });
  check("/simulator without a cookie redirects to /passcode", [307, 308].includes(r.status) && (r.headers.get("location") ?? "").includes("/passcode"), `${r.status} ${r.headers.get("location")}`);
  r = await fetch(`${base}/simulator`, { headers: wrong });
  const wrongHtml = await r.text();
  check("/simulator with a wrong cookie never renders the simulator", !wrongHtml.includes("Send next message") && wrongHtml.includes("/passcode"), String(r.status));
  r = await fetch(`${base}/simulator`, { headers: good, redirect: "manual" });
  check("/simulator with the right cookie loads (200)", r.status === 200, String(r.status));
  r = await fetch(`${base}/passcode`);
  check("/passcode page is reachable without a cookie", r.status === 200, String(r.status));

  process.exit(failed ? 1 : 0);
}
main();
