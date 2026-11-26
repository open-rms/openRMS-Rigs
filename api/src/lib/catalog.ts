import { readdirSync, readFileSync } from "node:fs";
import { paths } from "../paths.js";
import type { CatalogRig } from "./hamlib-parse.js";

export type Catalog = { hamlibVersion: string; hamlibBuild: string; rigs: CatalogRig[] };

const dir = paths.catalog;

function versionKey(v: string) {
  return v.split(".").map((n) => n.padStart(4, "0")).join(".");
}

type Quirks = { rigs: Record<string, { unreadable?: { funcs?: { name: string }[]; levels?: { name: string }[]; parms?: { name: string }[] } }> };

/** Applies catalog/quirks.json: names rigctl lists as gettable but the backend can't actually read. */
export function applyQuirks(cat: Catalog, quirks: Quirks): Catalog {
  for (const rig of cat.rigs) {
    const u = quirks.rigs[rig.macro]?.unreadable;
    if (!u) continue;
    const funcs = new Set((u.funcs ?? []).map((f) => f.name));
    rig.funcs.get = rig.funcs.get.filter((f) => !funcs.has(f));
    for (const l of u.levels ?? []) delete rig.levels.get[l.name];
    for (const p of u.parms ?? []) delete rig.parms.get[p.name];
  }
  return cat;
}

/** All catalogs on disk, newest Hamlib first, with quirks applied. */
export function loadCatalogs(): Catalog[] {
  const quirks = JSON.parse(readFileSync(dir + "quirks.json", "utf8")) as Quirks;
  return readdirSync(dir)
    .filter((f) => /^hamlib-.*\.json$/.test(f))
    .map((f) => applyQuirks(JSON.parse(readFileSync(dir + f, "utf8")) as Catalog, quirks))
    .sort((a, b) => versionKey(b.hamlibVersion).localeCompare(versionKey(a.hamlibVersion)));
}

let cache: Catalog[] | undefined;
export const catalogs = () => (cache ??= loadCatalogs());
export const latest = () => {
  const c = catalogs()[0];
  if (!c) throw new Error("no Hamlib catalog in catalog/; run pnpm catalog");
  return c;
};

export function findRig(macro: string, hamlibVersion?: string): CatalogRig | undefined {
  const cat = hamlibVersion ? catalogs().find((c) => c.hamlibVersion === hamlibVersion) : latest();
  return cat?.rigs.find((r) => r.macro === macro);
}
