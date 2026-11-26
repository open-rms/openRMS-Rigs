// Turns a validated profile into structured steps a client runs through its own command path
// (rigctlWeb and hamstack never pipe text to rigctld). The rigctld line is a convenience field.
import { findRig } from "./catalog.js";
import type { Profile, Scalar, Step } from "./profile.js";
import { unitOf } from "./units.js";
import { meets } from "./validate.js";
import { catSafety, sampleOf, TX_FUNCS, TX_LEVELS } from "./safety.js";

/** The server's raise rule (profile.md "Safety"): the document's safety, or tx when the name is known to change transmit behaviour. */
export function raisedSafety(s: Step): "rx" | "tx" {
  if (s.safety === "tx") return "tx";
  if (s.kind === "level" && TX_LEVELS.has(s.name)) return "tx";
  if (s.kind === "func" && TX_FUNCS.has(s.name)) return "tx";
  if (s.kind === "cat" && !s.check_only && s.cat?.set && catSafety(s.cat.protocol, sampleOf(s.cat.set)) === "tx") return "tx";
  return "rx";
}

const menuOf = (s: Step): string[] | undefined =>
  s.menu ?? (s.manual?.menu ? s.manual.menu.split(">").map((x) => x.trim()).filter(Boolean) : undefined);

export type PlanStep = {
  id: string;
  kind: Step["kind"];
  name: string;
  value?: Scalar;
  passband_hz?: number;
  expect?: Step["expect"];
  unit?: string;
  display?: string;
  safety: "rx" | "tx";
  /** Verify only; never set. */
  check_only: boolean;
  /** The client can read the current value back (needed for checks and automatic restore). */
  readable: boolean;
  /** rigctld protocol lines. null when the client must build the command (CI-V framing, manual). */
  rigctld: { get: string | null; set: string | null };
  cat?: Step["cat"] & { set_command?: string };
  manual?: Step["manual"];
  /** level steps: the Hamlib step a check allows either side of value (0 = exact). From the catalog, so offline clients match /check. */
  tolerance?: number;
  /** Menu path on the radio, outermost first (from `menu`, or split from manual.menu): the manual fallback. */
  menu?: string[];
  hamlib?: string;
  firmware?: string;
  /** One line a person can read. */
  text: string;
  note?: string;
};

export type Plan = {
  profile_id?: string;
  revision?: number;
  rig: Profile["rig"];
  operation: string;
  hamlib: string;
  audio?: Profile["audio"];
  steps: PlanStep[];
};

const num = (v: Scalar | undefined) => (typeof v === "boolean" ? (v ? 1 : 0) : v);

/** "USB or LSB", "≥ 30, ≤ 70", "not 0": what a check accepts, in words. */
export function expectText(e: Step["expect"]): string {
  if (!e) return "";
  const parts = [
    e.one_of?.length ? e.one_of.join(" or ") : "",
    e.min !== undefined ? `≥ ${e.min}` : "",
    e.max !== undefined ? `≤ ${e.max}` : "",
    e.not?.length ? `not ${e.not.join("/")}` : "",
  ].filter(Boolean);
  return parts.join(", ");
}
const checkText = (s: Step) => `check${expectText(s.expect) ? `: ${expectText(s.expect)}` : ""}`;

/** Fills a cat.set template: {value} or {value:03} (zero-padded to width 3). */
export function fillCat(template: string, value: Scalar): string {
  return template.replace(/\{value(?::(\d+))?\}/g, (_, w: string | undefined) => {
    const s = String(num(value));
    return w ? s.padStart(Number(w), "0") : s;
  });
}

