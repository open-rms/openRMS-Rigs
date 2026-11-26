// Relying party for openRMS-Accounts (openRMS-Spec/accounts/identity.md).
// Production verification is @openrms/service-auth (JWKS from OIDC discovery, cached). A local
// JWKS file (DEV_JWKS_FILE, see scripts/dev-token.ts) replaces it only for tests and offline dev.
import { randomBytes } from "node:crypto";
import { hashApiKey, verifyAccessToken as verifyWithAccounts } from "@openrms/service-auth";
import { readFileSync } from "node:fs";
import { createLocalJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";

export type Claims = {
  sub: string;
  callsign?: string;
  callsign_verified?: boolean;
  callsign_verified_method?: string;
  clubs?: { id: string; callsign: string; role: string; verified: boolean }[];
  role?: "user" | "moderator" | "admin" | "superadmin";
};

let devKeys: JWTVerifyGetKey | undefined;
const keysFor = async (_issuer: string): Promise<JWTVerifyGetKey> =>
  (devKeys ??= createLocalJWKSet(JSON.parse(readFileSync(env.DEV_JWKS_FILE, "utf8"))));

export async function verifyAccessToken(token: string, opts: { audience: string; issuers?: string[] }): Promise<Claims> {
  const issuers = opts.issuers ?? env.ISSUERS;
  if (!env.DEV_JWKS_FILE) return (await verifyWithAccounts(token, { audience: opts.audience, issuers })) as unknown as Claims;
  const [, body] = token.split(".");
  const iss = body ? (JSON.parse(Buffer.from(body, "base64url").toString()) as { iss?: string }).iss : undefined;
  if (!iss || !issuers.includes(iss)) throw new Error("untrusted issuer");
  const { payload } = await jwtVerify(token, await keysFor(iss), { issuer: iss, audience: opts.audience });
  if (typeof payload.sub !== "string") throw new Error("token has no sub");
  return payload as unknown as Claims;
}

// ---- ormsr_ API keys (identity.md §5) ----

export const KEY_PREFIX = "ormsr_";
/** Same hashing as every openRMS service (base64url sha256). */
export const hashKey = hashApiKey;

export function mintKey(): { key: string; prefix: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}

export type Principal = { sub: string; callsign?: string; callsignVerified: boolean; role: string; via: "token" | "key"; keyKind?: string };

async function principalFrom(c: Context): Promise<Principal | null> {
  const h = c.req.header("authorization");
  const bearer = h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
  const key = c.req.header("x-api-key") ?? (bearer?.startsWith(KEY_PREFIX) ? bearer : undefined);
  if (key) {
    const [row] = await db.select().from(schema.apiKey)
      .where(and(eq(schema.apiKey.hash, hashKey(key)), isNull(schema.apiKey.revokedAt))).limit(1);
    if (!row) return null;
    await db.update(schema.apiKey).set({ lastUsedAt: new Date() }).where(eq(schema.apiKey.id, row.id));
    // Keys carry no fresh claims: only the owner's sub. Moderation needs a token.
    return { sub: row.ownerSub, callsignVerified: false, role: "user", via: "key", keyKind: row.kind };
  }
  if (!bearer) return null;
  try {
    const cl = await verifyAccessToken(bearer, { audience: env.AUDIENCE });
    return { sub: cl.sub, callsign: cl.callsign, callsignVerified: !!cl.callsign_verified, role: cl.role ?? "user", via: "token" };
  } catch {
    return null;
  }
}

export type AuthEnv = { Variables: { principal: Principal } };

export const requireAuth = (opts: { tokenOnly?: boolean } = {}): MiddlewareHandler<AuthEnv> => async (c, next) => {
  const p = await principalFrom(c);
  if (!p) return c.json({ error: { code: "unauthorized", message: "sign in at openRMS Accounts, or send an ormsr_ key" } }, 401);
  if (opts.tokenOnly && p.via !== "token") return c.json({ error: { code: "forbidden", message: "this needs a signed-in session, not an API key" } }, 403);
  c.set("principal", p);
  await next();
};

const RANK: Record<string, number> = { user: 0, moderator: 1, admin: 2, superadmin: 3 };
export const isModerator = (p: Principal) => p.via === "token" && (RANK[p.role] ?? 0) >= 1;

export type MaybeAuthEnv = { Variables: { principal: Principal | null } };
export const optionalAuth: MiddlewareHandler<MaybeAuthEnv> = async (c, next) => {
  c.set("principal", await principalFrom(c));
  await next();
};
