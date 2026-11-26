import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../env.js";
import * as schema from "./schema.js";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

// Idle connections can be closed by the server (restarts, serverless scale-to-zero). Log and let
// the pool reconnect instead of crashing the process.
pool.on("error", (e) => console.error("[db] idle client error:", e.message));
export const db = drizzle(pool, { schema });
export { schema };
