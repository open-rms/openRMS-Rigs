// Canonical profile pages: GET /p/{id} serves the site's SPA shell with the profile's title,
// description and canonical link filled in, and a real 404 for ids that aren't public. The SPA
// then renders the page as usual (so authors still see their own pending profiles).
// Needs the reverse proxy to send /p/* here, and the built site at SITE_DIR.
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.js";
import { paths } from "../paths.js";
import type { Profile } from "../lib/profile.js";
import { getProfile, getRevision, isPublic } from "../lib/profiles.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
let shell: string | null = null;
function loadShell(): string | null {
  if (shell === null || process.env.NODE_ENV !== "production") {
    const f = join(paths.siteDir, "index.html");
    shell = existsSync(f) ? readFileSync(f, "utf8") : null;
  }
  return shell;
}

/** Replaces the shell's <title> and description, and adds canonical/Open Graph/alternate links. */
export function withMeta(html: string, m: { title: string; description: string; url?: string; json?: string; noindex?: boolean }): string {
  const head = [
    m.url ? `<link rel="canonical" href="${esc(m.url)}" />` : "",
    m.url ? `<meta property="og:url" content="${esc(m.url)}" />` : "",
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:site_name" content="openRMS Rigs" />`,
    m.json ? `<link rel="alternate" type="application/json" href="${esc(m.json)}" />` : "",
    m.noindex ? `<meta name="robots" content="noindex" />` : "",
  ].filter(Boolean).join("\n    ");
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(m.description)}" />`)
    .replace("</head>", `    ${head}\n  </head>`);
}

export const pageRoutes = new Hono();

pageRoutes.get("/p/:id", async (c) => {
  const html = loadShell();
  if (!html) return c.text("site not built", 404);
  const id = c.req.param("id");
  const row = /^[a-z0-9-]{1,80}$/.test(id) ? await getProfile(id) : undefined;
  c.header("Cache-Control", "public, max-age=300");
  if (!row || !isPublic(row)) {
    return c.html(withMeta(html, { title: "Profile not found · openRMS Rigs", description: "No public profile with this id.", noindex: true }), 404);
  }
  const doc = (await getRevision(row.id, row.publishedRevision!))?.document as Profile | undefined;
  const url = `${env.PUBLIC_URL}/p/${row.id}`;
  const description = doc?.summary ?? `${doc?.rig.mfg ?? ""} ${doc?.rig.name ?? row.rigMacro} settings for ${row.operation}, by ${row.ownerCallsign ?? "anonymous"}.`.trim();
  return c.html(withMeta(html, {
    title: `${row.title} · openRMS Rigs`, description: description.slice(0, 300), url, json: `${env.PUBLIC_URL}/api/v1/profiles/${row.id}`,
  }));
});
