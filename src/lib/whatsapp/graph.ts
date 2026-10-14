import "server-only";
import { env } from "@/lib/env";
import { getSupabase } from "@/lib/supabase";

// Talking to Meta's Graph API for images, and to our private storage bucket.

const MAX_BYTES = 10 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const extensionFor = (mimeType: string): string | null => EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()] ?? null;

/** Fetches an image a customer sent: first the media's address, then the file itself (both need the token). */
export async function downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
  const headers = { Authorization: `Bearer ${env.whatsappToken}` };
  const info = await fetch(`https://graph.facebook.com/${env.whatsappGraphVersion}/${encodeURIComponent(mediaId)}`, {
    headers, signal: AbortSignal.timeout(15_000),
  });
  if (!info.ok) throw new Error(`Graph API media lookup failed (${info.status})`);
  const meta = (await info.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!meta.url || !meta.mime_type) throw new Error("Graph API returned no media address");
  if (!extensionFor(meta.mime_type)) throw new Error(`Unsupported media type ${meta.mime_type}`);
  if (meta.file_size && meta.file_size > MAX_BYTES) throw new Error("Image is too large");

  const file = await fetch(meta.url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!file.ok) throw new Error(`Media download failed (${file.status})`);
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length > MAX_BYTES) throw new Error("Image is too large");
  return { data, mimeType: meta.mime_type.split(";")[0].trim().toLowerCase() };
}

/** Saves bytes in the private `media` bucket. */
export async function uploadToMediaBucket(path: string, data: Buffer, mimeType: string): Promise<void> {
  const { error } = await getSupabase().storage.from("media").upload(path, data, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`Could not save the image: ${error.message}`);
}

/** A storage path that can't escape the bucket: "<waId>/<message id>.<ext>". */
export function mediaPathFor(waId: string, waMessageId: string, extension: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${clean(waId)}/${clean(waMessageId)}.${extension}`;
}
