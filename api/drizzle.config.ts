import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://openrms_rigs:openrms_rigs@127.0.0.1:5442/openrms_rigs" },
  strict: true,
  verbose: true,
});
