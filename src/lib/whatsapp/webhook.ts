import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { getSupabase } from "@/lib/supabase";
import { processMessage } from "@/lib/pipeline";
import { parseWebhook, type WaEvent } from "./parse";
import { verifySignature } from "./signature";
import { downloadMedia, extensionFor, mediaPathFor, uploadToMediaBucket } from "./graph";

// Live WhatsApp mode. Meta calls the route; this file decides what to do with each message.
// It feeds the same processMessage() as the simulator.

export type WebhookDeps = {
  processMessage: typeof processMessage;
  downloadMedia: typeof downloadMedia;
  uploadMedia: typeof uploadToMediaBucket;
};

const defaultDeps: WebhookDeps = { processMessage, downloadMedia, uploadMedia: uploadToMediaBucket };

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** GET: Meta checks the endpoint once when you register it (hub.mode, hub.verify_token, hub.challenge). */
export function answerVerification(params: URLSearchParams): Response {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) return new Response("Webhook is not configured", { status: 503 });
  const given = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge");
  if (params.get("hub.mode") === "subscribe" && sameText(given, token) && challenge !== null) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export type WebhookResult = { status: number; body: Record<string, unknown>; work?: () => Promise<void> };

/**
 * POST: check the signature on the raw body, then hand back the work to do after the response.
 * Nothing in the body is trusted, and nothing is processed, until the signature is valid.
 */
export async function receiveWebhook(rawBody: string, signature: string | null, deps: WebhookDeps = defaultDeps): Promise<WebhookResult> {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return { status: 503, body: { error: "Webhook is not configured" } };
  if (!verifySignature(rawBody, signature, secret)) return { status: 403, body: { error: "Invalid signature" } };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Body is not JSON" } };
  }
  const events = parseWebhook(payload, env.whatsappPhoneNumberId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  if (events.length === 0) return { status: 200, body: { ok: true, received: 0 } };

  const work = async () => {
    for (const event of events) {
      try {
        await handleEvent(event, deps);
      } catch (err) {
        // Don't log message text or phone numbers; the message id is enough to find it in WhatsApp.
        console.error(`webhook: could not process a ${event.kind} message (${event.waMessageId}):`, err instanceof Error ? err.message : err);
      }
    }
  };
  return { status: 200, body: { ok: true, received: events.length }, work };
}

async function ensureCustomer(waId: string, name: string | null): Promise<string> {
  const db = getSupabase();
  const find = async () => (await db.from("customers").select("id, name").eq("wa_id", waId).maybeSingle()).data;
  let customer = await find();
  if (!customer) {
    const ins = await db.from("customers").insert({ wa_id: waId, name }).select("id, name").single();
    customer = ins.error ? await find() : ins.data; // two messages from a new customer can arrive together
    if (!customer) throw new Error("Could not create the customer");
  }
  if (!customer.name && name) await db.from("customers").update({ name }).eq("id", customer.id);
  return customer.id;
}

async function findMessageId(customerId: string, waMessageId: string): Promise<string | null> {
  const { data } = await getSupabase().from("messages").select("id").eq("customer_id", customerId).eq("wa_message_id", waMessageId).maybeSingle();
  return data?.id ?? null;
}

/** One event: make sure the customer exists, then send it through the pipeline. */
export async function handleEvent(event: WaEvent, deps: WebhookDeps = defaultDeps): Promise<void> {
  const customerId = await ensureCustomer(event.waId, event.name);
  const common = { customerId, direction: "in" as const, sentAt: event.sentAt, waMessageId: event.waMessageId };

  switch (event.kind) {
    case "text":
      await deps.processMessage({ ...common, type: "text", body: event.body });
      return;

    case "image": {
      // Don't download the same image twice when Meta retries.
      const { data: seen } = await getSupabase().from("messages").select("id").eq("wa_message_id", event.waMessageId).maybeSingle();
      if (seen) return;
      try {
        const { data, mimeType } = await deps.downloadMedia(event.mediaId);
        const path = mediaPathFor(event.waId, event.waMessageId, extensionFor(mimeType) ?? "jpg");
        await deps.uploadMedia(path, data, mimeType);
        await deps.processMessage({ ...common, type: "image", body: event.caption, mediaPath: path });
      } catch (err) {
        console.error(`webhook: image ${event.waMessageId} could not be fetched:`, err instanceof Error ? err.message : err);
        // Still record it, so the owner is told "1 message couldn't be read".
        await deps.processMessage({ ...common, type: "unsupported", body: null });
      }
      return;
    }

    case "edit":
    case "revoke": {
      const targetMessageId = await findMessageId(customerId, event.targetWaMessageId);
      if (!targetMessageId) return; // we never saw the original message, so there is nothing to change
      await deps.processMessage({
        ...common, type: event.kind, body: event.kind === "edit" ? event.body : null, targetMessageId,
      });
      return;
    }

    case "unsupported":
      await deps.processMessage({ ...common, type: "unsupported", body: null });
      return;
  }
}
