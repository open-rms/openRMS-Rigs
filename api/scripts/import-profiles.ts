// Submits profile YAML/JSON files to a Rigs API as the signed-in account (they're credited to it).
//
//   RIGS_API_URL=https://rigs.openrms.dev RIGS_KEY=ormsr_… pnpm import-profiles ../profiles
//
// RIGS_KEY is an ormsr_ key from your account page (or RIGS_TOKEN, an Accounts access token).
// Files starting with "_" are skipped. Profiles you already have (same title) are skipped.
// Add --dry-run to only validate.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const base = (process.env.RIGS_API_URL ?? "http://localhost:8790").replace(/\/$/, "") + "/api/v1";
const key = process.env.RIGS_KEY, token = process.env.RIGS_TOKEN;
const dry = process.argv.includes("--dry-run");
const dirs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dirs.length) { console.error("usage: pnpm import-profiles <dir|file>… [--dry-run]"); process.exit(2); }
if (!dry && !key && !token) { console.error("set RIGS_KEY (ormsr_…) or RIGS_TOKEN"); process.exit(2); }
const auth: Record<string, string> = key ? { "x-api-key": key } : token ? { Authorization: `Bearer ${token}` } : {};

const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) walk(join(p, f));
  else if (/\.(ya?ml|json)$/.test(p) && !p.split("/").pop()!.startsWith("_")) files.push(p);
};
dirs.forEach(walk);

const mine = new Set<string>();
if (!dry) {
  const r = await fetch(`${base}/me/profiles`, { headers: auth });
  if (!r.ok) { console.error(`sign-in failed: ${r.status} ${await r.text()}`); process.exit(1); }
  for (const p of ((await r.json()) as { profiles: { title: string }[] }).profiles) mine.add(p.title);
}

let failed = 0;
for (const f of files) {
  const body = readFileSync(f, "utf8");
  const title = /^title:\s*(.+)$/m.exec(body)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? f;
  if (mine.has(title)) { console.log(`skip   ${f} (you already have "${title}")`); continue; }
  const r = await fetch(`${base}/${dry ? "validate" : "profiles"}`, { method: "POST", body, headers: { "content-type": "application/yaml", ...auth } });
  const j = (await r.json()) as { id?: string; status?: string; error?: { message: string; details?: unknown }; errors?: unknown[] };
  if (r.ok) console.log(`${dry ? "valid " : "added "} ${f}${j.id ? ` → ${j.id} (${j.status})` : ""}`);
  else { failed++; console.log(`FAIL   ${f}: ${r.status} ${JSON.stringify(j.error ?? j.errors)}`); }
}
process.exit(failed ? 1 : 0);
