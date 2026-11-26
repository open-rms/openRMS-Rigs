// Public, read-only routes. No auth, cacheable, nothing per-user in URLs.
import { Hono, type Context } from "hono";
import { stringify as toYaml } from "yaml";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { optionalAuth, type MaybeAuthEnv } from "../auth.js";
import { catalogs, findRig, latest } from "../lib/catalog.js";
import { cacheable, fail } from "../lib/http.js";
import { buildPlan, checkPlan } from "../lib/plan.js";
import type { Profile, Scalar } from "../lib/profile.js";
import { canSee, defaultRevision, envelope, getProfile, getRevision, isPrivileged, lineage, listProfiles, publicWhere } from "../lib/profiles.js";
import { unitOf } from "../lib/units.js";
import { isKeyingFunc, METER_LEVELS, SETTABLE_FUNCS, TX_FUNCS, TX_LEVELS } from "../lib/safety.js";
import { parseProfileText, validateProfile } from "../lib/validate.js";
import { readFileSync } from "node:fs";
import { schemaPath } from "../lib/validate.js";

export const OPERATIONS = (JSON.parse(readFileSync(schemaPath, "utf8")) as { $defs: { operation: { enum: string[] } } }).$defs.operation.enum;

export const publicRoutes = new Hono<MaybeAuthEnv>();
publicRoutes.use("*", optionalAuth);

publicRoutes.get("/operations", (c) => {
  cacheable(c, 3600);
  return c.json({ operations: OPERATIONS });
});

publicRoutes.get("/hamlib", (c) => {
  cacheable(c, 3600);
  return c.json({ versions: catalogs().map((k) => ({ version: k.hamlibVersion, build: k.hamlibBuild, rigs: k.rigs.length })), latest: latest().hamlibVersion });
});

publicRoutes.get("/rigs", async (c) => {
  const q = c.req.query("q")?.toLowerCase();
  const mfg = c.req.query("mfg");
  const pseudo = c.req.query("include_pseudo") === "true";
  const ver = c.req.query("hamlib");
  const cat = ver ? catalogs().find((k) => k.hamlibVersion === ver) : latest();
  if (!cat) return fail(c, 404, "not_found", `no catalog for Hamlib ${ver}`);
  const counts = new Map(
    (await db.select({ macro: schema.profile.rigMacro, n: sql<number>`count(*)::int` }).from(schema.profile)
      .where(publicWhere()).groupBy(schema.profile.rigMacro)).map((r) => [r.macro, r.n]),
  );
  const rigs = cat.rigs
    .filter((r) => pseudo || !r.pseudo)
    .filter((r) => !mfg || r.mfg.toLowerCase() === mfg.toLowerCase())
    .filter((r) => !q || `${r.mfg} ${r.name} ${r.macro}`.toLowerCase().includes(q))
    .map((r) => ({ macro: r.macro, hamlib_model: r.model, mfg: r.mfg, name: r.name, status: r.status, pseudo: r.pseudo, profiles: counts.get(r.macro) ?? 0 }));
  cacheable(c, 300);
  return c.json({ hamlib: cat.hamlibVersion, count: rigs.length, rigs });
});

publicRoutes.get("/rigs/:macro", (c) => {
  const rig = findRig(c.req.param("macro"), c.req.query("hamlib"));
  if (!rig) return fail(c, 404, "not_found", "no such rig in the Hamlib catalog");
  const levels = (side: "get" | "set") =>
    Object.fromEntries(Object.entries(rig.levels[side]).map(([k, v]) => [k, { ...v, unit: unitOf(k) }]));
  cacheable(c, 3600);
  return c.json({
    macro: rig.macro, hamlib_model: rig.model, mfg: rig.mfg, name: rig.name, status: rig.status, pseudo: rig.pseudo,
    backend_version: rig.backendVersion, caps_available: rig.capsAvailable, hamlib: c.req.query("hamlib") ?? latest().hamlibVersion,
    caps: {
      modes: rig.modes, agc_levels: rig.agcLevels, funcs: rig.funcs,
      levels: { get: levels("get"), set: levels("set") }, parms: rig.parms,
    },
    // What a profile may use on this radio, so editors only offer what the validator accepts.
    profile: {
      settable_levels: Object.keys(rig.levels.set).filter((n) => !METER_LEVELS.test(n)),
      checkable_levels: Object.keys(rig.levels.get).filter((n) => !METER_LEVELS.test(n)),
      settable_funcs: rig.funcs.set.filter((f) => SETTABLE_FUNCS.has(f) && !isKeyingFunc(f)),
      checkable_funcs: rig.funcs.get.filter((f) => !isKeyingFunc(f)),
      settable_parms: Object.keys(rig.parms.set),
      tx_levels: Object.keys(rig.levels.set).filter((n) => TX_LEVELS.has(n)),
      tx_funcs: rig.funcs.set.filter((f) => TX_FUNCS.has(f)),
      refused_funcs: rig.funcs.set.filter((f) => isKeyingFunc(f)),
      cat_protocol: rig.mfg === "Icom" ? "civ" : "ascii",
    },
  });
});

