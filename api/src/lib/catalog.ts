import { readdirSync, readFileSync } from "node:fs";
import { paths } from "../paths.js";
import type { CatalogRig } from "./hamlib-parse.js";

export type Catalog = { hamlibVersion: string; hamlibBuild: string; rigs: CatalogRig[] };

const dir = paths.catalog;

function versionKey(v: string) {
  return v.split(".").map((n) => n.padStart(4, "0")).join(".");
}

/** All catalogs on disk, newest Hamlib first. */
export function loadCatalogs(): Catalog[] {
  return readdirSync(dir)
    .filter((f) => /^hamlib-.*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(dir + f, "utf8")) as Catalog)
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
