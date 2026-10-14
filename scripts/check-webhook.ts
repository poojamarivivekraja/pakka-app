import "./load-env";
// Checks for the live WhatsApp webhook. Meta's servers and the model are stubbed: nothing here
// calls the network except our own database (a synthetic customer, deleted at the end).
process.env.WHATSAPP_APP_SECRET = "test-secret-not-real";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE1";

import { getSupabase } from "@/lib/supabase";
import { processMessage, type ProcessInput } from "@/lib/pipeline";
import { insertMessage } from "@/lib/pipeline/store";
import { parseWebhook } from "@/lib/whatsapp/parse";
import { signBody, verifySignature } from "@/lib/whatsapp/signature";
import { extensionFor, mediaPathFor } from "@/lib/whatsapp/graph";
import { answerVerification, handleEvent, receiveWebhook, type WebhookDeps } from "@/lib/whatsapp/webhook";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}

const SECRET = "test-secret-not-real";
const WA = `test-webhook-${Date.now()}`;
const ts = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));
const wrap = (messages: unknown[], opts: { phoneId?: string; name?: string | null } = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA1", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "0", phone_number_id: opts.phoneId ?? "PHONE1" },
    contacts: opts.name === null ? [] : [{ profile: { name: opts.name ?? "Webhook Check" }, wa_id: WA }],
    messages,
  } }] }],
});
const msg = (over: Record<string, unknown>) => ({ from: WA, id: `wamid.${Math.random().toString(36).slice(2)}`, timestamp: ts("2026-10-22T04:00:00Z"), ...over });

