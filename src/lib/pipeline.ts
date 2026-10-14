import "server-only";
import type { Flag, Message } from "@/types/db";
import { getProfile } from "@/config/profiles";
import { callLlm } from "@/lib/llm";
import type { MessageCtx, Workspace } from "./pipeline/draft";
import {
  EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt, parseModelResult, type ModelResult,
} from "./pipeline/extraction-prompt";
import { loadImage } from "./pipeline/media";
import { applyEditedMessage, applyExtraction, finaliseChanged } from "./pipeline/rules-apply";
import { flagRevokedMessage, flagUnreadableMessage, ordersUsingMessage } from "./pipeline/rules-events";
import {
  businessRepliedAfter, insertMessage, loadMessage, loadRecentMessages, loadSettings, loadWorkspace,
  saveWorkspace, setMessageStatus,
} from "./pipeline/store";

// The one entry point for both the simulator and live WhatsApp webhooks.

export type ProcessInput = {
  customerId: string;
  direction: "in" | "out";
  type: Message["type"];
  /** Text, caption, or (for an edit) the new text. */
  body?: string | null;
  /** Image path: "samples/..." in public/, otherwise a path in the `media` bucket. */
  mediaPath?: string | null;
  sentAt: string;
  waMessageId?: string | null;
  /** For edit and revoke: the messages.id of the message being edited or deleted. */
  targetMessageId?: string | null;
};

export type ProcessOutput = {
  messageId: string;
  duplicate: boolean;
  messageType: string | null;
  orderIds: string[];
  /** Flags created by this message, e.g. to show a "needs review" toast. */
  newFlags: Flag[];
};

const toCtx = (m: Message, body = m.body): MessageCtx => ({
  id: m.id, customerId: m.customer_id!, direction: m.direction, type: m.type, body, sentAt: m.sent_at,
});

function summarise(ws: Workspace, messageId: string, result: ModelResult | null): ProcessOutput {
  const changed = ws.orders.filter((d) => d.isNew || d.newFlags.length || d.newEvents.length || d.newNotes.length || d.newAttachments.length || d.newPending.length);
  return {
    messageId,
    duplicate: false,
    messageType: result?.message_type ?? null,
    orderIds: changed.map((d) => d.order.id),
    newFlags: [...ws.orders.flatMap((d) => d.newFlags), ...ws.customerFlags],
  };
}

/** Steps 1-3 of one message: ask the model, run the rules, save. `source` is the message the details are credited to. */
async function extract(
  ws: Workspace, source: Message, ctx: MessageCtx, llmMessageId: string, businessName: string,
  edit?: { previousText: string | null; orderIds: string[] },
) {
  const recent = await loadRecentMessages(ws.customerId, source.sent_at, source.id);
  const image = ctx.type === "image" && source.media_path ? await loadImage(source.media_path) : undefined;
  const llm = await callLlm({
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt: buildExtractionPrompt({ businessName, profile: ws.profile, message: ctx, orders: ws.orders, recentMessages: recent, edit }),
    image,
    messageId: llmMessageId,
  });
  return parseModelResult(llm.json);
}

export async function processMessage(input: ProcessInput): Promise<ProcessOutput> {
  const { message, duplicate } = await insertMessage({
    customerId: input.customerId, direction: input.direction, type: input.type,
    body: input.body ?? null, mediaPath: input.mediaPath ?? null, sentAt: input.sentAt,
    waMessageId: input.waMessageId ?? null,
    raw: input.targetMessageId ? { target_message_id: input.targetMessageId } : null,
  });
  if (duplicate) {
    return { messageId: message.id, duplicate: true, messageType: null, orderIds: [], newFlags: [] };
  }

  try {
    const settings = await loadSettings();
    const ws = await loadWorkspace(input.customerId, getProfile(settings.active_profile));
    let result: ModelResult | null = null;

    if (message.type === "text" || message.type === "image") {
      result = await extract(ws, message, toCtx(message), message.id, settings.business_name);
      applyExtraction(ws, result, toCtx(message));
    } else if (message.type === "edit") {
      const original = await loadMessage(input.targetMessageId ?? "");
      if (original.customer_id !== input.customerId) throw new Error("Edited message belongs to another customer");
      const ctx = toCtx(original, input.body ?? "");
      ctx.type = "text";
      const edit = {
        previousText: original.body,
        orderIds: ordersUsingMessage(ws, original.id).map((d) => d.order.id),
      };
      result = await extract(ws, original, ctx, message.id, settings.business_name, edit);
      const replied = await businessRepliedAfter(input.customerId, original.sent_at);
      applyEditedMessage(ws, result, ctx, { businessRepliedSince: replied });
      await setMessageStatus(original.id, "edited", input.body ?? "");
    } else if (message.type === "revoke") {
      const target = await loadMessage(input.targetMessageId ?? "");
      if (target.customer_id !== input.customerId) throw new Error("Deleted message belongs to another customer");
      flagRevokedMessage(ws, target.id, message.id);
      finaliseChanged(ws, message.id);
      await setMessageStatus(target.id, "revoked");
    } else {
      flagUnreadableMessage(ws, message.id);
      finaliseChanged(ws, message.id);
    }

    await saveWorkspace(ws);
    await setMessageStatus(message.id, "processed");
    return summarise(ws, message.id, result);
  } catch (err) {
    await setMessageStatus(message.id, "failed").catch(() => {});
    throw err;
  }
}
