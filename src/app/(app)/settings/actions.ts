"use server";

import { refresh } from "next/cache";
import { refuseActionWithoutPasscode } from "@/lib/passcode";
import { SettingsError, setActiveProfile } from "@/lib/settings-actions";

export type SettingsResult = { error?: string; status?: number };

export async function chooseProfile(id: string): Promise<SettingsResult> {
  const refused = await refuseActionWithoutPasscode();
  if (refused) return refused;
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

/** The "disconnect and delete" confirmation. A prototype: nothing is deleted, but it is still owner-only. */
export async function confirmDisconnect(): Promise<SettingsResult> {
  return (await refuseActionWithoutPasscode()) ?? {};
}
