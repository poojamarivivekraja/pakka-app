import { getSimState } from "@/lib/simulator";
import { simulatorRoute } from "@/lib/simulator-route";

export async function GET(request: Request) {
  const scenario = new URL(request.url).searchParams.get("scenario") ?? "";
  return simulatorRoute(() => getSimState(scenario));
}
