// What changed between two profile documents, for "forked from" pages and the clone editor.
// Steps are matched by what they control (kind + name, or menu path), not by id.
import type { ProfileDoc, Step } from "./api.ts";

export type Change = { type: "added" | "removed" | "changed"; label: string; from?: string; to?: string };

const keyOf = (s: Step) => (s.kind === "manual" ? `manual:${s.manual?.menu || s.name}` : `${s.kind}:${s.name}`);

function summary(s: Step): string {
  const exp = s.expect
    ? [s.expect.min !== undefined && `≥ ${s.expect.min}`, s.expect.max !== undefined && `≤ ${s.expect.max}`, s.expect.not?.length && `not ${s.expect.not.join("/")}`, s.expect.one_of?.length && `one of ${s.expect.one_of.join("/")}`].filter(Boolean).join(", ")
    : "";
  let v: string;
  switch (s.kind) {
    case "mode": v = `${s.value}${s.passband_hz ? ` ${s.passband_hz} Hz` : ""}`; break;
    case "func": v = s.check_only ? "check" : s.value ? "on" : "off"; break;
    case "manual": v = s.manual?.value ?? ""; break;
    case "cat": v = s.check_only ? "check" : String(s.value ?? ""); break;
    default: v = s.check_only ? "check" : `${s.value ?? ""}${s.display ? ` (${s.display})` : ""}`;
  }
  return [v, exp && `(${exp})`, s.safety === "tx" && "TX"].filter(Boolean).join(" ");
}

const label = (s: Step) => (s.kind === "manual" ? `On the radio: ${s.name || s.manual?.menu}` : s.kind === "mode" ? "Mode" : s.kind === "cat" ? `${s.name} (raw CAT)` : s.name);

export function diffDocs(a: ProfileDoc, b: ProfileDoc): Change[] {
  const out: Change[] = [];
  const top: [string, (d: ProfileDoc) => unknown][] = [
    ["Radio", (d) => `${d.rig.mfg} ${d.rig.name}`], ["Firmware", (d) => d.rig.firmware], ["Operation", (d) => d.operation],
    ["Connection", (d) => d.connection], ["Interface", (d) => d.interface], ["Hamlib versions", (d) => d.hamlib],
    ["Receive audio target", (d) => d.audio?.rx_target_dbfs !== undefined ? `${d.audio.rx_target_dbfs} dBFS` : undefined],
  ];
  for (const [l, get] of top) {
    const x = get(a), y = get(b);
    if ((x ?? "") !== (y ?? "")) out.push({ type: "changed", label: l, from: x ? String(x) : "—", to: y ? String(y) : "—" });
  }
  const am = new Map(a.steps.map((s) => [keyOf(s), s])), bm = new Map(b.steps.map((s) => [keyOf(s), s]));
  for (const [k, s] of bm) {
    const o = am.get(k);
    if (!o) out.push({ type: "added", label: label(s), to: summary(s) });
    else if (summary(o) !== summary(s) || JSON.stringify(o.cat ?? null) !== JSON.stringify(s.cat ?? null)) out.push({ type: "changed", label: label(s), from: summary(o), to: summary(s) });
  }
  for (const [k, s] of am) if (!bm.has(k)) out.push({ type: "removed", label: label(s), from: summary(s) });
  const sw = (d: ProfileDoc) => new Map((d.software ?? []).map((x) => [`${x.app} › ${x.setting}`, x.value]));
  const as = sw(a), bs = sw(b);
  for (const [k, v] of bs) { const o = as.get(k); if (o === undefined) out.push({ type: "added", label: k, to: v }); else if (o !== v) out.push({ type: "changed", label: k, from: o, to: v }); }
  for (const [k, v] of as) if (!bs.has(k)) out.push({ type: "removed", label: k, from: v });
  if ((a.notes ?? "") !== (b.notes ?? "")) out.push({ type: "changed", label: "Notes" });
  return out;
}
