import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSupabase } from "@/lib/supabase";
import type { LlmImage } from "@/lib/llm";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
};

/** "samples/x.png" is read from public/samples (simulator); anything else from the private `media` bucket. */
export async function loadImage(mediaPath: string): Promise<LlmImage> {
  const mimeType = MIME[path.extname(mediaPath).toLowerCase()];
  if (!mimeType) throw new Error(`Unsupported image type: ${mediaPath}`);
  if (mediaPath.startsWith("samples/")) {
    const file = path.join(process.cwd(), "public", mediaPath);
    if (!file.startsWith(path.join(process.cwd(), "public"))) throw new Error("Invalid media path");
    return { mimeType, data: await readFile(file) };
  }
  const { data, error } = await getSupabase().storage.from("media").download(mediaPath);
  if (error || !data) throw new Error(`Could not download ${mediaPath}: ${error?.message}`);
  return { mimeType, data: Buffer.from(await data.arrayBuffer()) };
}
