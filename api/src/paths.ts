// Resolves files relative to the api package root, so paths work from src/ (tsx) and dist/src/ (node).
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("api package root not found");
    dir = up;
  }
  return dir;
}

export const ROOT = findRoot();
/** openRMS-Spec checkout; override with OPENRMS_SPEC_DIR when deployed elsewhere. */
export const SPEC_DIR = process.env.OPENRMS_SPEC_DIR ?? resolve(ROOT, "../../openRMS-Spec");
export const paths = {
  catalog: join(ROOT, "catalog") + "/",
  migrations: join(ROOT, "drizzle"),
  profileSchema: join(SPEC_DIR, "rigs/profile.schema.json"),
  openapi: join(SPEC_DIR, "rigs/openapi.yaml"),
  examples: join(SPEC_DIR, "rigs/examples") + "/",
};
