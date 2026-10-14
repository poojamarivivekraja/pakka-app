export type FieldType =
  | "text"
  | "exact_text"
  | "measurement"
  | "money"
  | "date"
  | "time"
  | "enum"
  | "items";

export type ProfileField = {
  key: string;
  label: string;
  /** Lower-case name for sentences, e.g. "Add the price and the address to confirm." */
  short_label: string;
  /** Short plain-language meaning of the field. Sent to the model with every message. */
  description: string;
  type: FieldType;
  required: boolean;
  /** For enum fields: the allowed values. */
  options?: string[];
  /** Field is also required when another field has one of these values. */
  required_when?: { field: string; in: string[] };
};

export type Profile = {
  id: string;
  name: string;
  /** Completes "What Pakka tracks for ..." in Settings, e.g. "a home bakery". */
  tracks_for: string;
  fields: ProfileField[];
};