export function buildPlan(p: Profile, meta: { id?: string; revision?: number } = {}): Plan {
  const rig = findRig(p.rig.macro);
  const steps = p.steps.map((s): PlanStep => {
    const check_only = !!s.check_only;
    const base = {
      id: s.id, kind: s.kind, name: s.name, value: s.value, expect: s.expect, display: s.display,
      safety: raisedSafety(s), check_only, menu: menuOf(s), hamlib: s.hamlib, firmware: s.firmware, note: s.note,
    } as const;
    const set = (line: string) => (check_only || s.value === undefined ? null : line);
    switch (s.kind) {
      case "mode":
        return {
          ...base, passband_hz: s.passband_hz ?? 0, readable: true,
          rigctld: { get: "m", set: set(`M ${s.value} ${s.passband_hz ?? 0}`) },
          text: check_only || s.value === undefined ? `Mode ${checkText(s)}` : `Mode ${s.value}${s.passband_hz ? `, ${s.passband_hz} Hz passband` : ""}`,
        };
      case "level":
      case "parm": {
        const L = s.kind === "level" ? "L" : "P";
        const readable = !rig?.capsAvailable || !!(s.kind === "level" ? rig.levels.get : rig.parms.get)[s.name];
        return {
          ...base, unit: s.unit ?? (s.kind === "level" ? unitOf(s.name) : undefined), readable,
        ...(s.kind === "level" ? { tolerance: rig?.levels.get[s.name]?.range?.step ?? 0 } : {}),
          rigctld: { get: readable ? `${L.toLowerCase()} ${s.name}` : null, set: set(`${L} ${s.name} ${num(s.value)}`) },
          text: `${s.name} ${check_only ? checkText(s) : `→ ${s.display ?? s.value}`}`,
        };
      }
      case "func": {
        const readable = !rig?.capsAvailable || rig.funcs.get.includes(s.name);
        return {
          ...base, readable,
          rigctld: { get: readable ? `u ${s.name}` : null, set: set(`U ${s.name} ${num(s.value)}`) },
          text: `${s.name} ${check_only ? checkText(s) : s.value ? "on" : "off"}`,
        };
      }
      case "cat": {
        const c = s.cat!;
        const setCmd = !check_only && c.set && s.value !== undefined ? fillCat(c.set, s.value) : undefined;
        const ascii = c.protocol === "ascii";
        return {
          ...base, readable: !!c.read, cat: { ...c, set_command: setCmd },
          rigctld: { get: ascii && c.read ? `w ${c.read}` : null, set: ascii && setCmd ? `w ${setCmd}` : null },
          text: `${s.name} ${check_only ? checkText(s) : `→ ${c.values?.[String(s.value)] ?? s.value}`} (raw CAT)`,
        };
      }
      case "manual":
        return {
          ...base, readable: false, manual: s.manual, rigctld: { get: null, set: null },
          text: `On the radio: ${s.manual!.menu} = ${s.manual!.value}`,
        };
    }
  });
  // Defence in depth: whatever got stored, never hand a client more than one command per line.
  const LINE = /^[\x21-\x7e]+( [\x21-\x7e]+)*$/;
  for (const s of steps) {
    for (const line of [s.rigctld.get, s.rigctld.set, s.cat?.set_command]) {
      if (line != null && !LINE.test(line)) throw new Error(`step ${s.id}: refusing a malformed command`);
    }
  }
  return { profile_id: meta.id, revision: meta.revision, rig: p.rig, operation: p.operation, hamlib: p.hamlib, audio: p.audio, steps };
}

export type CheckStatus = "ok" | "drift" | "unknown" | "manual";
export type CheckStep = { id: string; status: CheckStatus; current?: Scalar; target?: Scalar; noop: boolean; text: string };

/**
 * Dry run: compares values the client read from the radio (keyed by step id) with the plan.
 * `noop` means applying this step would change nothing.
 */
export function checkPlan(plan: Plan, current: Record<string, Scalar | null | undefined>): { steps: CheckStep[]; summary: Record<CheckStatus, number> } {
  const rig = findRig(plan.rig.macro);
  const summary: Record<CheckStatus, number> = { ok: 0, drift: 0, unknown: 0, manual: 0 };
  const steps = plan.steps.map((s): CheckStep => {
    let status: CheckStatus;
    const cur = current[s.id];
    if (s.kind === "manual") status = "manual";
    else if (cur === undefined || cur === null) status = "unknown";
    else {
      const step = s.kind === "level" ? s.tolerance ?? 0 : 0;
      status = meets(s as unknown as Step, cur, step) ? "ok" : "drift";
    }
    summary[status]++;
    return { id: s.id, status, current: cur ?? undefined, target: s.value, noop: status === "ok", text: s.text };
  });
  return { steps, summary };
}
