import "./load-env";
// Database check for the profile switch and the notifications feed. Restores what it changes.
import { getSupabase } from "@/lib/supabase";
import { SettingsError, setActiveProfile } from "@/lib/settings-actions";
import { loadNotifications } from "@/lib/notifications-feed";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}
const db = getSupabase();
const active = async () => (await db.from("settings").select("active_profile").eq("id", 1).single()).data!.active_profile;

async function main() {
  const original = await active();
  try {
    await setActiveProfile("saree");
    check("settings: switching to sarees is saved", (await active()) === "saree");
    await setActiveProfile("bakery");
    check("settings: switching back is saved", (await active()) === "bakery");
    for (const bad of ["jewellery", "food", "nope", "__proto__"]) {
      let msg = "";
      try { await setActiveProfile(bad); } catch (e) { msg = e instanceof SettingsError ? e.message : `unexpected ${e}`; }
      check(`settings: "${bad}" is refused`, msg.includes("isn't available") && (await active()) === "bakery", msg);
    }
  } finally {
    await db.from("settings").update({ active_profile: original }).eq("id", 1);
  }
  check("settings: original profile restored", (await active()) === original);

  // Notifications feed
  const first = await loadNotifications(null);
  check("notifications: first call returns only the server clock", typeof first.now === "string" && first.toasts.length === 0);
  const cust = (await db.from("customers").insert({ wa_id: `test-notify-${Date.now()}`, name: "Notify Check" }).select("*").single()).data!;
  try {
    const order = (await db.from("orders").insert({ customer_id: cust.id, profile: "bakery", status: "needs_review", fields: {} }).select("id").single()).data!;
    const before = new Date(Date.now() - 1000).toISOString();
    await db.from("flags").insert({ order_id: order.id, customer_id: cust.id, type: "missing_field", detail: "x", data: { field: "price_agreed" } });
    const res = await loadNotifications(before);
    const mine = res.toasts.find((t: { href: string }) => t.href === `/orders/${order.id}`);
    check("notifications: a new flag becomes a toast with a link to the order", mine?.text === "Notify Check's order needs review", JSON.stringify(res.toasts));
    const after = await loadNotifications(new Date(Date.now() + 5000).toISOString());
    check("notifications: flags older than `since` are not repeated", !after.toasts.some((t: { href: string }) => t.href === `/orders/${order.id}`));
    const bad = await loadNotifications("garbage");
    check("notifications: a bad `since` is treated like no `since`", bad.toasts.length === 0);
  } finally {
    await db.from("customers").delete().eq("id", cust.id);
  }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("FAIL  check-settings crashed:", e instanceof Error ? e.message : e); process.exit(1); });
