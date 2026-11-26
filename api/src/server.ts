import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./env.js";
import { migrate } from "./migrate.js";

await migrate();
serve({ fetch: createApp().fetch, port: env.PORT }, (i) => console.log(`openRMS Rigs API on http://localhost:${i.port}`));
