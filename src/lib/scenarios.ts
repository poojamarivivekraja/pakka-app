import s1 from "@/data/scenarios/s1.json";
import s2 from "@/data/scenarios/s2.json";
import s3 from "@/data/scenarios/s3.json";
import s4 from "@/data/scenarios/s4.json";
import s5 from "@/data/scenarios/s5.json";
import s6 from "@/data/scenarios/s6.json";
import s7 from "@/data/scenarios/s7.json";

export type ScenarioMessage = {
  timestamp: string;
  sender: "customer" | "business";
  text?: string;
  image?: string;
  event?: "edit" | "revoke";
  /** 1-based number of the message an edit or revoke refers to. */
  target?: number;
};

// One expected check. `after` = run it right after that (1-based) message; default: after the last.
export type Check = {
  label: string;
  type: string;
  after?: number;
  order?: number | Record<string, string>;
  [key: string]: unknown;
};

export type Scenario = {
  id: string;
  name: string;
  continues?: string;
  customer: { name: string; wa_id: string };
  messages: ScenarioMessage[];
  expected: Check[];
};

export const SCENARIOS = [s1, s2, s3, s4, s5, s6, s7] as unknown as Scenario[];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** One-line description of a scripted message, e.g. "C: Pickup at 5 pm is fine?". */
export function describeScriptedMessage(m: ScenarioMessage): string {
  const who = m.sender === "customer" ? "Customer" : "Business";
  if (m.event) return `${who}: [${m.event}${m.text ? `: ${m.text}` : ""}]`;
  if (m.image) return `${who}: [image: ${m.image.replace("samples/", "")}]`;
  return `${who}: ${m.text}`;
}
