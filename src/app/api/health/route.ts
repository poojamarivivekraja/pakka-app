import { connection } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getToday } from "@/lib/demo-date";

// Setup check: confirms env + Supabase connectivity. Returns no secrets.
export async function GET() {
  await connection();
  const { data, error } = await getSupabase()
    .from("settings")
    .select("active_profile, business_name")
    .eq("id", 1)
    .single();
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true, settings: data, today: getToday() });
}
