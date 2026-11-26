// Helpers for editing a profile document in the form and the raw editor.
import { stringify, parse } from "yaml";
import type { ProfileDoc, Rig, Step } from "./api.ts";

export function emptyDoc(): ProfileDoc {
  return {
    schema: "openrms-rigs/profile/v1",
    title: "",
    summary: "",
    rig: { macro: "", hamlib_model: 0, mfg: "", name: "" },
    operation: "ft8",
    connection: "usb",
    hamlib: ">=4.6",
    steps: [],
    software: [],
    tags: [],
  };
}

/** Drops empty values so the document stays tidy (and optional fields stay optional). */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean).filter((x) => x !== undefined) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const c = clean(x);
      if (c === undefined || c === null || c === "" || (typeof c === "number" && Number.isNaN(c))) continue;
      if (k === "check_only" && c === false) continue;
      if (k === "safety" && c === "rx") continue;
      if (typeof c === "object" && !Array.isArray(c) && Object.keys(c as object).length === 0) continue;
      if (Array.isArray(c) && c.length === 0 && k !== "steps") continue;
      out[k] = c;
    }
    return out as T;
  }
  return v;
}

export const toYaml = (d: ProfileDoc) => stringify(clean(d), { lineWidth: 100 });
export const toJson = (d: ProfileDoc) => JSON.stringify(clean(d), null, 2);

/** Parses raw YAML or JSON into a document the form can edit (missing arrays filled in). */
export function fromText(text: string): ProfileDoc {
  const t = text.trimStart();
  const v = (t.startsWith("{") ? JSON.parse(text) : parse(text)) as Partial<ProfileDoc> | null;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("expected a profile document (a mapping)");
  const d = { ...emptyDoc(), ...v } as ProfileDoc;
  d.rig = { ...emptyDoc().rig, ...(v.rig ?? {}) };
  d.steps = Array.isArray(v.steps) ? v.steps : [];
  d.software = Array.isArray(v.software) ? v.software : [];
  d.tags = Array.isArray(v.tags) ? v.tags : [];
  return d;
}

export function uniqueId(doc: ProfileDoc, base: string): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "step";
  let id = slug, n = 2;
  while (doc.steps.some((s) => s.id === id)) id = `${slug}-${n++}`;
  return id;
}

/** A sensible starting value for a Hamlib level or parameter on this radio. */
export function defaultValue(rig: Rig, kind: "level" | "parm", name: string): number | string {
  const ctl = (kind === "level" ? rig.caps.levels.set : rig.caps.parms.set)[name] ?? (kind === "level" ? rig.caps.levels.get : rig.caps.parms.get)[name];
  if (ctl?.choices?.length) return ctl.choices[0]!;
  if (kind === "level" && name === "AGC") return Number(Object.keys(rig.caps.agc_levels).find((k) => k !== "0") ?? 0);
  if (ctl?.range) {
    const { min, max, step } = ctl.range;
    const mid = (min + max) / 2;
    return step > 0 ? Math.round(Math.round(mid / step) * step * 1e6) / 1e6 : mid;
  }
  return 0;
}

export function newLevelStep(doc: ProfileDoc, rig: Rig, kind: "level" | "parm", name: string): Step {
  const value = defaultValue(rig, kind, name);
  const unit = kind === "level" ? rig.caps.levels.set[name]?.unit ?? rig.caps.levels.get[name]?.unit : undefined;
  const settable = kind === "level" ? rig.profile.settable_levels.includes(name) : rig.profile.settable_parms.includes(name);
  return {
    id: uniqueId(doc, name), kind, name, value,
    ...(unit && /^[A-Za-z]+$/.test(unit) && unit !== "hamlib" ? { unit } : {}),
    ...(settable ? {} : { check_only: true }),
    ...(rig.profile.tx_levels.includes(name) ? { safety: "tx" as const } : {}),
  };
}

/** Suggested Hamlib mode per operation, when the radio has it. */
export function suggestMode(rig: Rig, op: string): string | undefined {
  const want: Record<string, string[]> = {
    ssb: ["USB", "LSB"], am: ["AM"], fm: ["FM"], cw: ["CW"], rtty: ["RTTY", "PKTUSB"],
    sstv: ["USB"], packet: ["PKTFM", "FM", "PKTUSB"], "winlink-packet": ["PKTFM", "FM"],
  };
  for (const m of want[op] ?? ["PKTUSB", "USB"]) if (rig.caps.modes.includes(m)) return m;
  return undefined;
}

/** Input step for a level: Hamlib's fractions use 1/255 steps; people think in hundredths. */
export const inputStep = (r: { min: number; max: number; step: number }) => (r.max <= 1 && r.min >= 0 ? 0.01 : r.step || "any");
