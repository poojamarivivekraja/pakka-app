import "./load-env";
// Shared by run-scenario.ts (and later the eval script): load a scenario's data, evaluate its
// expected checks, print a readable summary.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Profile } from "@/types/profile";
import { missingRequiredFields } from "@/config/profiles";
import { loadSnapshot, type OrderSnap, type Snapshot } from "@/lib/snapshot";
import { computeBalance } from "@/lib/pipeline/rules-order";
import { formatRupees, normaliseText, parseMoney } from "@/lib/pipeline/helpers";

import type { Check, Scenario, ScenarioMessage } from "@/lib/scenarios";
export type { Check, Scenario, ScenarioMessage };

export async function loadScenario(id: string): Promise<Scenario> {
  const file = path.join(process.cwd(), "src", "data", "scenarios", `${id}.json`);
  return JSON.parse(await readFile(file, "utf8")) as Scenario;
}

/** A fingerprint of everything an order's checks look at; used by the no_changes check. */
export function signature(s: Snapshot): string {
  return JSON.stringify([
    s.orders.map((o) => [
      Object.fromEntries(Object.entries(o.order.fields).map(([k, v]) => [k, [v.value, v.confidence]])),
      o.order.status, o.flags.length, o.notes.length, o.pending.length, o.events.length, o.attachments.length,
    ]),
    s.customerFlags.length,
  ]);
}

export { loadSnapshot };
export type { Snapshot };

export type CheckContext = {
  profile: Profile;
  snap: Snapshot;
  /** messageTypes[i] is the model's message_type for message i + 1. */
  messageTypes: (string | null)[];
  sigBefore: string[];
  sigAfter: string[];
  messageNumber: number;
};

const norm = normaliseText;

