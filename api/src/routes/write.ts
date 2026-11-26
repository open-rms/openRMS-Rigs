// Authenticated routes. Identity comes from Accounts JWTs (or ormsr_ keys for agents).
import { Hono } from "hono";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { isModerator, mintKey, requireAuth, type AuthEnv, type Principal } from "../auth.js";
import { fail } from "../lib/http.js";
import { canSee, envelope, getProfile, initialStatus, isPublic, listProfiles, newId, publicWhere } from "../lib/profiles.js";
import { parseProfileText, validateProfile } from "../lib/validate.js";
import type { Context } from "hono";

const { profile, profileRevision, star, report, apiKey, auditLog, favorite } = schema;

export const writeRoutes = new Hono<AuthEnv>();

async function parseBody(c: Context) {
  try {
    const ct = c.req.header("content-type") ?? "";
    const doc = ct.includes("json") ? await c.req.json() : parseProfileText(await c.req.text());
    return { doc };
  } catch (e) {
    return { err: fail(c, 400, "parse_error", (e as Error).message) };
  }
}

writeRoutes.get("/me", requireAuth(), (c) => {
  const p = c.get("principal");
  return c.json({ sub: p.sub, callsign: p.callsign ?? null, callsign_verified: p.callsignVerified, role: p.role, via: p.via, moderator: isModerator(p) });
});

writeRoutes.get("/me/profiles", requireAuth(), async (c) => {
  const { rows, total } = await listProfiles({ mine: true, who: c.get("principal"), limit: 200, offset: 0, sort: "recent" });
  return c.json({ total, profiles: rows.map((r) => envelope(r)) });
});

/**
 * Private favorites (bookmarks), newest first. Only the owner sees them and nothing is counted
 * publicly. ?rig= and ?operation= narrow the list (for apps).
 */
writeRoutes.get("/me/favorites", requireAuth({ tokenOnly: true }), async (c) => {
  const who = c.get("principal");
  const where = [eq(favorite.sub, who.sub), or(publicWhere(), eq(profile.ownerSub, who.sub))!];
  const rig = c.req.query("rig"), op = c.req.query("operation");
  if (rig) where.push(eq(profile.rigMacro, rig));
  if (op) where.push(eq(profile.operation, op));
  const rows = await db.select({ p: profile, at: favorite.createdAt }).from(favorite).innerJoin(profile, eq(profile.id, favorite.profileId))
    .where(and(...where)).orderBy(desc(favorite.createdAt)).limit(500);
  c.header("Cache-Control", "private, no-cache");
  return c.json({ total: rows.length, favorites: rows.map((r) => ({ ...envelope(r.p), saved_at: r.at })) });
});

async function setFavorite(c: Context<AuthEnv>, on: boolean) {
  const who = c.get("principal");
  const row = await getProfile(c.req.param("id")!);
  if (!row || !canSee(row, who)) return fail(c, 404, "not_found", "no such profile");
  if (on) await db.insert(favorite).values({ profileId: row.id, sub: who.sub }).onConflictDoNothing();
  else await db.delete(favorite).where(and(eq(favorite.profileId, row.id), eq(favorite.sub, who.sub)));
  return c.json({ favorite: on });
}
writeRoutes.put("/profiles/:id/favorite", requireAuth({ tokenOnly: true }), (c) => setFavorite(c, true));
writeRoutes.delete("/profiles/:id/favorite", requireAuth({ tokenOnly: true }), (c) => setFavorite(c, false));

writeRoutes.post("/profiles", requireAuth(), async (c) => {
  const who = c.get("principal");
  const b = await parseBody(c);
  if (b.err) return b.err;
  const res = validateProfile(b.doc);
  if (!res.ok || !res.profile) return c.json({ error: { code: "invalid_profile", message: "the profile has errors", details: res.errors }, warnings: res.warnings }, 422);
  const p = res.profile;
  // Clone ("forked from"): ?forked_from=<id>&forked_revision=<n>. The parent must be visible to the author.
  const parentId = c.req.query("forked_from");
  let forkedFromRevision: number | null = null;
  if (parentId) {
    const parent = await getProfile(parentId);
    if (!parent || !canSee(parent, who)) return fail(c, 400, "bad_request", `forked_from: no such profile "${parentId}"`);
    const rq = Number(c.req.query("forked_revision"));
    forkedFromRevision = Number.isInteger(rq) && rq >= 1 && rq <= parent.currentRevision ? rq : parent.publishedRevision ?? parent.currentRevision;
  }
  const id = newId(p);
  const status = initialStatus(p, who);
  const row = await db.transaction(async (tx) => {
    const [row] = await tx.insert(profile).values({
      id, rigMacro: p.rig.macro, operation: p.operation, title: p.title, status, ownerSub: who.sub, ownerCallsign: who.callsign ?? null,
      publishedRevision: status === "published" ? 1 : null,
      forkedFromId: parentId ?? null, forkedFromRevision,
    }).returning();
    await tx.insert(profileRevision).values({ profileId: id, revision: 1, document: p, hamlib: p.hamlib, createdBySub: who.sub });
    return row!;
  });
  return c.json({ ...envelope(row, p), warnings: res.warnings }, 201);
});

