import { resetScenario, SimError } from "@/lib/simulator";
import { simulatorRoute } from "@/lib/simulator-route";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { scenario?: string } | null;
  return simulatorRoute(() => {
    if (!body?.scenario) throw new SimError(400, "Missing scenario");
    return resetScenario(body.scenario);
  });
}
