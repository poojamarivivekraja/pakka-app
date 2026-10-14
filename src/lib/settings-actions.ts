import "server-only";
import { PROFILES } from "@/config/profiles";
import { getSupabase } from "@/lib/supabase";

export class SettingsError extends Error {}

/** Switches the profile used for new orders. Jewellery and food aren't available yet. */
export async function setActiveProfile(id: string) {
  if (!Object.hasOwn(PROFILES, id)) throw new SettingsError("That business type isn't available yet.");
  const { error } = await getSupabase().from("settings").update({ active_profile: id }).eq("id", 1);
  if (error) throw new Error(error.message);
}
