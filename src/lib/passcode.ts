import "server-only";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// DEMO_PASSCODE gate. After a correct entry a cookie holds a hash derived from the
// passcode (never the passcode itself). Every page and route that reaches the AI checks it.

export const PASSCODE_COOKIE = "pakka_passcode";
export const PASSCODE_MAX_AGE = 60 * 60 * 24 * 7;

const sha256 = (s: string) => createHash("sha256").update(s).digest();

function equal(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export const passcodeToken = () => sha256(`pakka-demo:${env.demoPasscode}`).toString("hex");

export function passcodeIsCorrect(input: string): boolean {
  return equal(input, env.demoPasscode);
}

export async function hasPasscode(): Promise<boolean> {
  const value = (await cookies()).get(PASSCODE_COOKIE)?.value;
  return !!value && equal(value, passcodeToken());
}

/** For route handlers: returns a 401 response when the cookie is missing or wrong, otherwise null. */
export async function refuseWithoutPasscode(): Promise<Response | null> {
  if (await hasPasscode()) return null;
  return Response.json({ error: "Passcode required" }, { status: 401 });
}

/** Only same-site paths are allowed as a post-login destination. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/simulator";
}
