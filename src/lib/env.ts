import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

// Read lazily so a missing optional-for-this-step variable only fails where it's used.
export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get geminiApiKey() {
    return required("GEMINI_API_KEY");
  },
  get llmProvider() {
    return required("LLM_PROVIDER");
  },
  get llmModel() {
    return required("LLM_MODEL");
  },
  get demoPasscode() {
    return required("DEMO_PASSCODE");
  },
  /** Optional ISO date (YYYY-MM-DD); see "Demo date" in the brief. */
  get demoToday() {
    return process.env.DEMO_TODAY || undefined;
  },
};
