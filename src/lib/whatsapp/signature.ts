import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta signs every webhook POST: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw body).
 * Check it against the exact bytes received, before trusting anything in the body.
 */
export function verifySignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** For tests and the local helper script: the header value Meta would send. */
export function signBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}
