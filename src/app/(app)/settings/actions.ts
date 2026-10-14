"use server";

import { refresh } from "next/cache";
import { SettingsError, setActiveProfile } from "@/lib/settings-actions";

export async function chooseProfile(id: string): Promise<{ error?: string }> {
  try {
    await setActiveProfile(String(id).slice(0, 40));
  } catch (err) {
    if (err instanceof SettingsError) return { error: err.message };
    console.error("profile switch failed:", err);
    return { error: "Something went wrong. Try again." };
  }
  refresh();
  return {};
}
