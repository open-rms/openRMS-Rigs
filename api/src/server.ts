import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./env.js";
import { migrate } from "./migrate.js";
import { startKeyServices } from "./lib/keys.js";

await migrate();
serve({ fetch: createApp().fetch, port: env.PORT, hostname: env.HOST }, (i) => console.log(`openRMS Rigs API on http://${env.HOST}:${i.port}`));
// After listening: a slow or unreachable Accounts must not hold up the API (the denylist is persisted).
startKeyServices().catch((e) => console.error("[rigs keys] start failed", e));
