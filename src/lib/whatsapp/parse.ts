// Turns a WhatsApp Cloud API webhook body into the few kinds of event Pakka understands.
// Pure: no network, no database. Formats follow Meta's "messages" webhook reference.

type Json = Record<string, unknown>;

export type WaEvent = { waId: string; name: string | null; waMessageId: string; sentAt: string } & (
  | { kind: "text"; body: string }
  | { kind: "image"; mediaId: string; mimeType: string | null; caption: string | null }
  | { kind: "edit"; targetWaMessageId: string; body: string }
  | { kind: "revoke"; targetWaMessageId: string }
  // Voice notes, stickers, locations, edits Meta couldn't deliver (error 131051), unavailable
  // messages (error 131060)... anything Pakka can't read. `detail` is for logs only.
  | { kind: "unsupported"; detail: string }
);

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Types that are not messages from the customer: nothing to record. */
const IGNORED_TYPES = new Set(["reaction", "system"]);

function isoFromUnix(seconds: unknown): string {
  const n = Number(seconds);
  return new Date((Number.isFinite(n) && n > 0 ? n : Date.now() / 1000) * 1000).toISOString();
}

/**
 * `expectedPhoneNumberId`: only messages sent to this business number are kept (when set).
 * Status updates (sent/delivered/read), reactions and anything malformed are skipped.
 */
export function parseWebhook(payload: unknown, expectedPhoneNumberId?: string): WaEvent[] {
  const events: WaEvent[] = [];
  for (const entry of arr(obj(payload)?.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const c = obj(change);
      const value = obj(c?.value);
      if (!value || (c?.field !== undefined && c.field !== "messages")) continue;
      const phoneId = str(obj(value.metadata)?.phone_number_id);
      if (expectedPhoneNumberId && phoneId !== expectedPhoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of arr(value.contacts)) {
        const k = obj(contact);
        const id = str(k?.wa_id);
        const name = str(obj(k?.profile)?.name);
        if (id && name) names.set(id, name);
      }

      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const waId = str(m?.from);
        const waMessageId = str(m?.id);
        const type = str(m?.type);
        if (!m || !waId || !waMessageId || !type || IGNORED_TYPES.has(type)) continue;
        const base = { waId, name: names.get(waId) ?? null, waMessageId, sentAt: isoFromUnix(m.timestamp) };

        // An error on the message (131051 unknown type, 131060 unavailable) means there is nothing to read.
        const errors = arr(m.errors).map(obj).filter((e): e is Json => !!e);
        if (errors.length > 0 || type === "unsupported") {
          const code = errors[0]?.code;
          const was = str(obj(m.unsupported)?.type);
          events.push({ ...base, kind: "unsupported", detail: `${code ? `error ${code}` : "unsupported"}${was ? `, original type ${was}` : ""}` });
          continue;
        }

        if (type === "text") {
          const body = str(obj(m.text)?.body);
          events.push(body ? { ...base, kind: "text", body } : { ...base, kind: "unsupported", detail: "empty text" });
        } else if (type === "image") {
          const image = obj(m.image);
          const mediaId = str(image?.id);
          events.push(
            mediaId
              ? { ...base, kind: "image", mediaId, mimeType: str(image?.mime_type), caption: str(image?.caption) }
              : { ...base, kind: "unsupported", detail: "image without a media id" },
          );
        } else if (type === "edit") {
          const edit = obj(m.edit);
          const target = str(edit?.original_message_id);
          const inner = obj(edit?.message);
          const body = str(obj(inner?.text)?.body) ?? str(obj(inner?.image)?.caption);
          events.push(
            target && body
              ? { ...base, kind: "edit", targetWaMessageId: target, body }
              : { ...base, kind: "unsupported", detail: "edit without readable new text" },
          );
        } else if (type === "revoke") {
          const target = str(obj(m.revoke)?.original_message_id);
          events.push(target ? { ...base, kind: "revoke", targetWaMessageId: target } : { ...base, kind: "unsupported", detail: "revoke without a target" });
        } else {
          events.push({ ...base, kind: "unsupported", detail: `type ${type}` });
        }
      }
    }
  }
  return events;
}
