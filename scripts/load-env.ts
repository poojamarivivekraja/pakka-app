// Load .env.local the same way Next.js does, so scripts see the same values as the app.
// Import this first in every script.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
