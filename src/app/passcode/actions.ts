"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  PASSCODE_COOKIE, PASSCODE_MAX_AGE, passcodeIsCorrect, passcodeToken, safeNext,
} from "@/lib/passcode";

export type PasscodeState = { error?: string } | undefined;

export async function submitPasscode(_prev: PasscodeState, formData: FormData): Promise<PasscodeState> {
  const input = String(formData.get("passcode") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));

  if (!passcodeIsCorrect(input)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return { error: "That passcode isn't right. Try again." };
  }

  (await cookies()).set(PASSCODE_COOKIE, passcodeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PASSCODE_MAX_AGE,
  });
  redirect(next);
}
