// Validates a profile: JSON Schema first (the contract in openRMS-Spec), then the rules a schema
// can't express: names and ranges against the Hamlib catalog, and the no-keying safety rules.
import { readFileSync } from "node:fs";
import { paths } from "../paths.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { parse as parseYaml } from "yaml";
import { findRig } from "./catalog.js";
import type { Profile, Scalar, Step } from "./profile.js";
import { CAT_VALUE, catProblem, catSafety, catStepProblems, HAMLIB_NAME, isKeyingFunc, METER_LEVELS, MODE_NAME, sampleOf, SETTABLE_FUNCS, TX_FUNCS, TX_LEVELS } from "./safety.js";
import { fillCat } from "./plan.js";

export const schemaPath = paths.profileSchema;
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => void;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

export type Issue = { path: string; message: string };
export type Result = { ok: boolean; profile?: Profile; errors: Issue[]; warnings: Issue[] };

/** Parses JSON or YAML text. */
export function parseProfileText(text: string): unknown {
  const t = text.trimStart();
  return t.startsWith("{") ? JSON.parse(text) : parseYaml(text);
}

export function validateProfile(input: unknown): Result {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!validateSchema(input)) {
    for (const e of validateSchema.errors ?? []) errors.push({ path: e.instancePath || "/", message: e.message ?? "invalid" });
    return { ok: false, errors, warnings };
  }
  // Deep copy: we raise safety levels in place.
  const p = structuredClone(input) as Profile;

  const rig = findRig(p.rig.macro);
  if (!rig) {
    errors.push({ path: "/rig/macro", message: `${p.rig.macro} is not in the Hamlib catalog` });
  } else {
    if (rig.pseudo) errors.push({ path: "/rig/macro", message: `${p.rig.macro} is not a physical radio` });
    if (rig.model !== p.rig.hamlib_model) warnings.push({ path: "/rig/hamlib_model", message: `catalog has ${rig.model} for ${rig.macro}` });
    if (rig.name !== p.rig.name || rig.mfg !== p.rig.mfg) {
      warnings.push({ path: "/rig/name", message: `catalog names this radio "${rig.mfg} ${rig.name}"` });
    }
  }

  const sourceIds = new Set<string>();
  (p.sources ?? []).forEach((s, i) => {
    if (sourceIds.has(s.id)) errors.push({ path: `/sources/${i}/id`, message: `duplicate source id "${s.id}"` });
    sourceIds.add(s.id);
  });
  p.steps.forEach((s, i) => (s.sources ?? []).forEach((ref, j) => {
    if (!sourceIds.has(ref)) errors.push({ path: `/steps/${i}/sources/${j}`, message: `cites ${ref}, which isn't in sources` });
  }));
  const seen = new Set<string>();
  p.steps.forEach((s, i) => {
    const at = (f = "") => `/steps/${i}${f}`;
    if (seen.has(s.id)) errors.push({ path: at("/id"), message: `duplicate step id "${s.id}"` });
    seen.add(s.id);
    checkStep(s, at, errors, warnings, rig);
  });

  return { ok: errors.length === 0, profile: p, errors, warnings };
}

type Rig = NonNullable<ReturnType<typeof findRig>>;

