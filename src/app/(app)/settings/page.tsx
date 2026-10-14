import { Suspense } from "react";
import { ConnectionCard } from "@/components/settings/ConnectionCard";
import { ProfileCards } from "@/components/settings/ProfileCards";
import { COMING_SOON_PROFILES, PROFILES, getProfile } from "@/config/profiles";
import { getSupabase } from "@/lib/supabase";

export default function SettingsPage() {
  return (
    <>
      <header className="px-5 pt-5">
        <span className="text-[22px] font-bold text-primary">Pakka</span>
        <h1 className="mt-4 text-[28px] font-bold leading-tight text-ink">Your business</h1>
        <p className="mt-1 text-sm text-muted">Pakka reads your chats for the details that matter in your kind of business.</p>
      </header>
      <Suspense fallback={<p className="px-5 pt-6 text-sm text-muted">Loading…</p>}>
        <SettingsContent />
      </Suspense>
      <ConnectionCard />
    </>
  );
}

async function SettingsContent() {
  const { data, error } = await getSupabase().from("settings").select("active_profile").eq("id", 1).single();
  if (error) throw new Error(error.message);
  const active = Object.hasOwn(PROFILES, data.active_profile) ? data.active_profile : "bakery";
  const profile = getProfile(active);

  const options = [
    ...Object.values(PROFILES).map((p) => ({ id: p.id, name: p.name, available: true })),
    ...COMING_SOON_PROFILES.map((p) => ({ id: p.id, name: p.name, available: false })),
  ];

  return (
    <>
      <div className="mt-5 px-5">
        <ProfileCards options={options} activeId={active} />
        <p className="mt-3 text-xs text-muted">
          Orders from Swiggy, Zomato and other apps aren&apos;t covered. Pakka tracks orders you take directly on WhatsApp.
        </p>
      </div>

      <section className="mx-5 mt-4 rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink">What Pakka tracks for {profile.tracks_for}</h2>
        <ul>
          {profile.fields.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-3 border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0">
              <span className="text-[15px] text-ink">{f.label}</span>
              {f.required ? (
                <span className="rounded-full bg-ready-bg px-2.5 py-1 text-[11px] font-semibold leading-none text-ready-fg">Required</span>
              ) : f.required_when ? (
                <span className="rounded-full bg-ready-bg px-2.5 py-1 text-[11px] font-semibold leading-none text-ready-fg">Required for {f.required_when.in.join(" or ")}</span>
              ) : (
                <span className="text-xs text-muted">Optional</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