publicRoutes.get("/profiles", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const op = c.req.query("operation");
  if (op && !OPERATIONS.includes(op)) return fail(c, 400, "bad_request", `unknown operation "${op}"`);
  const { rows, total } = await listProfiles({
    rig: c.req.query("rig"), operation: op, q: c.req.query("q"), sort: c.req.query("sort"),
    limit, offset, who: c.get("principal"),
  });
  cacheable(c, 60);
  return c.json({ total, limit, offset, profiles: rows.map((r) => envelope(r)) });
});

/** Everything published, with documents: for offline bundles (hamstack, rigctlWeb). */
publicRoutes.get("/dump.json", async (c) => {
  const rows = await db.select({ p: schema.profile, d: schema.profileRevision.document })
    .from(schema.profile)
    .innerJoin(schema.profileRevision, sql`${schema.profileRevision.profileId} = ${schema.profile.id} AND ${schema.profileRevision.revision} = ${schema.profile.publishedRevision}`)
    .where(publicWhere())
    .orderBy(asc(schema.profile.id));
  cacheable(c, 900);
  return c.json({ generated_at: new Date().toISOString(), license: "CC-BY-SA-4.0", profiles: rows.map((r) => envelope(r.p, r.d)) });
});

async function loadVisible(c: Context<MaybeAuthEnv>, id: string) {
  const row = await getProfile(id);
  if (!row || !canSee(row, c.get("principal"))) return { error: fail(c, 404, "not_found", "no such profile") };
  const who = c.get("principal");
  const want = c.req.query("revision");
  const revision = want ? Number(want) : defaultRevision(row, who);
  const allowed = isPrivileged(row, who) || (revision !== null && revision <= (row.publishedRevision ?? 0));
  const rev = allowed && Number.isInteger(revision) ? await getRevision(id, revision!) : undefined;
  if (!rev) return { error: fail(c, 404, "not_found", "no such revision") };
  if (!isPrivileged(row, who)) cacheable(c, want ? 86400 : 300);
  else c.header("Cache-Control", "private, no-store");
  return { row, rev };
}

// /profiles/{id}.json and /profiles/{id}.yaml: the bare document, ready to save or import.
publicRoutes.get("/profiles/:file{[a-z0-9-]+\\.(?:json|yaml)}", async (c) => {
  const file = c.req.param("file");
  const id = file.replace(/\.(json|yaml)$/, "");
  const r = await loadVisible(c, id);
  if ("error" in r) return r.error;
  if (file.endsWith(".yaml")) return c.body(toYaml(r.rev.document), 200, { "Content-Type": "application/yaml; charset=utf-8" });
  return c.json(r.rev.document);
});

publicRoutes.get("/profiles/:id", async (c) => {
  const r = await loadVisible(c, c.req.param("id"));
  if ("error" in r) return r.error;
  const env = envelope(r.row, r.rev.document, r.rev.revision);
  const who = c.get("principal");
  const l = await lineage(r.row, who);
  // Signed in: whether this person saved it and what they reported. Per-user, so never shared-cached.
  let viewer = null;
  if (who) {
    c.header("Cache-Control", "private, no-cache");
    const [st] = await db.select({ at: schema.star.createdAt }).from(schema.star).where(and(eq(schema.star.profileId, r.row.id), eq(schema.star.sub, who.sub))).limit(1);
    const [rep] = await db.select({ worked: schema.report.worked, revision: schema.report.revision }).from(schema.report)
      .where(and(eq(schema.report.profileId, r.row.id), eq(schema.report.sub, who.sub))).orderBy(desc(schema.report.revision)).limit(1);
    const [fav] = await db.select({ at: schema.favorite.createdAt }).from(schema.favorite).where(and(eq(schema.favorite.profileId, r.row.id), eq(schema.favorite.sub, who.sub))).limit(1);
    viewer = { favorite: !!fav, starred: !!st, starred_at: st?.at ?? null, report: rep ?? null, owner: r.row.ownerSub === who.sub };
  }
  const [{ n: comments }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.comment)
    .where(and(eq(schema.comment.profileId, r.row.id), sql`${schema.comment.deletedAt} IS NULL AND ${schema.comment.hiddenAt} IS NULL`))) as [{ n: number }];
  return c.json({ ...env, forked_from: l.forked_from, stats: { ...env.stats, forks: l.forks, comments }, viewer });
});

