import { and, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import type { Principal } from "../auth.js";
import { isModerator } from "../auth.js";
import type { Profile } from "./profile.js";

const { profile, profileRevision } = schema;
export type ProfileRow = typeof profile.$inferSelect;

export function newId(p: Profile): string {
  const base = `${p.rig.name}-${p.operation}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export const isPublic = (row: ProfileRow) => row.status !== "hidden" && row.publishedRevision !== null;
export const isPrivileged = (row: ProfileRow, who: Principal | null) => !!who && (who.sub === row.ownerSub || isModerator(who));

export function canSee(row: ProfileRow, who: Principal | null): boolean {
  return isPublic(row) || isPrivileged(row, who);
}

/** The revision a reader gets by default: latest for the author and moderators, else the published one. */
export const defaultRevision = (row: ProfileRow, who: Principal | null) =>
  isPrivileged(row, who) ? row.currentRevision : row.publishedRevision;

/** Public visibility condition for SQL queries. */
export const publicWhere = () => and(sql`${profile.publishedRevision} IS NOT NULL`, ne(profile.status, "hidden"))!;

export function envelope(row: ProfileRow, document?: unknown, revision: number = row.publishedRevision ?? row.currentRevision) {
  const self = `${env.PUBLIC_URL}/api/v1/profiles/${row.id}`;
  const doc = document as Profile | undefined;
  return {
    id: row.id,
    revision,
    current_revision: row.currentRevision,
    published_revision: row.publishedRevision,
    status: row.status,
    title: row.title,
    rig_macro: row.rigMacro,
    operation: row.operation,
    author: { callsign: row.ownerCallsign },
    stats: { stars: row.starCount, worked: row.workedCount, not_worked: row.notWorkedCount },
    forked_from: row.forkedFromId ? { id: row.forkedFromId, revision: row.forkedFromRevision } : null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    links: { self, json: `${self}.json`, yaml: `${self}.yaml`, apply_plan: `${self}/apply-plan`, check: `${self}/check` },
    ...(doc ? { document: doc } : {}),
  };
}

export async function getProfile(id: string) {
  const [row] = await db.select().from(profile).where(eq(profile.id, id)).limit(1);
  return row;
}

/** Parent details and fork count for one profile page. A hidden or deleted parent shows as unavailable. */
export async function lineage(row: ProfileRow, who: Principal | null) {
  let forked_from = null;
  if (row.forkedFromId) {
    const parent = await getProfile(row.forkedFromId);
    forked_from = parent && canSee(parent, who)
      ? { id: parent.id, revision: row.forkedFromRevision, title: parent.title, author: { callsign: parent.ownerCallsign }, rig_macro: parent.rigMacro, available: true }
      : { id: row.forkedFromId, revision: row.forkedFromRevision, available: false };
  }
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(profile)
    .where(and(eq(profile.forkedFromId, row.id), publicWhere()))) as [{ n: number }];
  return { forked_from, forks: n };
}

export async function getRevision(id: string, revision: number) {
  const [rev] = await db.select().from(profileRevision)
    .where(and(eq(profileRevision.profileId, id), eq(profileRevision.revision, revision))).limit(1);
  return rev;
}

export type ListQuery = { rig?: string; operation?: string; q?: string; sort?: string; limit: number; offset: number; who: Principal | null; mine?: boolean; status?: string };

export async function listProfiles(o: ListQuery) {
  const where: SQL[] = [];
  if (o.mine && o.who) where.push(eq(profile.ownerSub, o.who.sub));
  else if (o.status && o.who && isModerator(o.who)) where.push(eq(profile.status, o.status));
  else where.push(publicWhere());
  if (o.rig) where.push(eq(profile.rigMacro, o.rig));
  if (o.operation) where.push(eq(profile.operation, o.operation));
  if (o.q) where.push(or(ilike(profile.title, `%${o.q}%`), ilike(profile.rigMacro, `%${o.q}%`))!);
  const order =
    o.sort === "stars" ? [desc(profile.starCount), desc(profile.workedCount)]
    : o.sort === "recent" ? [desc(profile.updatedAt)]
    : [desc(sql`${profile.workedCount} - ${profile.notWorkedCount}`), desc(profile.starCount), desc(profile.updatedAt)];
  const rows = await db.select().from(profile).where(and(...where)).orderBy(...order).limit(o.limit).offset(o.offset);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(profile).where(and(...where))) as [{ n: number }];
  return { rows, total: n };
}

/** Who may publish without review: verified callsigns and staff. Raw CAT always goes through the queue (audited approval). */
export function initialStatus(p: Profile, who: Principal): "published" | "pending" {
  if (p.steps.some((s) => s.kind === "cat")) return "pending";
  return isModerator(who) || who.callsignVerified ? "published" : "pending";
}
