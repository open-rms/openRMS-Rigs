import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const fail = (c: Context, status: ContentfulStatusCode, code: string, message: string, details?: unknown) =>
  c.json({ error: { code, message, ...(details ? { details } : {}) } }, status);

/** Public, cacheable reads (ETag comes from hono/etag). Clients may cache offline. */
export const cacheable = (c: Context, seconds = 300) => c.header("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=86400`);

/** Responses ordered for the signed-in user (e.g. their radios first) must not be shared by caches. */
export const personal = (c: Context) => {
  c.header("Cache-Control", "private, max-age=60");
  c.header("Vary", "Authorization");
};
/** Public cache unless the response was personalised for `radios`. */
export const cacheableFor = (c: Context, radios: string[] | undefined, seconds = 300) =>
  (radios?.length ? personal(c) : cacheable(c, seconds));
