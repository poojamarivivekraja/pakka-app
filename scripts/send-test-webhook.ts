import "./load-env";
// Sends a signed, made-up WhatsApp message to your own running app, the way Meta would, so you can
// try the live webhook without a WhatsApp number. Run the app first (npm run dev), then:
//   npm run webhook:test -- --type=text --text="Need a 1 kg mango cake for Saturday"
//   npm run webhook:test -- --type=unsupported
// Types: text (calls the model), unsupported (no model call). Uses the synthetic customer 919900000099.
import { signBody } from "@/lib/whatsapp/signature";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const base = arg("base") ?? "http://localhost:3000";
const type = arg("type") ?? "text";
const secret = process.env.WHATSAPP_APP_SECRET;
if (!secret) {
  console.error("Set WHATSAPP_APP_SECRET in .env.local first (any value works locally; use the same one the app runs with).");
  process.exit(1);
}
const WA = "919900000099";
const id = `wamid.LOCALTEST${Date.now()}`;
const message =
  type === "unsupported"
    ? { from: WA, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "unsupported", errors: [{ code: 131060, title: "This message is currently unavailable." }] }
    : { from: WA, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: arg("text") ?? "Hi, need a 1 kg mango cake for Saturday, pickup at 5 pm" } };
const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "LOCALWABA", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "0", phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "LOCALPHONE" },
    contacts: [{ profile: { name: "Webhook Demo" }, wa_id: WA }],
    messages: [message],
  } }] }],
});

(async () => {
  const started = Date.now();
  const res = await fetch(`${base}/api/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signBody(body, secret) }, body });
  console.log(`POST ${base}/api/webhook -> ${res.status} in ${Date.now() - started} ms: ${await res.text()}`);
  console.log("The message is processed in the background. Open /chats and /  in a moment (customer: Webhook Demo).");
})().catch((e) => { console.error(`Couldn't reach ${base}: ${e.message}`); process.exit(1); });
