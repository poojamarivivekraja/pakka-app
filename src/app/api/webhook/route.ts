import { after } from "next/server";
import { answerVerification, receiveWebhook } from "@/lib/whatsapp/webhook";

// Live WhatsApp webhook. This route reaches the model, but Meta can't send the demo passcode,
// so it is gated by Meta's signature on every POST (and the verify token on GET) instead.
export const maxDuration = 60;

export async function GET(request: Request) {
  return answerVerification(new URL(request.url).searchParams);
}

export async function POST(request: Request) {
  const raw = await request.text(); // the exact bytes Meta signed
  const result = await receiveWebhook(raw, request.headers.get("x-hub-signature-256"));
  // Answer Meta straight away (it retries if we're slow), then process in the background.
  if (result.work) after(result.work);
  return Response.json(result.body, { status: result.status });
}
