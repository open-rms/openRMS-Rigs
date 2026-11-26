// Applies the versioned Drizzle migrations in ./drizzle. Run at startup and by `pnpm migrate`.
import { paths } from "./paths.js";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./db/index.js";

const migrationsFolder = paths.migrations;

export async function migrate() {
  await drizzleMigrate(db, { migrationsFolder });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
  await pool.end();
  console.log("migrated");
}
