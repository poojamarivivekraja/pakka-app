import "server-only";
import { refuseWithoutPasscode } from "@/lib/passcode";
import { SimError } from "@/lib/simulator";

/** Shared wrapper for the simulator's route handlers: passcode check, then JSON errors. */
export async function simulatorRoute(run: () => Promise<unknown>): Promise<Response> {
  const refused = await refuseWithoutPasscode();
  if (refused) return refused;
  try {
    return Response.json(await run());
  } catch (err) {
    if (err instanceof SimError) return Response.json({ error: err.message }, { status: err.status });
    console.error("simulator error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 });
  }
}
