// Comments on profiles. Plain text (clients must render it as text, never HTML), one level of
// replies. Authors edit or delete their own; moderators hide. Deleted or hidden comments that
// have replies stay as placeholders so the thread still reads.
import { Hono, type Context } from "hono";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { isModerator, optionalAuth, requireAuth, type AuthEnv, type MaybeAuthEnv, type Principal } from "../auth.js";
import { fail } from "../lib/http.js";
import { canSee, getProfile, isPrivileged, isPublic } from "../lib/profiles.js";

const { comment, auditLog } = schema;
const MAX_LEN = 4000;
type Row = typeof comment.$inferSelect;

export const commentRoutes = new Hono();

function view(r: Row, who: Principal | null) {
  const removed = !!r.deletedAt || !!r.hiddenAt;
  const mod = !!who && isModerator(who);
  return {
    id: r.id,
    parent_id: r.parentId,
    revision: r.revision,
    author: { callsign: removed && !mod ? null : r.callsign },
    body: removed && !mod ? null : r.body,
    created_at: r.createdAt,
    edited_at: r.editedAt,
    deleted: !!r.deletedAt,
    hidden: !!r.hiddenAt,
    mine: !!who && who.sub === r.sub,
  };
}

commentRoutes.get("/profiles/:id/comments", optionalAuth, async (c: Context<MaybeAuthEnv>) => {
  const who = c.get("principal");
  const row = await getProfile(c.req.param("id")!);
  if (!row || !canSee(row, who)) return fail(c, 404, "not_found", "no such profile");
  const rows = await db.select().from(comment).where(eq(comment.profileId, row.id)).orderBy(asc(comment.createdAt)).limit(1000);
  const mod = !!who && isModerator(who);
  const hasReplies = new Set(rows.filter((r) => r.parentId && !r.deletedAt && !r.hiddenAt).map((r) => r.parentId));
  const shown = rows.filter((r) => mod || (!r.deletedAt && !r.hiddenAt) || (r.parentId === null && hasReplies.has(r.id)));
  const top = shown.filter((r) => r.parentId === null).map((r) => ({ ...view(r, who), replies: shown.filter((x) => x.parentId === r.id).map((x) => view(x, who)) }));
  c.header("Cache-Control", who ? "private, no-cache" : "public, max-age=30");
  return c.json({ profile_id: row.id, count: rows.filter((r) => !r.deletedAt && !r.hiddenAt).length, comments: top });
});

const body = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  // Normalize line endings, strip control characters other than newline and tab.
  const t = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  return t.length >= 1 && t.length <= MAX_LEN ? t : null;
};

commentRoutes.post("/profiles/:id/comments", requireAuth({ tokenOnly: true }), async (c: Context<AuthEnv>) => {
  const who = c.get("principal");
  const row = await getProfile(c.req.param("id")!);
  if (!row || !(isPublic(row) || isPrivileged(row, who))) return fail(c, 404, "not_found", "no such profile");
  const b = (await c.req.json().catch(() => null)) as { body?: unknown; parent_id?: unknown } | null;
  const text = body(b?.body);
  if (!text) return fail(c, 400, "bad_request", `send {"body": "1-${MAX_LEN} characters", "parent_id"?}`);
  let parentId: number | null = null;
  if (b?.parent_id !== undefined && b.parent_id !== null) {
    const [parent] = await db.select().from(comment).where(and(eq(comment.id, Number(b.parent_id)), eq(comment.profileId, row.id))).limit(1);
    if (!parent || parent.parentId !== null || parent.deletedAt || parent.hiddenAt) return fail(c, 400, "bad_request", "replies go under an existing top-level comment");
    parentId = parent.id;
  }
  // Simple flood limits per account.
  const recent = async (sec: number) => ((await db.select({ n: sql<number>`count(*)::int` }).from(comment)
    .where(and(eq(comment.sub, who.sub), gt(comment.createdAt, new Date(Date.now() - sec * 1000))))) as [{ n: number }])[0].n;
  if ((await recent(60)) >= 5 || (await recent(86400)) >= 100) return fail(c, 429, "rate_limited", "too many comments; try again later");
  const [r] = await db.insert(comment).values({
    profileId: row.id, revision: row.publishedRevision ?? row.currentRevision, parentId, sub: who.sub, callsign: who.callsign ?? null, body: text,
  }).returning();
  return c.json(view(r!, who), 201);
});

async function own(c: Context<AuthEnv>) {
  const [r] = await db.select().from(comment).where(eq(comment.id, Number(c.req.param("cid")))).limit(1);
  return r;
}

commentRoutes.patch("/comments/:cid", requireAuth({ tokenOnly: true }), async (c: Context<AuthEnv>) => {
  const who = c.get("principal");
  const r = await own(c);
  if (!r || r.deletedAt) return fail(c, 404, "not_found", "no such comment");
  if (r.sub !== who.sub) return fail(c, 403, "forbidden", "only the author can edit a comment");
  if (r.hiddenAt) return fail(c, 403, "forbidden", "a moderator hid this comment");
  const text = body(((await c.req.json().catch(() => null)) as { body?: unknown } | null)?.body);
  if (!text) return fail(c, 400, "bad_request", `send {"body": "1-${MAX_LEN} characters"}`);
  const [u] = await db.update(comment).set({ body: text, editedAt: new Date() }).where(eq(comment.id, r.id)).returning();
  return c.json(view(u!, who));
});

commentRoutes.delete("/comments/:cid", requireAuth({ tokenOnly: true }), async (c: Context<AuthEnv>) => {
  const who = c.get("principal");
  const r = await own(c);
  if (!r || r.deletedAt) return fail(c, 404, "not_found", "no such comment");
  if (r.sub !== who.sub && !isModerator(who)) return fail(c, 403, "forbidden", "only the author or a moderator can delete a comment");
  await db.update(comment).set({ deletedAt: new Date() }).where(eq(comment.id, r.id));
  if (r.sub !== who.sub) await db.insert(auditLog).values({ actorSub: who.sub, action: "comment.delete", target: String(r.id), detail: { profile: r.profileId } });
  return c.body(null, 204);
});

commentRoutes.post("/admin/comments/:cid/hide", requireAuth({ tokenOnly: true }), async (c: Context<AuthEnv>) => {
  const who = c.get("principal");
  if (!isModerator(who)) return fail(c, 403, "forbidden", "moderators only");
  const r = await own(c);
  if (!r) return fail(c, 404, "not_found", "no such comment");
  const b = (await c.req.json().catch(() => ({}))) as { hidden?: boolean; reason?: string };
  const hide = b.hidden !== false;
  await db.update(comment).set(hide ? { hiddenAt: new Date(), hiddenBySub: who.sub } : { hiddenAt: null, hiddenBySub: null }).where(eq(comment.id, r.id));
  await db.insert(auditLog).values({ actorSub: who.sub, action: hide ? "comment.hide" : "comment.unhide", target: String(r.id), detail: { profile: r.profileId, reason: b.reason ?? null } });
  return c.json({ id: r.id, hidden: hide });
});
