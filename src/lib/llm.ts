import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { env } from "./env";
import { getSupabase } from "./supabase";

// The only module that calls a model. Provider and model come from
// LLM_PROVIDER and LLM_MODEL so they can be switched by config.

export type LlmImage = { mimeType: string; data: Buffer };

export type LlmRequest = {
  system: string;
  prompt: string;
  image?: LlmImage;
  /** Links the logged call to a message, when there is one. */
  messageId?: string;
};

export type LlmResult = {
  json: unknown;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Duration of the final attempt, excluding retry waits. */
  latencyMs: number;
};

export class LlmError extends Error {}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2000;

// 429 = rate limited; 503 = model overloaded ("high demand"). Both are temporary.
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 503;
}

/** Retries `fn` on 429/503 with exponential backoff and jitter. Other errors fail immediately. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || attempt >= MAX_ATTEMPTS) throw err;
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 500);
    }
  }
}

function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new LlmError(`Model did not return valid JSON: ${text.slice(0, 200)}`);
  }
}

// off -> the lowest level the model allows (MINIMAL, falling back to LOW for models
// that reject it), low -> LOW, default -> leave it to the model.
let minimalRejected = false;

function thinkingConfig(level: "off" | "low" | "default") {
  if (level === "off" && !minimalRejected) return { thinkingLevel: ThinkingLevel.MINIMAL };
  if (level === "off" || level === "low") return { thinkingLevel: ThinkingLevel.LOW };
  return undefined;
}

function isThinkingLevelRejected(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  return e?.status === 400 && /thinking level/i.test(e.message ?? "");
}

async function callGemini(req: LlmRequest, model: string) {
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
    { text: req.prompt },
  ];
  if (req.image) {
    parts.push({
      inlineData: {
        mimeType: req.image.mimeType,
        data: req.image.data.toString("base64"),
      },
    });
  }
  const generate = () =>
    ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: req.system,
        responseMimeType: "application/json",
        temperature: 0,
        thinkingConfig: thinkingConfig(env.llmThinking),
      },
    });
  let response;
  try {
    response = await generate();
  } catch (err) {
    if (env.llmThinking !== "off" || minimalRejected || !isThinkingLevelRejected(err)) throw err;
    minimalRejected = true;
    response = await generate();
  }
  const usage = response.usageMetadata;
  return {
    text: response.text ?? "",
    inputTokens: usage?.promptTokenCount ?? 0,
    // Thinking tokens are billed as output.
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
  };
}

async function logCall(row: {
  messageId?: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  ok: boolean;
  error: string | null;
}) {
  const { error } = await getSupabase().from("llm_calls").insert({
    message_id: row.messageId ?? null,
    provider: row.provider,
    model: row.model,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    latency_ms: row.latencyMs,
    ok: row.ok,
    error: row.error,
  });
  // Logging must never break the pipeline.
  if (error) console.error("Failed to log llm call:", error.message);
}

export async function callLlm(req: LlmRequest): Promise<LlmResult> {
  const provider = env.llmProvider;
  const model = env.llmModel;
  if (provider !== "gemini") {
    throw new LlmError(`Unsupported LLM_PROVIDER "${provider}" (only "gemini" is implemented)`);
  }

  let started = 0;
  try {
    const out = await withRetry(() => {
      started = Date.now();
      return callGemini(req, model);
    });
    const latencyMs = Date.now() - started;
    let json: unknown;
    try {
      json = parseJson(out.text);
    } catch (err) {
      await logCall({
        messageId: req.messageId, provider, model,
        inputTokens: out.inputTokens, outputTokens: out.outputTokens,
        latencyMs, ok: false, error: (err as Error).message,
      });
      throw err;
    }
    await logCall({
      messageId: req.messageId, provider, model,
      inputTokens: out.inputTokens, outputTokens: out.outputTokens,
      latencyMs, ok: true, error: null,
    });
    return { json, provider, model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, latencyMs };
  } catch (err) {
    if (err instanceof LlmError) throw err; // already logged
    await logCall({
      messageId: req.messageId, provider, model,
      inputTokens: null, outputTokens: null,
      latencyMs: started ? Date.now() - started : 0,
      ok: false, error: (err as Error).message,
    });
    throw err;
  }
}
