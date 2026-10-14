import { sendCustomMessage, sendNextScripted, SimError } from "@/lib/simulator";
import { simulatorRoute } from "@/lib/simulator-route";

// AI route: runs a message through processMessage(), which calls the model. Passcode required.
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { scenario?: string; custom?: { sender?: string; text?: string } }
    | null;
  return simulatorRoute(() => {
    if (!body?.scenario) throw new SimError(400, "Missing scenario");
    if (body.custom) {
      const { sender, text } = body.custom;
      if (sender !== "customer" && sender !== "business") throw new SimError(400, "Sender must be customer or business");
      return sendCustomMessage(body.scenario, sender, String(text ?? ""));
    }
    return sendNextScripted(body.scenario);
  });
}
