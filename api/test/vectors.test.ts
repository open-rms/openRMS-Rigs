// Runs openRMS-Spec rigs/examples/check-vectors.json, so /check and the CAT allow-list can't drift
// from the vectors that client implementations (rigctlWeb) test against.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paths } from "../src/paths.js";
import { findRig } from "../src/lib/catalog.js";
import { buildPlan, checkPlan } from "../src/lib/plan.js";
import { catProblem, catSafety, catStepProblems } from "../src/lib/safety.js";
import type { Profile, Scalar, Step } from "../src/lib/profile.js";

type CheckCase = { name: string; step: Step; current: Scalar | null; tolerance: number; status: string };
type CatCase = { protocol: "ascii" | "civ"; use: "read" | "set"; command: string; allowed: boolean; safety?: "rx" | "tx"; why?: string };
const V = JSON.parse(readFileSync(paths.checkVectors, "utf8")) as {
  check: { rig: string; cases: CheckCase[] };
  cat: { cases: CatCase[] };
  steps: { cases: { name: string; cat: Parameters<typeof catStepProblems>[0]; valid: boolean; field?: string }[] };
};

describe("Spec check vectors", () => {
  const rig = findRig(V.check.rig)!;
  for (const c of V.check.cases) {
    it(c.name, () => {
      if (c.step.kind === "level") expect(rig.levels.get[c.step.name]?.range?.step ?? 0).toBeCloseTo(c.tolerance, 9);
      const p = {
        schema: "openrms-rigs/profile/v1", title: "vector", operation: "other", connection: "usb", hamlib: ">=4.6",
        rig: { macro: rig.macro, hamlib_model: rig.model, mfg: rig.mfg, name: rig.name }, steps: [c.step],
      } as Profile;
      const plan = buildPlan(p);
      if (c.step.kind === "level") expect(plan.steps[0]!.tolerance).toBeCloseTo(c.tolerance, 9);
      const r = checkPlan(plan, { [c.step.id]: c.current });
      expect(r.steps[0]!.status).toBe(c.status);
    });
  }
});

describe("Spec CAT allow-list vectors", () => {
  for (const c of V.cat.cases) {
    it(`${c.protocol} ${c.use} ${JSON.stringify(c.command)} → ${c.allowed ? "allowed" : "refused"}`, () => {
      const problem = catProblem(c.protocol, c.command, c.use);
      if (c.allowed) expect(problem).toBeNull();
      else expect(problem).not.toBeNull();
      if (c.safety) expect(catSafety(c.protocol, c.command)).toBe(c.safety);
    });
  }
});

describe("Spec CAT step vectors (read/set/reply binding)", () => {
  for (const c of V.steps.cases) {
    it(c.name, () => {
      const problems = catStepProblems(c.cat);
      if (c.valid) expect(problems).toEqual([]);
      else expect(problems[0]?.field).toBe(c.field);
      // Every command in a valid step also passes the allow-list.
      if (c.valid && c.cat.read) expect(catProblem(c.cat.protocol, c.cat.read, "read")).toBeNull();
    });
  }
});
