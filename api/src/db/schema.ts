// openRMS Rigs tables. Accounts owns identity: we store the account id (`sub`) only, plus a
// callsign snapshot for display. Never key anything on the callsign (moderators can change it).
import { boolean, index, integer, json, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const profile = pgTable("profile", {
  id: text("id").primaryKey(),
  rigMacro: text("rig_macro").notNull(),
  operation: text("operation").notNull(),
  title: text("title").notNull(),
  /** Latest revision (what the author and moderators see). */
  currentRevision: integer("current_revision").notNull().default(1),
  /** Latest reviewed revision, shown to everyone. null until the first one is approved. */
  publishedRevision: integer("published_revision"),
  /** published (current = published), pending (current awaits a moderator), hidden */
  status: text("status").notNull().default("pending"),
  ownerSub: text("owner_sub").notNull(),
  ownerCallsign: text("owner_callsign"),
  /** Cloned from this profile and revision ("forked from"). No FK: the parent may be deleted later. */
  forkedFromId: text("forked_from_id"),
  forkedFromRevision: integer("forked_from_revision"),
  starCount: integer("star_count").notNull().default(0),
  workedCount: integer("worked_count").notNull().default(0),
  notWorkedCount: integer("not_worked_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("profile_rig_op").on(t.rigMacro, t.operation), index("profile_owner").on(t.ownerSub), index("profile_forked_from").on(t.forkedFromId)]);

/** Every edit is a new immutable revision; stars and reports point at exact revisions. */
export const profileRevision = pgTable("profile_revision", {
  profileId: text("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  document: json("document").notNull(),
  hamlib: text("hamlib").notNull(),
  createdBySub: text("created_by_sub").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.profileId, t.revision] })]);

export const star = pgTable("star", {
  profileId: text("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  sub: text("sub").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.profileId, t.sub] })]);

/** "Worked for me" (or not) with the station details that make it useful. */
export const report = pgTable("report", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  sub: text("sub").notNull(),
  callsign: text("callsign"),
  worked: boolean("worked").notNull(),
  firmware: text("firmware"),
  hamlib: text("hamlib"),
  interface: text("interface"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("report_one_per_revision").on(t.profileId, t.revision, t.sub)]);

/** ormsr_ keys (identity.md §5): hashed, kind fixed at creation, owner sub. */
/** Retired ormsr_ keys (identity.md §5.6): read-only since Accounts mints keys; dropped later. */
export const apiKey = pgTable("api_key", {
  id: text("id").primaryKey(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull(),
  kind: text("kind").notNull(),
  ownerSub: text("owner_sub").notNull(),
  /** Owner's callsign when the key was made, so key-submitted profiles are credited. */
  ownerCallsign: text("owner_callsign"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("api_key_hash").on(t.hash), index("api_key_owner").on(t.ownerSub)]);

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actorSub: text("actor_sub").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Private favorites (bookmarks): only the owner sees them; no public count. */
export const favorite = pgTable("favorite", {
  profileId: text("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  sub: text("sub").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.profileId, t.sub] }), index("favorite_sub").on(t.sub, t.createdAt)]);

/** Comments on a profile, one level of replies. Plain text. Soft-deleted by the author, hidden by moderators. */
export const comment = pgTable("comment", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  /** The published revision the commenter was looking at. */
  revision: integer("revision").notNull(),
  parentId: integer("parent_id"),
  sub: text("sub").notNull(),
  callsign: text("callsign"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  hiddenBySub: text("hidden_by_sub"),
}, (t) => [index("comment_profile").on(t.profileId, t.createdAt), index("comment_sub").on(t.sub, t.createdAt)]);

/**
 * Revoked Accounts API keys (identity.md §5.5): a persisted denylist fed by the key.revoked
 * webhook and a pull every 5 minutes. Rows are pruned once the key has expired anyway.
 */
export const keyRevocation = pgTable("key_revocation", {
  jti: text("jti").primaryKey(),
  sub: text("sub").notNull(),
  exp: timestamp("exp", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
}, (t) => [index("key_revocation_revoked_at").on(t.revokedAt)]);

/** Small service state that must survive restarts, e.g. the key-revocation pull cursor. */
export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