function checkStep(s: Step, at: (f?: string) => string, errors: Issue[], warnings: Issue[], rig: Rig | undefined) {
  const raise = () => { s.safety = "tx"; };
  const caps = rig?.capsAvailable ? rig : undefined;
  const settable = !s.check_only;

  if ((s.kind === "level" || s.kind === "func" || s.kind === "parm") && !HAMLIB_NAME.test(s.name)) {
    errors.push({ path: at("/name"), message: "Hamlib names are upper-case letters, digits and _" });
    return;
  }
  switch (s.kind) {
    case "mode": {
      if (s.value !== undefined && (typeof s.value !== "string" || !MODE_NAME.test(s.value))) errors.push({ path: at("/value"), message: "mode value must be a Hamlib mode name" });
      if (caps && typeof s.value === "string" && !caps.modes.includes(s.value)) {
        errors.push({ path: at("/value"), message: `${rig!.name} has no mode ${s.value} (has ${caps.modes.join(" ")})` });
      }
      break;
    }
    case "func": {
      if (isKeyingFunc(s.name)) {
        errors.push({ path: at("/name"), message: `${s.name} can key the transmitter and is never allowed in a profile` });
        break;
      }
      if (settable && !SETTABLE_FUNCS.has(s.name)) errors.push({ path: at("/name"), message: `${s.name} is not on the settable function allow-list` });
      if (s.value !== undefined && typeof s.value !== "boolean") errors.push({ path: at("/value"), message: "func value must be true or false" });
      const list = caps ? (settable ? caps.funcs.set : caps.funcs.get) : undefined;
      if (list && !list.includes(s.name)) errors.push({ path: at("/name"), message: `Hamlib can't ${settable ? "set" : "read"} ${s.name} on ${rig!.name}` });
      if (TX_FUNCS.has(s.name)) raise();
      break;
    }
    case "level":
    case "parm": {
      if (s.kind === "level" && METER_LEVELS.test(s.name)) {
        errors.push({ path: at("/name"), message: `${s.name} is a meter, not a setting` });
        break;
      }
      const group = caps ? (s.kind === "level" ? caps.levels : caps.parms) : undefined;
      const ctl = group ? (settable ? group.set : group.get)[s.name] : undefined;
      if (group && !ctl) {
        errors.push({ path: at("/name"), message: `Hamlib can't ${settable ? "set" : "read"} ${s.kind} ${s.name} on ${rig!.name}` });
      }
      // Values go into rigctld lines: numbers only, or one of the catalog's named choices.
      if (s.value !== undefined && typeof s.value !== "number") {
        const okChoice = typeof s.value === "string" && HAMLIB_NAME.test(s.value) && (!ctl || ctl.choices?.includes(s.value));
        if (!okChoice) { errors.push({ path: at("/value"), message: `${s.name} needs a number${ctl?.choices ? ` or one of ${ctl.choices.join(", ")}` : ""}` }); break; }
      }
      if (ctl?.range && typeof s.value === "number") {
        const { min, max } = ctl.range;
        if (s.value < min || s.value > max) errors.push({ path: at("/value"), message: `${s.name} must be ${min}..${max} on ${rig!.name}` });
      }
      if (ctl?.choices && s.value !== undefined && !ctl.choices.includes(String(s.value))) {
        errors.push({ path: at("/value"), message: `${s.name} must be one of ${ctl.choices.join(", ")}` });
      }
      if (s.kind === "level" && TX_LEVELS.has(s.name)) raise();
      break;
    }
    case "cat": {
      const c = s.cat!;
      if (s.value !== undefined && !(typeof s.value === "number" && Number.isInteger(s.value) && s.value >= 0) && !(typeof s.value === "string" && CAT_VALUE.test(s.value))) {
        errors.push({ path: at("/value"), message: "a CAT value is a non-negative integer or up to 16 letters and digits" });
        break;
      }
      // Check the shape of each command, and the command actually rendered with this value.
      const commands: ["read" | "set", string][] = [];
      if (c.read) commands.push(["read", c.read]);
      if (c.set) commands.push(["set", sampleOf(c.set)]);
      if (c.set && s.value !== undefined) commands.push(["set", fillCat(c.set, s.value)]);
      if (c.set && /\{(?!value(:\d+)?\})/.test(c.set)) commands.push(["set", "{"]);
      const bad = commands.map(([f, cmd]) => [f, catProblem(c.protocol, cmd, f)] as const).find(([, p]) => p);
      if (bad) {
        errors.push({ path: at(`/cat/${bad[0]}`), message: `${bad[1]}. Raw CAT is limited to settings that can't key, tune or send.` });
        break;
      }
      if (settable && !c.set) errors.push({ path: at("/cat/set"), message: "a CAT step that sets a value needs cat.set (or check_only: true)" });
      for (const p of catStepProblems(c)) errors.push({ path: at(`/cat/${p.field}`), message: p.message });
      if (c.reply) {
        try { new RegExp(c.reply); } catch { errors.push({ path: at("/cat/reply"), message: "cat.reply is not a valid regular expression" }); }
      }
      if (settable && c.set && catSafety(c.protocol, sampleOf(c.set)) === "tx") raise();
      if (!c.read) warnings.push({ path: at("/cat/read"), message: "without cat.read this step can't be checked or restored" });
      if (rig && rig.mfg === "Icom" && c.protocol !== "civ") warnings.push({ path: at("/cat/protocol"), message: "Icom radios use CI-V" });
      break;
    }
    case "manual":
      break;
  }
}

/** Does `current` satisfy the step? `step` is the Hamlib step size for tolerance. */
/** A present `expect` replaces exact matching on `value` (radios read back related values, e.g. AUTO → AUTO-MID). */
export function meets(s: Step, current: Scalar, step = 0): boolean {
  const e = s.expect;
  if (e && Object.keys(e).length) {
    if (e.not?.some((v) => same(v, current))) return false;
    if (e.one_of && !e.one_of.some((v) => same(v, current))) return false;
    const n = Number(current);
    if (e.min !== undefined && !(n >= e.min)) return false;
    if (e.max !== undefined && !(n <= e.max)) return false;
    return true;
  }
  if (s.value === undefined) return true;
  if (typeof s.value === "number") return Math.abs(Number(current) - s.value) <= Math.max(step, 1e-6);
  return same(s.value, current);
}

function same(a: Scalar, b: Scalar): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return toBool(a) === toBool(b);
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a).toUpperCase() === String(b).toUpperCase();
}
const toBool = (v: Scalar) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
