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
import { pageRoutes } from "./routes/pages.js";
import { schemaPath } from "./lib/validate.js";
import { verifyWebhook } from "@openrms/service-auth";
import { ingestor, KEY_SCOPES } from "./lib/keys.js";
import { deleteAccount } from "./lib/deletion.js";

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
  app.route("/", pageRoutes);
  // OAuth Protected Resource Metadata (RFC 9728, identity.md §5.2): Accounts reads the key scopes from here.
  app.get("/.well-known/oauth-protected-resource", (c) => c.json({
    resource: env.AUDIENCE,
    authorization_servers: env.ISSUERS,
    bearer_methods_supported: ["header"],
    scopes_supported: KEY_SCOPES.map((s) => s.scope),
    openrms_key_scopes: KEY_SCOPES,
  }, 200, { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" }));

  // Accounts events (identity.md §7). Rigs acts on key.revoked and user.deleted; other events are acknowledged.
  app.post("/api/v1/webhooks/accounts", async (c) => {
    if (!env.ACCOUNTS_WEBHOOK_SECRET) return c.json({ error: { code: "unavailable", message: "webhooks not configured" } }, 503);
    const raw = await c.req.text();
    let event;
    try { event = verifyWebhook(raw, c.req.header("openrms-signature"), env.ACCOUNTS_WEBHOOK_SECRET); }
    catch { return c.json({ error: { code: "unauthorized", message: "bad signature" } }, 401); }
    try {
      if (event.type === "user.deleted") {
        const sub = (event.data as { sub?: unknown }).sub;
        if (typeof sub !== "string" || !sub) throw new Error("malformed user.deleted event");
        await deleteAccount(sub);
      } else await ingestor().ingest(event);
    }
    catch (e) {
      // A malformed event won't get better; anything else (e.g. the database) should be retried by Accounts' outbox.
      if (e instanceof Error && /malformed/.test(e.message)) return c.json({ error: { code: "bad_request", message: "malformed event" } }, 400);
      console.error("[rigs keys] webhook ingest failed", e);
      return c.json({ error: { code: "internal", message: "try again" } }, 503);
    }
    return c.body(null, 204);
  });

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