function normaliseTime(value: string): string | null {
  const m = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ?? "00";
  if (m[3] === "pm" && hour < 12) hour += 12;
  if (m[3] === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function pickOrder(snap: Snapshot, selector: Check["order"]): OrderSnap | undefined {
  if (selector === undefined) return snap.orders[0];
  if (typeof selector === "number") return snap.orders[selector];
  const [[key, value]] = Object.entries(selector);
  return snap.orders.find((o) => norm(o.order.fields[key]?.value ?? "") === norm(value));
}

type Verdict = { ok: boolean; detail: string };
const verdict = (ok: boolean, actual: unknown): Verdict => ({ ok, detail: ok ? "" : `got ${JSON.stringify(actual)}` });

export function evaluateCheck(c: Check, ctx: CheckContext): Verdict {
  const { snap, profile } = ctx;
  if (c.type === "order_count") return verdict(snap.orders.length === c.equals, snap.orders.length);
  if (c.type === "message_type") return verdict(ctx.messageTypes[(c.message as number) - 1] === c.equals, ctx.messageTypes[(c.message as number) - 1]);
  if (c.type === "no_changes") {
    const n = ctx.messageNumber - 1;
    return verdict(ctx.sigBefore[n] === ctx.sigAfter[n], "something changed");
  }

  const o = pickOrder(snap, c.order);
  if (!o) return { ok: false, detail: `no order matches ${JSON.stringify(c.order ?? 0)}` };
  const open = o.flags.filter((f) => !f.resolved);

  switch (c.type) {
    case "field": {
      const f = o.order.fields[c.field as string];
      const v = f?.value;
      if (c.absent) return verdict(!v, v);
      if (v === undefined) return { ok: false, detail: "field is empty" };
      if (c.equals !== undefined) return verdict(norm(v) === norm(String(c.equals)), v);
      if (c.exact !== undefined) return verdict(v === c.exact, v);
      if (c.contains !== undefined) return verdict(norm(v).includes(norm(String(c.contains))), v);
      if (c.money !== undefined) return verdict(parseMoney(v) === c.money, v);
      if (c.time !== undefined) return verdict(normaliseTime(v) === c.time, v);
      if (c.previous_contains !== undefined) return verdict(norm(f.previous_value ?? "").includes(norm(String(c.previous_contains))), f.previous_value);
      return { ok: false, detail: "check has no condition" };
    }
    case "any_field": {
      const values = (c.fields as string[]).map((k) => o.order.fields[k]?.value ?? "");
      return verdict(values.some((v) => norm(v).includes(norm(String(c.contains)))), values);
    }
    case "required_fields_filled": {
      const missing = missingRequiredFields(profile, o.order.fields).map((f) => f.key);
      return verdict(missing.length === 0, missing);
    }
    case "status": return verdict(o.order.status === c.equals, o.order.status);
    case "no_open_flags": return verdict(open.length === 0, open.map((f) => `${f.type}: ${f.detail}`));
    case "flag_exists": {
      const hits = open.filter((f) => f.type === c.flag_type && (c.field === undefined || f.data?.field === c.field));
      return verdict(hits.length > 0, open.map((f) => `${f.type}${f.data?.field ? `(${f.data.field})` : ""}`));
    }
    case "flag_absent": {
      const bad = open.filter((f) => (c.flag_types as string[]).includes(f.type));
      return verdict(bad.length === 0, bad.map((f) => `${f.type}: ${f.detail}`));
    }
    case "pending": {
      const hits = o.pending.filter((p) => {
        const state = p.resolved ?? "open";
        return p.field === c.field && norm(p.requested_value).includes(norm(String(c.requested_contains ?? ""))) && state === c.state;
      });
      return verdict(hits.length > 0, o.pending.map((p) => `${p.field}=${p.requested_value} (${p.resolved ?? "open"})`));
    }
    case "note": {
      const hits = o.notes.filter((n) => norm(n.text).includes(norm(String(c.contains))));
      return verdict(hits.length > 0, o.notes.map((n) => n.text));
    }
    case "attachment": {
      const hits = o.attachments.filter((a) =>
        a.kind === c.kind &&
        (c.amount === undefined || a.extracted?.amount === c.amount) &&
        (c.marked_received === undefined || a.marked_received === c.marked_received));
      const okCount = c.count === undefined ? hits.length > 0 : hits.length === c.count;
      return verdict(okCount, o.attachments.map((a) => `${a.kind} ${JSON.stringify(a.extracted?.amount ?? null)} received=${a.marked_received}`));
    }
    case "balance": {
      const b = computeBalance(o.order.fields, o.attachments);
      return verdict(b === c.equals, b);
    }
  }
  return { ok: false, detail: `unknown check type "${c.type}"` };
}

// ---------- readable summary ----------

export function formatSummary(snap: Snapshot, profile: Profile): string {
  const out: string[] = [];
  snap.orders.forEach((o, i) => {
    out.push(`ORDER ${i + 1}  [${o.order.status}]${o.order.updated_after_confirmation ? "  (updated after confirmation)" : ""}`);
    for (const f of profile.fields) {
      const v = o.order.fields[f.key];
      if (!v) continue;
      const extras = [v.confidence === "low" ? "low confidence" : "", v.previous_value ? `was ${v.previous_value}` : ""].filter(Boolean);
      out.push(`  ${f.label.padEnd(20)} ${v.value}${extras.length ? `   (${extras.join(", ")})` : ""}`);
    }
    const open = o.flags.filter((f) => !f.resolved);
    out.push(`  Flags (${open.length} open):`);
    for (const f of open) out.push(`    - ${f.type}: ${f.detail}`);
    if (o.notes.length) out.push("  Update notes:");
    for (const n of o.notes) out.push(`    - ${n.text}`);
    if (o.pending.length) out.push("  Pending requests:");
    for (const p of o.pending) out.push(`    - ${p.field}: ${p.requested_value}  [${p.resolved ?? "open"}]`);
    const pay = o.attachments.filter((a) => a.kind === "payment_screenshot");
    const refs = o.attachments.filter((a) => a.kind === "reference_image");
    for (const r of refs) out.push(`  Reference image: ${r.description ?? "(no description)"}`);
    for (const p of pay) {
      const amt = parseMoney(p.extracted?.amount as number | null);
      out.push(`  Payment screenshot: ${amt === null ? "amount unreadable" : formatRupees(amt)}, ref ${p.extracted?.reference ?? "-"}, payee ${p.extracted?.payee ?? "-"}  ${p.marked_received ? "[marked received]" : "[not verified]"}`);
    }
    const bal = computeBalance(o.order.fields, o.attachments);
    out.push(`  Balance (calculated by the app): ${bal === null ? "n/a (no price yet)" : formatRupees(bal)}`);
    out.push("");
  });
  if (snap.customerFlags.length) {
    out.push("FLAGS NOT TIED TO AN ORDER");
    for (const f of snap.customerFlags.filter((f) => !f.resolved)) out.push(`  - ${f.type}: ${f.detail}`);
    out.push("");
  }
  if (snap.orders.length === 0) out.push("(no orders)", "");
  return out.join("\n");
}
