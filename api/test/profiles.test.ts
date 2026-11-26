// Every profile in profiles/ (the researched examples) must validate, build a plan with readable
// text, and cite only sources it lists.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/lib/plan.js";
import { parseProfileText, validateProfile } from "../src/lib/validate.js";

const root = fileURLToPath(new URL("../../profiles/", import.meta.url));
const files: string[] = [];
const walk = (p: string) => statSync(p).isDirectory() ? readdirSync(p).forEach((f) => walk(join(p, f))) : /\.(ya?ml|json)$/.test(p) && !p.split("/").pop()!.startsWith("_") && files.push(p);
walk(root);

describe("profiles/", () => {
  it("has profiles", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(f.slice(root.length), () => {
      const res = validateProfile(parseProfileText(readFileSync(f, "utf8")));
      expect(res.errors).toEqual([]);
      const p = res.profile!;
      const ids = new Set((p.sources ?? []).map((s) => s.id));
      const cited = [...p.steps.flatMap((s) => s.sources ?? []), ...JSON.stringify(p.notes ?? "").match(/S\d+(?=\])/g) ?? []];
      for (const id of cited) expect(ids.has(id), `${id} cited but not listed`).toBe(true);
      expect(p.tags).toContain("unverified");
      const plan = buildPlan(p);
      for (const s of plan.steps) expect(s.text, s.id).not.toMatch(/undefined|null/);
    });
  }
});
