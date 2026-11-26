import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const fail = (c: Context, status: ContentfulStatusCode, code: string, message: string, details?: unknown) =>
  c.json({ error: { code, message, ...(details ? { details } : {}) } }, status);

/** Public, cacheable reads (ETag comes from hono/etag). Clients may cache offline. */
export const cacheable = (c: Context, seconds = 300) => c.header("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=86400`);
