// Submits profile YAML/JSON files to a Rigs API as the signed-in account (they're credited to it).
//
//   RIGS_API_URL=https://rigs.openrms.dev RIGS_KEY=ormk_… pnpm import-profiles ../profiles
//
// RIGS_KEY is an openRMS API key for Rigs from https://auth.openrms.dev/keys with the scopes
// profiles:write and profiles:read-private (or RIGS_TOKEN, an Accounts access token).
// Files starting with "_" are skipped. Profiles you already have (same title) are skipped,
// unless --update is given: then each one gets a new revision from the file (moderators review
// it as usual). Add --dry-run to only validate.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const base = (process.env.RIGS_API_URL ?? "http://localhost:8790").replace(/\/$/, "") + "/api/v1";
const key = process.env.RIGS_KEY, token = process.env.RIGS_TOKEN;
const dry = process.argv.includes("--dry-run");
const update = process.argv.includes("--update");
const dirs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dirs.length) { console.error("usage: pnpm import-profiles <dir|file>… [--dry-run]"); process.exit(2); }
if (!dry && !key && !token) { console.error("set RIGS_KEY (ormk_…, from https://auth.openrms.dev/keys) or RIGS_TOKEN"); process.exit(2); }
if (key && !key.startsWith("ormk_")) { console.error("RIGS_KEY must be an openRMS key (ormk_…); Rigs' own ormsr_ keys are retired"); process.exit(2); }
const bearer = key ?? token;
const auth: Record<string, string> = bearer ? { Authorization: `Bearer ${bearer}` } : {};

const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) walk(join(p, f));
  else if (/\.(ya?ml|json)$/.test(p) && !p.split("/").pop()!.startsWith("_")) files.push(p);
};
dirs.forEach(walk);

const mine = new Map<string, string>(); // title → id
if (!dry) {
  const r = await fetch(`${base}/me/profiles`, { headers: auth });
  if (!r.ok) { console.error(`sign-in failed: ${r.status} ${await r.text()}`); process.exit(1); }
  for (const p of ((await r.json()) as { profiles: { id: string; title: string }[] }).profiles) mine.set(p.title, p.id);
}

let failed = 0;
for (const f of files) {
  const body = readFileSync(f, "utf8");
  const title = /^title:\s*(.+)$/m.exec(body)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? f;
  const existing = mine.get(title);
  if (existing && !update) { console.log(`skip   ${f} (you already have "${title}")`); continue; }
  const url = dry ? `${base}/validate` : existing ? `${base}/profiles/${existing}` : `${base}/profiles`;
  const r = await fetch(url, { method: existing && !dry ? "PUT" : "POST", body, headers: { "content-type": "application/yaml", ...auth } });
  const j = (await r.json()) as { id?: string; status?: string; revision?: number; current_revision?: number; error?: { message: string; details?: unknown }; errors?: unknown[] };
  const verb = dry ? "valid " : existing ? "update" : "added ";
  if (r.ok) console.log(`${verb} ${f}${j.id ? ` → ${j.id} (${j.status}${existing ? `, revision ${j.current_revision ?? j.revision}` : ""})` : ""}`);
  else { failed++; console.log(`FAIL   ${f}: ${r.status} ${JSON.stringify(j.error ?? j.errors)}`); }
}
process.exit(failed ? 1 : 0);
