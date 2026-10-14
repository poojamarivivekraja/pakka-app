import "server-only";
import { env } from "./env";

/** The app's "today" as YYYY-MM-DD: DEMO_TODAY if set, otherwise the real date. */
export function getToday(): string {
  const demo = env.demoToday;
  if (demo) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(demo)) {
      throw new Error(`DEMO_TODAY must be YYYY-MM-DD, got "${demo}"`);
    }
    return demo;
  }
  return new Date().toISOString().slice(0, 10);
}
