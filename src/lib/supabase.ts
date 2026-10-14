import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Server-only: uses the service role key, which must never reach the browser.
export function getSupabase() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}
