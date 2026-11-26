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
/** Built site (adapter-static output) for server-rendered profile pages; override with SITE_DIR. */
const SITE_DIR = process.env.SITE_DIR ?? resolve(ROOT, "../site/build");
export const paths = {
  siteDir: SITE_DIR,
  catalog: join(ROOT, "catalog") + "/",
  migrations: join(ROOT, "drizzle"),
  profileSchema: join(SPEC_DIR, "rigs/profile.schema.json"),
  openapi: join(SPEC_DIR, "rigs/openapi.yaml"),
  catAllowlist: join(SPEC_DIR, "rigs/cat-allowlist.json"),
  checkVectors: join(SPEC_DIR, "rigs/examples/check-vectors.json"),
  examples: join(SPEC_DIR, "rigs/examples") + "/",
};
