import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCaps, parseControls, parseModelList } from "../src/lib/hamlib-parse.js";
import { buildPlan, checkPlan, fillCat } from "../src/lib/plan.js";
import { catProblem, isKeyingFunc } from "../src/lib/safety.js";
import { satisfies } from "../src/lib/version.js";
import { parseProfileText, validateProfile } from "../src/lib/validate.js";
import { latest } from "../src/lib/catalog.js";
import type { Profile } from "../src/lib/profile.js";

const ex = (f: string) => parseProfileText(readFileSync(new URL(`../../../openRMS-Spec/rigs/examples/${f}`, import.meta.url), "utf8")) as Profile;
const clone = <T>(v: T): T => structuredClone(v);

describe("hamlib parsing", () => {
  it("treats 0..0 as no range and reads choices", () => {
    const c = parseControls("AGC(0..0/0) RFPOWER(0.050000..1.000000/0.003922) KEYERTYPE(STRAIGHT,BUG,PADDLE)");
    expect(c.AGC!.range).toBeNull();
    expect(c.RFPOWER!.range).toEqual({ min: 0.05, max: 1, step: 0.003922 });
    expect(c.KEYERTYPE!.choices).toEqual(["STRAIGHT", "BUG", "PADDLE"]);
  });
  it("takes only the top-level mode list", () => {
    const caps = parseCaps("Model name:\tX\nMode list: USB LSB PKTUSB\n\t\tMode list:  CW\n");
    expect(caps.modes).toEqual(["USB", "LSB", "PKTUSB"]);
  });
  it("parses rigctl -l by header columns", () => {
    const list = parseModelList(
      " Rig #  Mfg                    Model                   Version         Status      Macro\n" +
      "  3073  Icom                   IC-7300                 20250517.14     Stable      RIG_MODEL_IC7300\n" +
      "     2  Hamlib                 NET rigctl              20250211.0      Stable      RIG_MODEL_NETRIGCTL\n",
    );
    expect(list[0]).toMatchObject({ model: 3073, mfg: "Icom", name: "IC-7300", macro: "RIG_MODEL_IC7300", pseudo: false });
    expect(list[1]!.pseudo).toBe(true);
  });
  it("has a complete catalog checked in", () => {
    const cat = latest();
    expect(cat.rigs.length).toBeGreaterThan(300);
    expect(cat.rigs.find((r) => r.macro === "RIG_MODEL_IC7300")?.capsAvailable).toBe(true);
  });
});

describe("versions", () => {
  it("checks ranges", () => {
    expect(satisfies("4.7.2", ">=4.6 <4.8")).toBe(true);
    expect(satisfies("4.8", ">=4.6 <4.8")).toBe(false);
    expect(satisfies("Hamlib 4.6.2", ">=4.6.2")).toBe(true);
    expect(satisfies("1.42", undefined)).toBe(true);
  });
});

describe("safety", () => {
  it("refuses keying functions and CAT", () => {
    for (const f of ["VOX", "TUNER", "SBKIN", "SEND_MORSE", "SEND_ANYTHING"]) expect(isKeyingFunc(f)).toBe(true);
    expect(isKeyingFunc("NB")).toBe(false);
    expect(catProblem("ascii", "TX1;")).not.toBeNull();
    expect(catProblem("ascii", "AC002;")).not.toBeNull();
    expect(catProblem("ascii", "KYhello;")).not.toBeNull();
    expect(catProblem("ascii", "EX010413050;")).toBeNull();
    expect(catProblem("ascii", "GT04;MD0C;")).toBeNull();
    expect(catProblem("ascii", "GT04;TX1;")).not.toBeNull();
    expect(catProblem("civ", "1C0001")).not.toBeNull();
    expect(catProblem("civ", "1A050071")).toBeNull();
  });

  it("raises CAT steps in tx families to safety tx, and passes menu paths to the plan", () => {
    const p = clone(ex("ftdx10-ardop.yaml"));
    p.steps.push({ id: "pc", kind: "cat", name: "Power", value: 50, menu: ["FUNC", "RF POWER"], cat: { protocol: "ascii", read: "PC;", reply: "^PC(\\d{3});$", set: "PC{value:03};" } });
    const v = validateProfile(p);
    expect(v.errors).toEqual([]);
    const plan = buildPlan(v.profile!);
    expect(plan.steps.find((s) => s.id === "pc")).toMatchObject({ safety: "tx", menu: ["FUNC", "RF POWER"] });
    const sm = clone(ex("ftdx10-ardop.yaml"));
    sm.steps.push({ id: "sm", kind: "cat", name: "meter", value: 1, cat: { protocol: "ascii", read: "SM0;", set: "SM0{value:03};" } });
    expect(validateProfile(sm).errors.some((e) => e.message.includes("can't be used to set"))).toBe(true);
  });
});

