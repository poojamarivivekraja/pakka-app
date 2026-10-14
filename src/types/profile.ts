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
  fields: ProfileField[];
};
