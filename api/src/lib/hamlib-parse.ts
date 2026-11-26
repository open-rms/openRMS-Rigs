// Parsers for `rigctl -l` and `rigctl --dump-caps` output (Hamlib 4.x).

export type Range = { min: number; max: number; step: number };
/** A level or parameter. `range` is null when Hamlib reports 0..0 (no range information). */
export type Control = { range: Range | null; choices?: string[] };

export type ModelListEntry = {
  model: number;
  macro: string;
  mfg: string;
  name: string;
  backendVersion: string;
  status: string;
  /** Not a physical radio: Dummy, NET rigctl, FLRig, TRXManager and similar bridges. */
  pseudo: boolean;
};

export type Caps = {
  rigType: string;
  portType: string;
  modes: string[];
  agcLevels: Record<string, string>;
  funcs: { get: string[]; set: string[] };
  levels: { get: Record<string, Control>; set: Record<string, Control> };
  parms: { get: Record<string, Control>; set: Record<string, Control> };
};

export type CatalogRig = ModelListEntry & Caps & { capsAvailable: boolean };

export const EMPTY_CAPS: Caps = {
  rigType: "", portType: "", modes: [], agcLevels: {},
  funcs: { get: [], set: [] }, levels: { get: {}, set: {} }, parms: { get: {}, set: {} },
};

const PSEUDO_MFG = new Set(["Hamlib", "FLRig", "TRXManager", "DttSP", "Dorji", "GQRX"]);

export function parseModelList(text: string): ModelListEntry[] {
  const lines = text.split("\n");
  const header = lines.findIndex((l) => l.includes("Rig #") && l.includes("Macro"));
  if (header < 0) throw new Error("rigctl -l: header not found");
  const h = lines[header]!;
  const col = (name: string) => {
    const i = h.indexOf(name);
    if (i < 0) throw new Error(`rigctl -l: column ${name} not found`);
    return i;
  };
  const cMfg = col("Mfg"), cModel = col("Model"), cVer = col("Version"), cStatus = col("Status"), cMacro = col("Macro");
  const out: ModelListEntry[] = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.trim()) continue;
    const model = Number(line.slice(0, cMfg).trim());
    const macro = line.slice(cMacro).trim();
    if (!Number.isInteger(model) || !macro.startsWith("RIG_MODEL_")) throw new Error(`rigctl -l: bad line: ${line}`);
    const mfg = line.slice(cMfg, cModel).trim();
    out.push({
      model,
      macro,
      mfg,
      name: line.slice(cModel, cVer).trim(),
      backendVersion: line.slice(cVer, cStatus).trim(),
      status: line.slice(cStatus, cMacro).trim(),
      pseudo: PSEUDO_MFG.has(mfg) || /NET|DUMMY|FLRIG|TRXMANAGER|SDRSHARP|SDRCONSOLE/.test(macro.replace("RIG_MODEL_", "")),
    });
  }
  return out;
}

/** Parses `NAME(min..max/step)` or `NAME(A,B,C)` items. */
export function parseControls(value: string): Record<string, Control> {
  const out: Record<string, Control> = {};
  const re = /([A-Z0-9_]+)\(([^)]*)\)/g;
  for (const m of value.matchAll(re)) {
    const [, name, body] = m as unknown as [string, string, string];
    const r = /^(-?[\d.]+)\.\.(-?[\d.]+)\/(-?[\d.]+)$/.exec(body);
    if (r) {
      const min = Number(r[1]), max = Number(r[2]), step = Number(r[3]);
      out[name] = { range: min === 0 && max === 0 ? null : { min, max, step } };
    } else if (body.length) {
      out[name] = { range: null, choices: body.split(",").map((s) => s.trim()).filter(Boolean) };
    } else {
      out[name] = { range: null };
    }
  }
  return out;
}

const words = (v: string | undefined) => (v ?? "").trim().split(/\s+/).filter((w) => w && w !== "None");

export function parseCaps(text: string): Caps {
  // Only top-level lines: indented lines repeat keys (e.g. "Mode list:" per frequency range).
  const top = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (/^\s/.test(line)) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    if (!top.has(key)) top.set(key, line.slice(i + 1).trim());
  }
  if (!top.has("Model name")) throw new Error("dump-caps: no 'Model name' line");
  const agcLevels: Record<string, string> = {};
  for (const w of words(top.get("AGC levels"))) {
    const [k, v] = w.split("=");
    if (k && v) agcLevels[k] = v;
  }
  return {
    rigType: (top.get("Rig type") ?? "").trim(),
    portType: (top.get("Port type") ?? "").trim(),
    modes: words(top.get("Mode list")),
    agcLevels,
    funcs: { get: words(top.get("Get functions")), set: words(top.get("Set functions")) },
    levels: { get: parseControls(top.get("Get level") ?? ""), set: parseControls(top.get("Set level") ?? "") },
    parms: { get: parseControls(top.get("Get parameters") ?? ""), set: parseControls(top.get("Set parameters") ?? "") },
  };
}
