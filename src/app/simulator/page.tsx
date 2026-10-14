import { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPasscode } from "@/lib/passcode";
import { SCENARIOS } from "@/lib/scenarios";
import { SimulatorClient } from "./SimulatorClient";

export default function SimulatorPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading…</p>}>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  if (!(await hasPasscode())) redirect("/passcode?next=/simulator");
  const scenarios = SCENARIOS.map((s) => ({ id: s.id, name: s.name, continues: s.continues ?? null }));
  return <SimulatorClient scenarios={scenarios} />;
}