/** A new revision. Owner or moderator. Non-staff edits of a published profile with CAT go back to review. */
writeRoutes.put("/profiles/:id", requireAuth(), async (c) => {
  const who = c.get("principal");
  const row = await getProfile(c.req.param("id"));
  if (!row) return fail(c, 404, "not_found", "no such profile");
  if (row.ownerSub !== who.sub && !isModerator(who)) return fail(c, 403, "forbidden", "only the author or a moderator can edit this profile");
  const b = await parseBody(c);
  if (b.err) return b.err;
  const res = validateProfile(b.doc);
  if (!res.ok || !res.profile) return c.json({ error: { code: "invalid_profile", message: "the profile has errors", details: res.errors }, warnings: res.warnings }, 422);
  const p = res.profile;
  if (p.rig.macro !== row.rigMacro) return fail(c, 400, "bad_request", "a revision can't change the rig; create a new profile");
  const next = row.currentRevision + 1;
  // The published revision stays public while an unreviewed edit waits.
  const approved = initialStatus(p, who) === "published";
  const status = row.status === "hidden" ? "hidden" : approved ? "published" : "pending";
  const publishedRevision = approved && row.status !== "hidden" ? next : row.publishedRevision;
  const [updated] = await db.transaction(async (tx) => {
    await tx.insert(profileRevision).values({ profileId: row.id, revision: next, document: p, hamlib: p.hamlib, createdBySub: who.sub });
    return tx.update(profile).set({ currentRevision: next, publishedRevision, title: p.title, operation: p.operation, status, updatedAt: new Date() })
      .where(eq(profile.id, row.id)).returning();
  });
  return c.json({ ...envelope(updated!, p, next), warnings: res.warnings });
});

writeRoutes.put("/profiles/:id/star", requireAuth({ tokenOnly: true }), async (c) => setStar(c, true));
writeRoutes.delete("/profiles/:id/star", requireAuth({ tokenOnly: true }), async (c) => setStar(c, false));

async function setStar(c: Context<AuthEnv>, on: boolean) {
  const who = c.get("principal");
  const row = await getProfile(c.req.param("id")!);
  if (!row || !isPublic(row)) return fail(c, 404, "not_found", "no such profile");
  await db.transaction(async (tx) => {
    const changed = on
      ? await tx.insert(star).values({ profileId: row.id, sub: who.sub }).onConflictDoNothing().returning()
      : await tx.delete(star).where(and(eq(star.profileId, row.id), eq(star.sub, who.sub))).returning();
    if (changed.length) await tx.update(profile).set({ starCount: sql`${profile.starCount} + ${on ? 1 : -1}` }).where(eq(profile.id, row.id));
  });
  const [fresh] = await db.select({ stars: profile.starCount }).from(profile).where(eq(profile.id, row.id));
  return c.json({ starred: on, stars: fresh?.stars ?? 0 });
}

/** "Worked for me" or "didn't work", once per account per revision (re-posting replaces it). */
writeRoutes.post("/profiles/:id/reports", requireAuth({ tokenOnly: true }), async (c) => {
  const who = c.get("principal");
  const row = await getProfile(c.req.param("id"));
  if (!row || !isPublic(row)) return fail(c, 404, "not_found", "no such profile");
  const b = (await c.req.json().catch(() => null)) as { worked?: unknown; firmware?: string; hamlib?: string; interface?: string; note?: string; revision?: number } | null;
  if (!b || typeof b.worked !== "boolean") return fail(c, 400, "bad_request", 'send {"worked": true|false, "firmware"?, "hamlib"?, "interface"?, "note"?}');
  const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const revision = Number.isInteger(b.revision) && b.revision! <= row.publishedRevision! ? b.revision! : row.publishedRevision!;
  await db.transaction(async (tx) => {
    await tx.insert(report).values({
      profileId: row.id, revision, sub: who.sub, callsign: who.callsign ?? null, worked: b.worked as boolean,
      firmware: str(b.firmware, 40), hamlib: str(b.hamlib, 40), interface: str(b.interface, 120), note: str(b.note, 1000),
    }).onConflictDoUpdate({
      target: [report.profileId, report.revision, report.sub],
      set: { worked: b.worked as boolean, firmware: str(b.firmware, 40), hamlib: str(b.hamlib, 40), interface: str(b.interface, 120), note: str(b.note, 1000), createdAt: new Date() },
    });
    await tx.update(profile).set({
      workedCount: sql`(SELECT count(*) FROM report WHERE profile_id = ${row.id} AND worked)::int`,
      notWorkedCount: sql`(SELECT count(*) FROM report WHERE profile_id = ${row.id} AND NOT worked)::int`,
    }).where(eq(profile.id, row.id));
  });
  return c.json({ ok: true }, 201);
});

