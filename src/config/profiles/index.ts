import type { OrderFields } from "@/types/db";
import type { Profile, ProfileField } from "@/types/profile";
import bakery from "./bakery.json";
import saree from "./saree.json";

export const PROFILES: Record<string, Profile> = {
  bakery: bakery as Profile,
  saree: saree as Profile,
};

/** Shown in Settings but not selectable yet. */
export const COMING_SOON_PROFILES = [
  { id: "jewellery", name: "Jewellery" },
  { id: "food", name: "Food orders on WhatsApp" },
];

export function getProfile(id: string): Profile {
  const profile = PROFILES[id];
  if (!profile) throw new Error(`Unknown business profile: ${id}`);
  return profile;
}

/** Whether a field is required given the values already on the order. */
export function isRequired(field: ProfileField, fields: OrderFields): boolean {
  if (field.required) return true;
  const rule = field.required_when;
  if (!rule) return false;
  const current = fields[rule.field]?.value;
  return current !== undefined && rule.in.includes(current);
}

/** Required fields that have no value yet. */
export function missingRequiredFields(
  profile: Profile,
  fields: OrderFields,
): ProfileField[] {
  return profile.fields.filter(
    (f) => isRequired(f, fields) && !fields[f.key]?.value,
  );
}
