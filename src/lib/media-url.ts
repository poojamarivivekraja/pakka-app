import "server-only";
import { getSupabase } from "@/lib/supabase";

/** An address the browser can show: sample images from /public, private storage via a short-lived signed URL. */
export async function mediaUrl(mediaPath: string): Promise<string | null> {
  if (mediaPath.startsWith("samples/")) return `/${mediaPath}`;
  const { data } = await getSupabase().storage.from("media").createSignedUrl(mediaPath, 3600);
  return data?.signedUrl ?? null;
}
