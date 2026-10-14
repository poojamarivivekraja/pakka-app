import { z } from "zod";
import type { Profile } from "@/types/profile";
import type { OrderDraft, MessageCtx } from "./draft";
import { openPending } from "./draft";
import { describeTimestamp } from "./helpers";

// Section 5 of docs/BRIEF.md (plus the pickup/delivery time rule). Keep the two in sync.
export const EXTRACTION_SYSTEM_PROMPT = `You are an order-tracking assistant for a small business that takes custom orders on
WhatsApp. You read ONE new message at a time, plus context, and report what it means for
the business's orders. You never write replies to customers. You output JSON only.

CONTEXT YOU RECEIVE
- business_name, today's date, the new message's timestamp
- sender: "customer" or "business"
- the business profile's field list (keys, labels, types)
- the customer's open orders: id and current field values
- open pending requests for those orders: id, order id, field, requested value
- the last 15 messages in this chat, oldest first, each with id and sender
- for images: the image and any caption

YOUR TASKS
1. Classify: new_order | order_detail | change | payment | agreement | refusal |
   delivery_coordination | small_talk | other
2. Link to an order: an existing order id, "NEW" for a separate new order, or "NONE".
   If the customer has more than one open order and it's unclear which one, set
   link_confidence "low" and list candidate_order_ids.
3. Extract field updates using ONLY the profile's field keys.
4. If a business message agrees to or refuses an open pending request, list its id in
   agrees_to_pending or refuses_pending.
5. For images, decide image_role: reference_image | payment_screenshot | other.
   reference_image: one short sentence describing the design.
   payment_screenshot: read amount, reference, payee and date exactly as shown.

STRICT RULES
- Extract only what this message states. Never guess, infer unstated details, or use
  general knowledge.
- Every text-based field update must include "quote": the exact words from this message
  that support it. If you cannot quote it, do not extract it.
- agreed_by_business is true when the sender is "business", or when the value is a
  customer request the business already agreed to in an earlier message.
- If two incompatible values appear with no clear change (e.g. customer says "you said
  1600 na" after the business said 1800), do NOT pick one; return a conflict.
- Money: copy numbers exactly as written. Never calculate totals, balances or discounts.
- Times: for pickup or delivery times written without am or pm, hours 1 to 8 mean pm.
  Approximate wording such as "around 6" or "6ish" is still confidence "high".
- Dates: resolve relative dates against the message timestamp, output ISO format, keep
  the original words in "quote", and set confidence "low" if ambiguous.
- exact_text fields: copy spelling exactly, including the customer's own spelling.
- A payment screenshot is never proof of payment. Report what it shows; never say "paid".
- Messages may be English, Hinglish or mixed, with typos. If unsure, set confidence "low".

OUTPUT (JSON only)
{
  "message_type": "...",
  "order_ref": "<order id> | NEW | NONE",
  "link_confidence": "high | low",
  "candidate_order_ids": [],
  "field_updates": [
    { "field": "...", "value": "...", "quote": "...",
      "agreed_by_business": false, "confidence": "high | low" }
  ],
  "agrees_to_pending": [],
  "refuses_pending": [],
  "conflicts": [ { "field": "...", "values": ["...", "..."], "detail": "..." } ],
  "image_role": "reference_image | payment_screenshot | other | null",
  "image_description": null,
  "payment": null
}

For a payment screenshot, "payment" is { "amount": "...", "reference": "...", "payee": "...", "date": "..." }
with each value copied exactly as shown (null if not visible). Otherwise "payment" is null.`;

// What the model may return. Tolerant of numbers-as-strings and missing lists; strict on shape.
const text = z.union([z.string(), z.number()]).transform(String);
const nullableText = text.nullish().transform((v) => v ?? null);

export const modelResultSchema = z.object({
  message_type: z.string().catch("other"),
  order_ref: z.string().catch("NONE"),
  link_confidence: z.enum(["high", "low"]).catch("high"),
  candidate_order_ids: z.array(z.string()).catch([]),
  field_updates: z
    .array(
      z.object({
        field: z.string(),
        value: text,
        quote: nullableText,
        agreed_by_business: z.boolean().catch(false),
        confidence: z.enum(["high", "low"]).catch("low"),
      }),
    )
    .catch([]),
  agrees_to_pending: z.array(z.string()).catch([]),
  refuses_pending: z.array(z.string()).catch([]),
  conflicts: z
    .array(
      z.object({
        field: z.string(),
        values: z.array(text).catch([]),
        detail: nullableText,
      }),
    )
    .catch([]),
  image_role: z.enum(["reference_image", "payment_screenshot", "other"]).nullish().catch(null),
  image_description: nullableText.catch(null),
  payment: z
    .object({
      amount: nullableText,
      reference: nullableText,
      payee: nullableText,
      date: nullableText,
    })
    .nullish()
    .catch(null),
});

export type ModelResult = z.infer<typeof modelResultSchema>;
export type FieldUpdate = ModelResult["field_updates"][number];

export function parseModelResult(json: unknown): ModelResult {
  return modelResultSchema.parse(json);
}

export type ChatLine = { id: string; direction: "in" | "out"; body: string | null; type: string };

/** The user-turn context for one message (section 5, "CONTEXT YOU RECEIVE"). */
export function buildExtractionPrompt(input: {
  businessName: string;
  profile: Profile;
  message: MessageCtx;
  orders: OrderDraft[];
  recentMessages: ChatLine[];
}): string {
  const { businessName, profile, message, orders, recentMessages } = input;
  const context = {
    business_name: businessName,
    message_timestamp: describeTimestamp(message.sentAt),
    sender: message.direction === "in" ? "customer" : "business",
    profile_fields: profile.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      ...(f.options ? { options: f.options } : {}),
    })),
    open_orders: orders.map((d) => ({
      id: d.order.id,
      fields: Object.fromEntries(Object.entries(d.order.fields).map(([k, v]) => [k, v.value])),
    })),
    open_pending_requests: orders.flatMap((d) =>
      openPending(d).map((p) => ({
        id: p.id,
        order_id: p.order_id,
        field: p.field,
        requested_value: p.requested_value,
      })),
    ),
    last_messages: recentMessages.map((m) => ({
      id: m.id,
      sender: m.direction === "in" ? "customer" : "business",
      text: m.type === "image" ? `[image]${m.body ? ` ${m.body}` : ""}` : m.body,
    })),
    new_message: {
      id: message.id,
      type: message.type === "image" ? "image" : "text",
      text: message.body,
    },
  };
  return `Here is the context and the new message, as JSON:\n${JSON.stringify(context, null, 2)}`;
}
