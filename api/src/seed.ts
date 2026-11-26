// Loads the example profiles from openRMS-Spec/rigs/examples as published profiles owned by a
// seed account. Idempotent: skips titles that already exist.
import { readdirSync, readFileSync } from "node:fs";
import { paths } from "./paths.js";
import { eq } from "drizzle-orm";
import { db, pool, schema } from "./db/index.js";
import { migrate } from "./migrate.js";
import { newId } from "./lib/profiles.js";
import { parseProfileText, validateProfile } from "./lib/validate.js";

const dir = paths.examples;
await migrate();
for (const f of readdirSync(dir).filter((f) => /\.(ya?ml|json)$/.test(f))) {
  const res = validateProfile(parseProfileText(readFileSync(dir + f, "utf8")));
  if (!res.ok || !res.profile) {
    console.error(f, res.errors);
    process.exitCode = 1;
    continue;
  }
  const p = res.profile;
  const [exists] = await db.select().from(schema.profile).where(eq(schema.profile.title, p.title)).limit(1);
  if (exists) { console.log(`skip ${f}`); continue; }
  const id = newId(p);
  await db.insert(schema.profile).values({ id, rigMacro: p.rig.macro, operation: p.operation, title: p.title, status: "published", publishedRevision: 1, ownerSub: "seed", ownerCallsign: "openRMS" });
  await db.insert(schema.profileRevision).values({ profileId: id, revision: 1, document: p, hamlib: p.hamlib, createdBySub: "seed" });
  console.log(`seeded ${f} as ${id}`);
}
await pool.end();
