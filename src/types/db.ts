// Row types mirroring docs/SCHEMA.sql.

export type OrderStatus =
  | "needs_review"
  | "ready"
  | "confirmed"
  | "delivered"
  | "cancelled";

export type FlagType =
  | "missing_field"
  | "conflict"
  | "low_confidence"
  | "which_order"
  | "payment_mismatch"
  | "message_deleted"
  | "message_unreadable";

export type Confidence = "high" | "low";

/** One entry in orders.fields, keyed by profile field key. */
export type FieldValue = {
  value: string;
  source_message_id: string | null;
  confidence: Confidence;
  updated_at: string;
  previous_value: string | null;
  edited_by_owner: boolean;
  /** The customer's or business's exact words that support the value (for the Source sheet). */
  quote?: string | null;
};

export type OrderFields = Record<string, FieldValue>;

export type Settings = {
  id: number;
  active_profile: string;
  business_name: string;
};

export type Customer = {
  id: string;
  wa_id: string;
  name: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  wa_message_id: string | null;
  customer_id: string;
  direction: "in" | "out";
  type: "text" | "image" | "edit" | "revoke" | "unsupported";
  body: string | null;
  media_path: string | null;
  sent_at: string;
  status: "received" | "processed" | "failed" | "edited" | "revoked";
  raw: unknown;
  created_at: string;
};

export type Order = {
  id: string;
  customer_id: string;
  profile: string;
  status: OrderStatus;
  fields: OrderFields;
  updated_after_confirmation: boolean;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

export type OrderEvent = {
  id: string;
  order_id: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: "chat" | "owner" | "system";
  note: string | null;
  source_message_id: string | null;
  created_at: string;
};

export type UpdateNote = {
  id: string;
  order_id: string;
  text: string;
  source_message_id: string | null;
  seen: boolean;
  created_at: string;
};

export type PendingRequest = {
  id: string;
  order_id: string;
  field: string;
  requested_value: string;
  source_message_id: string | null;
  resolved: "agreed" | "refused" | null;
  created_at: string;
};

export type Flag = {
  id: string;
  order_id: string | null;
  customer_id: string;
  message_id: string | null;
  type: FlagType;
  detail: string;
  data: Record<string, unknown> | null;
  resolved: boolean;
  created_at: string;
};

export type Attachment = {
  id: string;
  order_id: string | null;
  message_id: string;
  kind: "reference_image" | "payment_screenshot";
  description: string | null;
  extracted: Record<string, unknown> | null;
  marked_received: boolean;
  created_at: string;
};

export type LlmCall = {
  id: string;
  message_id: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  ok: boolean | null;
  error: string | null;
  created_at: string;
};
