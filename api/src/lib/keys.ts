// Accounts API keys (ormk_, identity.md §5): the persisted denylist, revocation sync, and
// batched last-use reports. Keys are verified offline in auth.ts.
import { RevocationSync, type RevokedKey } from "@openrms/service-auth";
import { desc, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { accountsConfigured, accountsFetch } from "./accounts.js";

const { keyRevocation } = schema;

/** Key scopes Rigs grants (published at /.well-known/oauth-protected-resource). Staff actions are never key-grantable. */
export const KEY_SCOPES = [
  { scope: "profiles:write", description: "Submit profiles and edit your own" },
  { scope: "profiles:read-private", description: "Read your own pending or hidden profiles" },
  { scope: "favorites", description: "Read and change your private favorites" },
  { scope: "reports:write", description: "Report whether a profile worked for you" },
  { scope: "comments:write", description: "Post, edit and delete your own comments" },
] as const;
export type KeyScope = (typeof KEY_SCOPES)[number]["scope"];

export async function isRevoked(jti: string): Promise<boolean> {
  const [row] = await db.select({ jti: keyRevocation.jti }).from(keyRevocation).where(eq(keyRevocation.jti, jti)).limit(1);
  return !!row;
}

/** Idempotent: the same jti can arrive from the webhook and the pull. */
export async function storeRevoked(keys: RevokedKey[]): Promise<void> {
  if (!keys.length) return;
  await db.insert(keyRevocation)
    .values(keys.map((k) => ({ jti: k.jti, sub: k.sub, exp: new Date(k.exp * 1000), revokedAt: new Date(k.revoked_at) })))
    .onConflictDoNothing();
}

export async function lastSync(): Promise<string | null> {
  const [row] = await db.select({ at: keyRevocation.revokedAt }).from(keyRevocation).orderBy(desc(keyRevocation.revokedAt)).limit(1);
  return row ? row.at.toISOString() : null;
}

/** Expired keys are refused anyway; their rows can go. */
export const pruneRevoked = () => db.delete(keyRevocation).where(lt(keyRevocation.exp, sql`now()`));

// ---- last use, reported in batches (POST /api/v1/keys/used every 5 minutes) ----

const used = new Map<string, string>();
export function noteKeyUse(jti: string) {
  used.set(jti, new Date().toISOString().slice(0, 16) + ":00Z");
}

export async function flushKeyUse(): Promise<number> {
  if (!used.size || !accountsConfigured()) return 0;
  const batch = [...used].map(([jti, at]) => ({ jti, at }));
  used.clear();
  const res = await accountsFetch("/api/v1/keys/used", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch) });
  if (!res.ok) {
    for (const b of batch) if (!used.has(b.jti)) used.set(b.jti, b.at); // try again next time
    throw new Error(`POST /api/v1/keys/used: HTTP ${res.status}`);
  }
  return batch.length;
}

let sync: RevocationSync | undefined;
export const revocationSync = () => sync;

/** Start the denylist pull and the use reports. Without client credentials, keys still verify (fail open) and the webhook still works. */
export async function startKeyServices(): Promise<void> {
  const log = (m: string, e?: unknown) => console.error(`[rigs keys] ${m}`, e ?? "");
  if (!accountsConfigured()) {
    log("ACCOUNTS_CLIENT_SECRET not set: no revocation pull or key-use reports (webhook only)");
    return;
  }
  sync = new RevocationSync({ issuer: env.ISSUERS[0], clientId: env.ACCOUNTS_CLIENT_ID, clientSecret: env.ACCOUNTS_CLIENT_SECRET, store: storeRevoked, lastSync, log });
  await sync.start();
  const t = setInterval(() => {
    flushKeyUse().catch((e) => log("key-use report failed", e));
    pruneRevoked().catch((e) => log("prune failed", e));
  }, 5 * 60_000);
  t.unref();
}

/** For webhook ingestion without client credentials. */
export function ingestor(): Pick<RevocationSync, "ingest"> {
  return sync ?? {
    ingest: async (event) => {
      if (event.type !== "key.revoked") return false;
      const d = event.data as { jti?: string; sub?: string; exp?: number };
      if (!d.jti || !d.sub || typeof d.exp !== "number") throw new Error("malformed key.revoked event");
      await storeRevoked([{ jti: d.jti, sub: d.sub, exp: d.exp, revoked_at: event.createdAt }]);
      return true;
    },
  };
}
