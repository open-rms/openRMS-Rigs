import { Hono } from "hono";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { logger } from "hono/logger";
import { swaggerUI } from "@hono/swagger-ui";
import { existsSync, readFileSync } from "node:fs";
import { paths } from "./paths.js";
import { env } from "./env.js";
import { publicRoutes } from "./routes/public.js";
import { writeRoutes } from "./routes/write.js";
import { commentRoutes } from "./routes/comments.js";
import { schemaPath } from "./lib/validate.js";

const specPath = paths.openapi;

export function createApp() {
  const app = new Hono();
  if (process.env.NODE_ENV !== "test") app.use("*", logger());
  // Reads are open to any origin (no cookies are used: auth is a Bearer token or an x-api-key).
  app.use("/api/v1/*", cors({
    origin: (o) => (env.SITE_ORIGINS.includes(o) ? o : "*"),
    allowHeaders: ["Content-Type", "Authorization", "x-api-key", "If-None-Match"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["ETag"],
  }));
  app.use("/api/v1/*", etag());

  app.route("/api/v1", writeRoutes);
  app.route("/api/v1", commentRoutes);
  app.route("/api/v1", publicRoutes);

  app.get("/api/v1/openapi.yaml", (c) => {
    if (!existsSync(specPath)) return c.text("spec not found", 404);
    return c.body(readFileSync(specPath, "utf8"), 200, { "Content-Type": "application/yaml", "Access-Control-Allow-Origin": "*" });
  });
  app.get("/api/v1/profile.schema.json", (c) =>
    c.body(readFileSync(schemaPath, "utf8"), 200, { "Content-Type": "application/schema+json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" }));
  app.get("/docs", swaggerUI({ url: "/api/v1/openapi.yaml" }));
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/", (c) => c.json({ name: "openRMS Rigs", docs: "/docs", openapi: "/api/v1/openapi.yaml", schema: "/api/v1/profile.schema.json" }));
  app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: { code: "internal", message: "internal error" } }, 500);
  });
  return app;
}