/** Public profiles cloned from this one. */
publicRoutes.get("/profiles/:id/forks", async (c) => {
  const row = await getProfile(c.req.param("id"));
  if (!row || !canSee(row, c.get("principal"))) return fail(c, 404, "not_found", "no such profile");
  const rows = await db.select().from(schema.profile)
    .where(and(eq(schema.profile.forkedFromId, row.id), publicWhere())).orderBy(desc(schema.profile.workedCount), desc(schema.profile.updatedAt)).limit(200);
  cacheable(c, 60);
  return c.json({ id: row.id, forks: rows.map((p) => envelope(p)) });
});

publicRoutes.get("/profiles/:id/revisions", async (c) => {
  const row = await getProfile(c.req.param("id"));
  if (!row || !canSee(row, c.get("principal"))) return fail(c, 404, "not_found", "no such profile");
  const revs = await db.select({ revision: schema.profileRevision.revision, hamlib: schema.profileRevision.hamlib, created_at: schema.profileRevision.createdAt })
    .from(schema.profileRevision)
    .where(isPrivileged(row, c.get("principal")) ? eq(schema.profileRevision.profileId, row.id)
      : and(eq(schema.profileRevision.profileId, row.id), lte(schema.profileRevision.revision, row.publishedRevision ?? 0)))
    .orderBy(asc(schema.profileRevision.revision));
  return c.json({ id: row.id, current_revision: row.currentRevision, published_revision: row.publishedRevision, revisions: revs });
});

publicRoutes.get("/profiles/:id/apply-plan", async (c) => {
  const r = await loadVisible(c, c.req.param("id"));
  if ("error" in r) return r.error;
  return c.json(buildPlan(r.rev.document as Profile, { id: r.row.id, revision: r.rev.revision }));
});

/** Dry run. The client reads the radio and posts values keyed by step id. Nothing is stored. */
publicRoutes.post("/profiles/:id/check", async (c) => {
  const r = await loadVisible(c, c.req.param("id"));
  if ("error" in r) return r.error;
  c.header("Cache-Control", "no-store");
  const body = (await c.req.json().catch(() => null)) as { current?: Record<string, Scalar | null> } | null;
  if (!body || typeof body.current !== "object" || body.current === null) return fail(c, 400, "bad_request", 'send {"current": {"<step id>": value}}');
  const plan = buildPlan(r.rev.document as Profile, { id: r.row.id, revision: r.rev.revision });
  return c.json({ profile_id: r.row.id, revision: r.rev.revision, ...checkPlan(plan, body.current) });
});

async function readDocument(c: { req: { header: (n: string) => string | undefined; text: () => Promise<string> } }) {
  const text = await c.req.text();
  return parseProfileText(text);
}

/** Validate a JSON or YAML profile without saving it. */
publicRoutes.post("/validate", async (c) => {
  c.header("Cache-Control", "no-store");
  let doc: unknown;
  try { doc = await readDocument(c); } catch (e) { return fail(c, 400, "parse_error", (e as Error).message); }
  const res = validateProfile(doc);
  return c.json({ ok: res.ok, errors: res.errors, warnings: res.warnings, ...(res.ok ? { normalized: res.profile } : {}) }, res.ok ? 200 : 422);
});

/** Convert between YAML and JSON: POST a document, ?to=yaml|json. */
publicRoutes.post("/convert", async (c) => {
  c.header("Cache-Control", "no-store");
  let doc: unknown;
  try { doc = await readDocument(c); } catch (e) { return fail(c, 400, "parse_error", (e as Error).message); }
  return c.req.query("to") === "yaml"
    ? c.body(toYaml(doc), 200, { "Content-Type": "application/yaml; charset=utf-8" })
    : c.json(doc);
});