writeRoutes.get("/profiles/:id/reports", async (c) => {
  const rows = await db.select({
    revision: report.revision, callsign: report.callsign, worked: report.worked, firmware: report.firmware,
    hamlib: report.hamlib, interface: report.interface, note: report.note, created_at: report.createdAt,
  }).from(report).innerJoin(profile, eq(profile.id, report.profileId))
    .where(and(eq(report.profileId, c.req.param("id")), publicWhere()))
    .orderBy(desc(report.createdAt)).limit(200);
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ reports: rows });
});

// ---- ormsr_ keys: signed-in users only, one kind for now ("agent": rig agents that submit profiles) ----

writeRoutes.get("/me/keys", requireAuth({ tokenOnly: true }), async (c) => {
  const rows = await db.select({ id: apiKey.id, prefix: apiKey.prefix, kind: apiKey.kind, name: apiKey.name, created_at: apiKey.createdAt, last_used_at: apiKey.lastUsedAt })
    .from(apiKey).where(and(eq(apiKey.ownerSub, c.get("principal").sub), isNull(apiKey.revokedAt)));
  return c.json({ keys: rows });
});

writeRoutes.post("/me/keys", requireAuth({ tokenOnly: true }), async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = (b.name ?? "").trim().slice(0, 60) || "rig agent";
  const k = mintKey();
  const id = `key_${k.hash.slice(0, 12)}`;
  await db.insert(apiKey).values({ id, prefix: k.prefix, hash: k.hash, kind: "agent", ownerSub: c.get("principal").sub, name });
  return c.json({ id, key: k.key, prefix: k.prefix, kind: "agent", name, note: "Shown once. Store it in a 0600 file." }, 201);
});

writeRoutes.delete("/me/keys/:id", requireAuth({ tokenOnly: true }), async (c) => {
  const done = await db.update(apiKey).set({ revokedAt: new Date() })
    .where(and(eq(apiKey.id, c.req.param("id")), eq(apiKey.ownerSub, c.get("principal").sub), isNull(apiKey.revokedAt))).returning();
  return done.length ? c.body(null, 204) : fail(c, 404, "not_found", "no such key");
});

// ---- moderation ----

writeRoutes.get("/admin/profiles", requireAuth({ tokenOnly: true }), async (c) => {
  const who = c.get("principal");
  if (!isModerator(who)) return fail(c, 403, "forbidden", "moderators only");
  const { rows, total } = await listProfiles({ who, status: c.req.query("status") ?? "pending", limit: 200, offset: 0, sort: "recent" });
  return c.json({ total, profiles: rows.map((r) => envelope(r)) });
});

writeRoutes.post("/admin/profiles/:id/status", requireAuth({ tokenOnly: true }), async (c) => {
  const who: Principal = c.get("principal");
  if (!isModerator(who)) return fail(c, 403, "forbidden", "moderators only");
  const b = (await c.req.json().catch(() => null)) as { status?: string; reason?: string } | null;
  if (!b || !["published", "pending", "hidden"].includes(b.status ?? "")) return fail(c, 400, "bad_request", 'send {"status": "published"|"pending"|"hidden", "reason"?}');
  const [row] = await db.update(profile).set({
    status: b.status!,
    // Approving publishes the latest revision.
    ...(b.status === "published" ? { publishedRevision: sql`${profile.currentRevision}` } : {}),
    updatedAt: new Date(),
  }).where(eq(profile.id, c.req.param("id"))).returning();
  if (!row) return fail(c, 404, "not_found", "no such profile");
  await db.insert(auditLog).values({ actorSub: who.sub, action: `profile.${b.status}`, target: row.id, detail: { reason: b.reason ?? null } });
  return c.json(envelope(row));
});