describe("validation", () => {
  it("accepts the examples", () => {
    for (const f of ["ic7300-ft8.yaml", "ftdx10-ardop.yaml"]) {
      const r = validateProfile(ex(f));
      expect(r.errors, f).toEqual([]);
    }
  });
  it("rejects a keying function", () => {
    const p = clone(ex("ic7300-ft8.yaml"));
    p.steps.push({ id: "vox", kind: "func", name: "VOX", value: true });
    expect(validateProfile(p).errors[0]!.message).toMatch(/key the transmitter/);
  });
  it("rejects values out of Hamlib's range and unknown names", () => {
    const p = clone(ex("ic7300-ft8.yaml"));
    p.steps.find((s) => s.id === "power")!.value = 1.5;
    p.steps.push({ id: "x", kind: "level", name: "NOPE", value: 1 });
    const msgs = validateProfile(p).errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/RFPOWER must be 0.05..1/);
    expect(msgs).toMatch(/can't set level NOPE/);
  });
  it("raises safety to tx for transmit levels", () => {
    const p = clone(ex("ic7300-ft8.yaml"));
    delete p.steps.find((s) => s.id === "power")!.safety;
    expect(validateProfile(p).profile!.steps.find((s) => s.id === "power")!.safety).toBe("tx");
  });
  it("rejects modes the radio doesn't have and duplicate ids", () => {
    const p = clone(ex("ic7300-ft8.yaml"));
    p.steps[0]!.value = "DSB";
    p.steps.push({ ...p.steps[1]! });
    const msgs = validateProfile(p).errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/no mode DSB/);
    expect(msgs).toMatch(/duplicate step id/);
  });
  it("reports schema errors with paths", () => {
    const r = validateProfile({ schema: "openrms-rigs/profile/v1", title: "x" });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("plan and check", () => {
  it("fills CAT templates", () => {
    expect(fillCat("EX010413{value:03};", 50)).toBe("EX010413050;");
    expect(fillCat("GT0{value};", 4)).toBe("GT04;");
  });
  it("builds structured steps with rigctld lines", () => {
    const plan = buildPlan(validateProfile(ex("ftdx10-ardop.yaml")).profile!);
    const agc = plan.steps.find((s) => s.id === "agc")!;
    expect(agc.rigctld).toEqual({ get: "w GT0;", set: "W GT04; 0" });
    expect(agc.readable).toBe(true);
    expect(plan.steps.find((s) => s.id === "data-mod-source")!.safety).toBe("tx");
    expect(plan.steps.find((s) => s.id === "data-shift")!.rigctld).toEqual({ get: "w EX010408;", set: null });
  });
  it("check-only steps never set", () => {
    const plan = buildPlan(validateProfile(ex("ic7300-ft8.yaml")).profile!);
    expect(plan.steps.find((s) => s.id === "agc-not-off")!.rigctld.set).toBeNull();
  });
  it("compares current values", () => {
    const plan = buildPlan(validateProfile(ex("ic7300-ft8.yaml")).profile!);
    const r = checkPlan(plan, { mode: "PKTUSB", power: 0.351, "agc-not-off": 0, "nb-off": "0", "usb-af": 0.55 });
    const by = Object.fromEntries(r.steps.map((s) => [s.id, s.status]));
    expect(by).toMatchObject({ mode: "ok", power: "ok", "agc-not-off": "drift", "nb-off": "ok", "usb-af": "ok", "nr-off": "unknown", "data-mod": "manual" });
  });
});

describe("spec", () => {
  it("openapi.yaml parses and documents the core paths", async () => {
    const { parse } = await import("yaml");
    const doc = parse(readFileSync(new URL("../../../openRMS-Spec/rigs/openapi.yaml", import.meta.url), "utf8"));
    expect(doc.openapi).toBe("3.1.0");
    for (const p of ["/rigs", "/rigs/{macro}", "/profiles", "/profiles/{id}", "/profiles/{id}/apply-plan", "/profiles/{id}/check", "/dump.json", "/validate"]) {
      expect(doc.paths[p], p).toBeDefined();
    }
  });
});

describe("injection and keying hardening", () => {
  const base = () => clone(ex("ftdx10-ardop.yaml"));
  const errs = (p: Profile) => validateProfile(p).errors.map((e) => e.message).join("\n");
  it("rejects non-numeric level values (newline injection)", () => {
    const p = clone(ex("ic7300-ft8.yaml"));
    p.steps.push({ id: "inj", kind: "level", name: "AF", value: "1\nT 1" });
    expect(errs(p)).not.toBe("");
  });
  it("rejects a CAT value that renders a keying command", () => {
    const p = base();
    p.steps.push({ id: "inj", kind: "cat", name: "X", value: "TX1;", cat: { protocol: "ascii", read: "EX010413;", set: "{value}" } });
    expect(errs(p)).not.toBe("");
  });
  it("rejects whitespace or control characters in CAT commands", () => {
    const p = base();
    p.steps.push({ id: "inj", kind: "cat", name: "X", check_only: true, cat: { protocol: "ascii", read: "GT0;\nT 1" } });
    expect(errs(p)).not.toBe("");
  });
  it("only allows known-safe CAT command families", () => {
    for (const cmd of ["MX1;", "VX1;", "BI1;", "SWT16;", "ZZTX1;", "TX;", "AC002;", "KYTEST;"]) {
      const p = base();
      p.steps.push({ id: "k", kind: "cat", name: "X", check_only: true, cat: { protocol: "ascii", read: cmd } });
      expect(errs(p), cmd).not.toBe("");
    }
    for (const civ of ["1C00", "1C01", "17", "28", "1646", "1647"]) {
      const p = base();
      p.steps.push({ id: "k", kind: "cat", name: "X", check_only: true, cat: { protocol: "civ", read: civ } });
      expect(errs(p), civ).not.toBe("");
    }
  });
  it("buildPlan never emits a multi-line rigctld command", () => {
    const p = clone(ex("ic7300-ft8.yaml"));
    p.steps.push({ id: "inj", kind: "level", name: "AF", value: "1\nT 1" });
    expect(() => buildPlan(p)).toThrow();
  });
  it("expect replaces exact matching (FT-DX10 AGC reads back 5 for AUTO-MID)", () => {
    const plan = buildPlan(validateProfile(ex("ftdx10-ardop.yaml")).profile!);
    const r = checkPlan(plan, { agc: 5 });
    expect(r.steps.find((s) => s.id === "agc")!.status).toBe("ok");
    expect(checkPlan(plan, { agc: 0 }).steps.find((s) => s.id === "agc")!.status).toBe("drift");
  });
});

describe("sources", () => {
  it("accepts cited sources and rejects dangling references", () => {
    const p = clone(ex("ic7300-ft8.yaml"));
    p.sources = [{ id: "S1", title: "IC-7300 manual", author: "Icom", url: "https://www.icomamerica.com/" }];
    p.steps[0]!.sources = ["S1"];
    p.steps[0]!.confidence = "high";
    expect(validateProfile(p).errors).toEqual([]);
    p.steps[1]!.sources = ["S9"];
    expect(validateProfile(p).errors.map((e) => e.message).join()).toMatch(/S9/);
  });
});
