// Account deletion (identity.md §4c): on user.deleted, delete or anonymise everything Rigs holds
// for that sub. Published profiles stay as CC-BY-SA public record, credited as the person chose
// (callsign, "deleted account" or another name). Every row keyed on the sub moves to one tombstone
// per deletion, so the rows stay consistent with each other but can't be linked to the person.
import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const { profile, profileRevision, star, report, favorite, comment, auditLog, apiKey, keyRevocation, accountPref } = schema;

export type DeletionCredit = "callsign" | "deleted" | "name";
export const DELETED_LABEL = "deleted account";
/** A chosen display name: plain text, no links or markup. */
export const NAME_RE = /^[\p{L}\p{N} .,'()\-/]{1,40}$/u;

export async function deleteAccount(sub: string) {
  const tomb = `deleted-${randomBytes(9).toString("base64url")}`;
  return db.transaction(async (tx) => {
    const [pref] = await tx.select().from(accountPref).where(eq(accountPref.sub, sub)).limit(1);
    const owned = await tx.select().from(profile).where(eq(profile.ownerSub, sub));
    const kept = owned.filter((p) => p.publishedRevision !== null && p.status !== "hidden");
    const dropped = owned.filter((p) => !kept.includes(p));

    // Unpublished or hidden profiles go entirely (revisions, stars, reports, favorites, comments cascade).
    if (dropped.length) await tx.delete(profile).where(inArray(profile.id, dropped.map((p) => p.id)));

    for (const p of kept) {
      const credit =
        pref?.deletionCredit === "callsign" ? p.ownerCallsign
        : pref?.deletionCredit === "name" && pref.deletionName ? pref.deletionName
        : DELETED_LABEL;
      // Pending edits never became public record.
      await tx.delete(profileRevision).where(and(eq(profileRevision.profileId, p.id), gt(profileRevision.revision, p.publishedRevision!)));
      await tx.update(profile).set({ ownerSub: tomb, ownerCallsign: credit, currentRevision: p.publishedRevision!, status: "published" })
        .where(eq(profile.id, p.id));
    }
    await tx.update(profileRevision).set({ createdBySub: tomb }).where(eq(profileRevision.createdBySub, sub));

    // Private bookmarks and public stars go; star counts are recomputed.
    await tx.delete(favorite).where(eq(favorite.sub, sub));
    const starred = await tx.delete(star).where(eq(star.sub, sub)).returning({ profileId: star.profileId });
    for (const id of new Set(starred.map((s) => s.profileId))) {
      await tx.update(profile).set({ starCount: sql`(SELECT count(*) FROM star WHERE profile_id = ${id})::int` }).where(eq(profile.id, id));
    }

    // "Worked" votes keep their signal, without the person or their words.
    const reports = await tx.update(report).set({ sub: tomb, callsign: null, note: null }).where(eq(report.sub, sub)).returning({ id: report.id });

    // Comments: soft-deleted like an author's own delete, so reply threads stay.
    const comments = await tx.update(comment).set({ sub: tomb, callsign: null, body: "", deletedAt: sql`coalesce(${comment.deletedAt}, now())` })
      .where(eq(comment.sub, sub)).returning({ id: comment.id });
    await tx.update(comment).set({ hiddenBySub: tomb }).where(eq(comment.hiddenBySub, sub));

    await tx.update(auditLog).set({ actorSub: tomb }).where(eq(auditLog.actorSub, sub));
    await tx.delete(apiKey).where(eq(apiKey.ownerSub, sub));
    // Revoked keys stay refused until they expire.
    await tx.update(keyRevocation).set({ sub: tomb }).where(eq(keyRevocation.sub, sub));
    await tx.delete(accountPref).where(eq(accountPref.sub, sub));

    const summary = { kept: kept.length, deleted: dropped.length, stars: starred.length, reports: reports.length, comments: comments.length };
    if (owned.length || starred.length || reports.length || comments.length) {
      await tx.insert(auditLog).values({ actorSub: tomb, action: "account.deleted", target: tomb, detail: summary });
    }
    return summary;
  });
}

/** Everything Rigs holds for one account (identity.md §4c: each service exports its own data). */
export async function exportAccount(sub: string) {
  const profiles = await db.select().from(profile).where(eq(profile.ownerSub, sub));
  const ids = profiles.map((p) => p.id);
  const revisions = ids.length ? await db.select().from(profileRevision).where(inArray(profileRevision.profileId, ids)) : [];
  const [pref] = await db.select().from(accountPref).where(eq(accountPref.sub, sub)).limit(1);
  return {
    exported_at: new Date().toISOString(),
    service: "openRMS Rigs",
    sub,
    profiles: profiles.map((p) => ({ ...p, revisions: revisions.filter((r) => r.profileId === p.id) })),
    favorites: await db.select().from(favorite).where(eq(favorite.sub, sub)),
    stars: await db.select().from(star).where(eq(star.sub, sub)),
    reports: await db.select().from(report).where(eq(report.sub, sub)),
    comments: await db.select().from(comment).where(eq(comment.sub, sub)),
    deletion_preference: pref ? { credit: pref.deletionCredit, name: pref.deletionName } : { credit: "deleted", name: null },
  };
}
