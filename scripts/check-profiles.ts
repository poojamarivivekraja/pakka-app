import { PROFILES, getProfile, missingRequiredFields } from "@/config/profiles";
import type { OrderFields } from "@/types/db";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

const val = (value: string) => ({
  value,
  source_message_id: null,
  confidence: "high" as const,
  updated_at: "",
  previous_value: null,
  edited_by_owner: false,
});

const universal = [
  "occasion", "items_summary", "due_date", "due_time", "fulfilment",
  "address", "tracking_number", "price_agreed", "advance_requested",
];
const types = ["text", "exact_text", "measurement", "money", "date", "time", "enum", "items"];

for (const [id, p] of Object.entries(PROFILES)) {
  const keys = p.fields.map((f) => f.key);
  check(`${id}: has all universal fields`, universal.every((k) => keys.includes(k)));
  check(`${id}: keys are unique`, new Set(keys).size === keys.length);
  check(`${id}: all types valid`, p.fields.every((f) => types.includes(f.type)));
  check(`${id}: enum fields have options`, p.fields.every((f) => f.type !== "enum" || f.options?.length));
  const adv = p.fields.find((f) => f.key === "advance_requested");
  check(`${id}: advance_requested is optional money`, adv?.type === "money" && adv.required === false);
}

const bakery = getProfile("bakery");
const names = (f: OrderFields) => missingRequiredFields(bakery, f).map((x) => x.key);
check("bakery: empty order misses 7 required fields",
  names({}).join() === "items_summary,due_date,due_time,fulfilment,price_agreed,size_or_weight,flavour");
check("bakery: pickup does not require address", !names({ fulfilment: val("pickup") }).includes("address"));
check("bakery: delivery requires address", names({ fulfilment: val("delivery") }).includes("address"));
check("bakery: courier requires address", names({ fulfilment: val("courier") }).includes("address"));
check("bakery: personalisation label", bakery.fields.find((f) => f.key === "personalisation")?.label === "Message on cake");
check("saree: personalisation label", getProfile("saree").fields.find((f) => f.key === "personalisation")?.label === "Embroidery");
check("saree: quantity required", getProfile("saree").fields.find((f) => f.key === "quantity")?.required === true);

process.exit(failed ? 1 : 0);