async function main() {
  // ---------- signature
  const body = JSON.stringify(wrap([msg({ type: "text", text: { body: "hi" } })]));
  const good = signBody(body, SECRET);
  check("signature: a correct signature is accepted", verifySignature(body, good, SECRET));
  check("signature: a tampered body is rejected", !verifySignature(body + " ", good, SECRET));
  check("signature: a wrong secret is rejected", !verifySignature(body, signBody(body, "other"), SECRET));
  check("signature: a missing or malformed header is rejected", !verifySignature(body, null, SECRET) && !verifySignature(body, "", SECRET) && !verifySignature(body, good.replace("sha256=", "sha1="), SECRET) && !verifySignature(body, "sha256=zz", SECRET) && !verifySignature(body, "sha256=abcd", SECRET));
  check("signature: an empty secret never matches", !verifySignature(body, signBody(body, ""), ""));

  // ---------- verification handshake
  const verify = (q: string) => answerVerification(new URLSearchParams(q));
  const ok = verify("hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345");
  check("verify: the right token gets the challenge back", ok.status === 200 && (await ok.text()) === "12345");
  check("verify: a wrong token is refused", verify("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1").status === 403);
  check("verify: no token is refused", verify("hub.mode=subscribe&hub.challenge=1").status === 403);
  check("verify: a wrong mode is refused", verify("hub.mode=unsubscribe&hub.verify_token=test-verify-token&hub.challenge=1").status === 403);

  // ---------- parsing
  const one = (m: unknown, opts?: Parameters<typeof wrap>[1]) => parseWebhook(wrap([m], opts), "PHONE1");
  const t = one(msg({ id: "w1", type: "text", text: { body: "Need a cake" } }))[0];
  check("parse: text message", t.kind === "text" && t.kind === "text" && t.body === "Need a cake" && t.waId === WA && t.waMessageId === "w1" && t.name === "Webhook Check");
  check("parse: the timestamp becomes an ISO time", t.sentAt === "2026-10-22T04:00:00.000Z", t.sentAt);
  const img = one(msg({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "the design" } }))[0];
  check("parse: image with media id and caption", img.kind === "image" && img.mediaId === "MEDIA1" && img.caption === "the design" && img.mimeType === "image/jpeg");
  const un131060 = one(msg({ type: "unsupported", errors: [{ code: 131060, title: "This message is currently unavailable." }] }))[0];
  check("parse: error 131060 (message unavailable) is unsupported", un131060.kind === "unsupported" && un131060.detail.includes("131060"));
  const unEdit = one(msg({ type: "unsupported", errors: [{ code: 131051 }], unsupported: { type: "edit" } }))[0];
  check("parse: an edit Meta delivers as 'unsupported' is unsupported", unEdit.kind === "unsupported" && unEdit.detail.includes("edit"));
  check("parse: an error on a text message wins over its text", one(msg({ type: "text", text: { body: "x" }, errors: [{ code: 131051 }] }))[0].kind === "unsupported");
  check("parse: voice notes, stickers and locations are unsupported", ["audio", "sticker", "location", "video", "document", "contacts"].every((type) => one(msg({ type }))[0].kind === "unsupported"));
  const edit = one(msg({ id: "e1", type: "edit", edit: { original_message_id: "w1", message: { type: "text", text: { body: "1.5 kg please" } } } }))[0];
  check("parse: edit with new text", edit.kind === "edit" && edit.targetWaMessageId === "w1" && edit.body === "1.5 kg please");
  const editImg = one(msg({ type: "edit", edit: { original_message_id: "w2", message: { type: "image", image: { caption: "new caption", id: "M" } } } }))[0];
  check("parse: edit of an image caption", editImg.kind === "edit" && editImg.body === "new caption");
  check("parse: an edit without readable text is unsupported", one(msg({ type: "edit", edit: { original_message_id: "w1" } }))[0].kind === "unsupported");
  const rev = one(msg({ type: "revoke", revoke: { original_message_id: "w1" } }))[0];
  check("parse: revoke", rev.kind === "revoke" && rev.targetWaMessageId === "w1");
  check("parse: reactions and system events are ignored", one(msg({ type: "reaction", reaction: { emoji: "👍" } })).length === 0 && one(msg({ type: "system" })).length === 0);
  check("parse: delivery status updates are ignored", parseWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PHONE1" }, statuses: [{ id: "x", status: "read" }] } }] }] }, "PHONE1").length === 0);
  check("parse: messages to another business number are ignored", one(msg({ type: "text", text: { body: "x" } }), { phoneId: "OTHER" }).length === 0);
  check("parse: no name in the contacts is fine", one(msg({ type: "text", text: { body: "x" } }), { name: null })[0].name === null);
  check("parse: several messages keep their order", parseWebhook(wrap([msg({ id: "a", type: "text", text: { body: "1" } }), msg({ id: "b", type: "text", text: { body: "2" } })]), "PHONE1").map((e) => e.waMessageId).join() === "a,b");
  check("parse: junk never throws", [null, "x", 5, {}, { entry: "x" }, { entry: [null, { changes: [1, { value: 2 }] }] }, wrap([null, 1, { type: "text" }])].every((p) => parseWebhook(p, "PHONE1").length === 0));
  check("graph: only images Pakka can read are accepted", extensionFor("image/jpeg") === "jpg" && extensionFor("image/png; charset=x") === "png" && extensionFor("image/gif") === null && extensionFor("audio/ogg") === null);
  check("graph: storage paths can't escape the bucket", mediaPathFor("919", "wamid.A/../B=", "jpg") === "919/wamid.A_.._B_.jpg");

  // ---------- receiving a POST (no database work yet)
  const noDeps = {} as WebhookDeps;
  let r = await receiveWebhook(body, null, noDeps);
  check("receive: no signature -> 403 and no work", r.status === 403 && !r.work);
  r = await receiveWebhook(body, signBody(body, "wrong"), noDeps);
  check("receive: a wrong signature -> 403 and no work", r.status === 403 && !r.work);
  r = await receiveWebhook("{not json", signBody("{not json", SECRET), noDeps);
  check("receive: a signed body that isn't JSON -> 400", r.status === 400 && !r.work);
  r = await receiveWebhook(JSON.stringify(wrap([])), signBody(JSON.stringify(wrap([])), SECRET), noDeps);
  check("receive: nothing to do -> 200 and no work", r.status === 200 && !r.work);
  r = await receiveWebhook(body, good, noDeps);
  check("receive: a valid signature -> 200 immediately, with the work handed back", r.status === 200 && typeof r.work === "function" && r.body.received === 1);
  const saved = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  r = await receiveWebhook(body, good, noDeps);
  check("receive: with no app secret configured the webhook refuses everything (503)", r.status === 503 && !r.work);
  process.env.WHATSAPP_APP_SECRET = saved;

  // ---------- recording events (our database; Meta and the model stubbed)
  const db = getSupabase();
  const calls: ProcessInput[] = [];
  const uploads: string[] = [];
  let downloads = 0;
  let downloadFails = false;
  const stubs: WebhookDeps = {
    processMessage: async (input) => { calls.push(input); return { messageId: "stub", duplicate: false, messageType: null, orderIds: [], newFlags: [] }; },
    downloadMedia: async () => { downloads++; if (downloadFails) throw new Error("boom"); return { data: Buffer.from("fake image"), mimeType: "image/png" }; },
    uploadMedia: async (p) => { uploads.push(p); },
  };
  const parse1 = (m: unknown) => parseWebhook(wrap([m]), "PHONE1")[0];

  try {
    await handleEvent(parse1(msg({ id: "wt1", type: "text", text: { body: "Need a cake" } })), stubs);
    const { data: cs } = await db.from("customers").select("id, name").eq("wa_id", WA);
    check("record: a new customer is created with their WhatsApp name", cs?.length === 1 && cs[0].name === "Webhook Check");
    check("record: a text message is sent to the pipeline as the customer's", calls[0]?.type === "text" && calls[0].body === "Need a cake" && calls[0].direction === "in" && calls[0].waMessageId === "wt1" && calls[0].customerId === cs![0].id && calls[0].sentAt === "2026-10-22T04:00:00.000Z");
    await handleEvent(parse1(msg({ id: "wt2", type: "text", text: { body: "again" } })), stubs);
    check("record: the same customer is reused", ((await db.from("customers").select("id").eq("wa_id", WA)).data ?? []).length === 1);
    const customerId = cs![0].id;

    await handleEvent(parse1(msg({ id: "wimg1", type: "image", image: { id: "MEDIA1", mime_type: "image/png", caption: "design" } })), stubs);
    const imgCall = calls[calls.length - 1];
    check("record: an image is downloaded, saved to the media bucket, then processed", downloads === 1 && uploads[0] === `${WA}/wimg1.png` && imgCall.type === "image" && imgCall.mediaPath === `${WA}/wimg1.png` && imgCall.body === "design");

    await insertMessage({ customerId, direction: "in", type: "image", body: null, mediaPath: "x/y.png", sentAt: "2026-10-22T04:01:00Z", waMessageId: "wimg-seen", raw: null });
    const before = { downloads, calls: calls.length };
    await handleEvent(parse1(msg({ id: "wimg-seen", type: "image", image: { id: "MEDIA2" } })), stubs);
    check("record: an image we already have is not downloaded again", downloads === before.downloads && calls.length === before.calls);

    downloadFails = true;
    await handleEvent(parse1(msg({ id: "wimg-bad", type: "image", image: { id: "MEDIA3" } })), stubs);
    check("record: an image that can't be fetched is recorded as unreadable, not lost", calls[calls.length - 1].type === "unsupported" && calls[calls.length - 1].waMessageId === "wimg-bad");
    downloadFails = false;

    const orig = await insertMessage({ customerId, direction: "in", type: "text", body: "2 kg cake", mediaPath: null, sentAt: "2026-10-22T04:02:00Z", waMessageId: "worig", raw: null });
    await handleEvent(parse1(msg({ id: "wedit", type: "edit", edit: { original_message_id: "worig", message: { type: "text", text: { body: "1.5 kg cake" } } } })), stubs);
    const editCall = calls[calls.length - 1];
    check("record: an edit points at our copy of the original message", editCall.type === "edit" && editCall.targetMessageId === orig.message.id && editCall.body === "1.5 kg cake");
    const n = calls.length;
    await handleEvent(parse1(msg({ id: "wedit2", type: "edit", edit: { original_message_id: "never-seen", message: { type: "text", text: { body: "x" } } } })), stubs);
    check("record: an edit of a message we never saw is ignored", calls.length === n);

    // The real pipeline, for the events that need no model:
    const real: WebhookDeps = { ...stubs, processMessage };
    await handleEvent(parse1(msg({ id: "wun1", type: "unsupported", errors: [{ code: 131060 }] })), real);
    const unreadable = () => db.from("flags").select("id, detail").eq("customer_id", customerId).eq("type", "message_unreadable");
    check("record: an unsupported message raises 'couldn't be read'", ((await unreadable()).data ?? []).some((f) => f.detail === "1 message couldn't be read. Check WhatsApp."));
    const flagsBefore = ((await unreadable()).data ?? []).length;
    await handleEvent(parse1(msg({ id: "wun1", type: "unsupported", errors: [{ code: 131060 }] })), real);
    check("record: Meta delivering it twice raises it once", ((await unreadable()).data ?? []).length === flagsBefore);

    await handleEvent(parse1(msg({ id: "wrev", type: "revoke", revoke: { original_message_id: "worig" } })), real);
    const revoked = (await db.from("messages").select("status").eq("id", orig.message.id).single()).data;
    check("record: a revoke marks the original message deleted", revoked?.status === "revoked");
    check("record: a revoke raises 'message deleted'", ((await db.from("flags").select("id").eq("customer_id", customerId).eq("type", "message_deleted")).data ?? []).length === 1);

    const [a, b] = await Promise.all([
      insertMessage({ customerId, direction: "in", type: "text", body: "race", mediaPath: null, sentAt: "2026-10-22T04:05:00Z", waMessageId: "wrace", raw: null }),
      insertMessage({ customerId, direction: "in", type: "text", body: "race", mediaPath: null, sentAt: "2026-10-22T04:05:00Z", waMessageId: "wrace", raw: null }),
    ]);
    check("record: the same message arriving at the same moment is saved once, without an error", [a.duplicate, b.duplicate].filter(Boolean).length === 1 && a.message.id === b.message.id);
  } finally {
    await db.from("customers").delete().eq("wa_id", WA);
  }
  check("test data cleaned up", ((await db.from("customers").select("id").eq("wa_id", WA)).data ?? []).length === 0);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL  check-webhook crashed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
