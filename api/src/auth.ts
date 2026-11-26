// Relying party for openRMS-Accounts (openRMS-Spec/accounts/identity.md).
// Production verification is @openrms/service-auth: access tokens and Accounts API keys
// (ormk_, §5) both verify offline against the issuer's JWKS. A local JWKS file (DEV_JWKS_FILE,
// see scripts/dev-token.ts) replaces discovery only for tests and offline dev.
import { KEY_PREFIX, KEY_TYP, TokenError, verifyBearer } from "@openrms/service-auth";
import { readFileSync } from "node:fs";
import { createLocalJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Context, MiddlewareHandler } from "hono";
import { env } from "./env.js";
import { isRevoked, noteKeyUse, type KeyScope } from "./lib/keys.js";
import { keysUrl } from "./lib/accounts.js";

export type Claims = {
  sub: string;
  callsign?: string;
  callsign_verified?: boolean;
  callsign_verified_method?: string;
  clubs?: { id: string; callsign: string; role: string; verified: boolean }[];
  role?: "user" | "moderator" | "admin" | "superadmin";
  /** Scope `radios` (identity.md §4): Hamlib macros of the user's radios, primary first, at most 20. */
  radios?: string[];
};
type KeyClaims = { sub: string; aud: string; scope: string[]; jti: string; exp: number; callsign?: string };
type Verified = { kind: "access"; claims: Claims } | { kind: "key"; claims: KeyClaims };

let devKeys: JWTVerifyGetKey | undefined;
const devKeySet = (): JWTVerifyGetKey => (devKeys ??= createLocalJWKSet(JSON.parse(readFileSync(env.DEV_JWKS_FILE, "utf8"))));

/** Development/test twin of service-auth's verifyBearer, against the local JWKS. */
async function verifyDev(token: string, audience: string): Promise<Verified> {
  const isKey = token.startsWith(KEY_PREFIX);
  const jwt = isKey ? token.slice(KEY_PREFIX.length) : token;
  const [, body] = jwt.split(".");
  const iss = body ? (JSON.parse(Buffer.from(body, "base64url").toString()) as { iss?: string }).iss : undefined;
  if (!iss || !env.ISSUERS.includes(iss)) throw new TokenError("untrusted issuer", "untrusted_issuer");
  const { payload, protectedHeader } = await jwtVerify(jwt, devKeySet(), { issuer: iss, audience });
  if (typeof payload.sub !== "string") throw new TokenError("token has no sub", "invalid");
  if (!isKey) {
    if (protectedHeader.typ === KEY_TYP || payload.token_use === "api_key") throw new TokenError("an API key needs the ormk_ prefix", "invalid");
    return { kind: "access", claims: payload as unknown as Claims };
  }
  if (protectedHeader.typ !== KEY_TYP || payload.token_use !== "api_key") throw new TokenError("not an API key", "invalid");
  if (typeof payload.jti !== "string" || !payload.jti) throw new TokenError("API key has no jti", "invalid");
  if (Array.isArray(payload.aud) && payload.aud.length !== 1) throw new TokenError("an API key has exactly one audience", "invalid");
  if (await isRevoked(payload.jti)) throw new TokenError("API key revoked", "revoked");
  const scope = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : ((payload.scope as string[]) ?? []);
  return { kind: "key", claims: { ...(payload as unknown as KeyClaims), aud: audience, scope } };
}

async function verify(token: string): Promise<Verified> {
  if (env.DEV_JWKS_FILE) return verifyDev(token, env.AUDIENCE);
  const r = await verifyBearer(token, { audience: env.AUDIENCE, issuers: env.ISSUERS, isRevoked });
  if (r.kind === "access") return { kind: "access", claims: r.claims as unknown as Claims };
  const scope = Array.isArray(r.claims.scope) ? r.claims.scope : String(r.claims.scope ?? "").split(" ").filter(Boolean);
  return { kind: "key", claims: { ...r.claims, scope } };
}

/** Access tokens (for Rigs' audience) only, e.g. for scripts/tests that need one. */
export async function verifyAccessToken(token: string): Promise<Claims> {
  const r = await verify(token);
  if (r.kind !== "access") throw new TokenError("an access token is needed", "invalid");
  return r.claims;
}

export type Principal = {
  sub: string;
  callsign?: string;
  callsignVerified: boolean;
  role: string;
  via: "token" | "key";
  /** Key scopes (via "key" only). */
  scopes?: string[];
  jti?: string;
  /** The user's radios (Hamlib macros, primary first) from a first-party token; keys carry none. */
  radios?: string[];
};

const MACRO = /^RIG_MODEL_[A-Z0-9_]{1,40}$/;
const radiosOf = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const r = [...new Set(v.filter((m): m is string => typeof m === "string" && MACRO.test(m)))].slice(0, 20);
  return r.length ? r : undefined;
};

/** Rigs' own ormsr_ keys were retired when Accounts started minting keys (identity.md §5.6). */
const RETIRED = /^ormsr_/;
type Outcome = { principal: Principal } | { error: string } | null;

async function principalFrom(c: Context): Promise<Outcome> {
  const h = c.req.header("authorization");
  const bearer = h && /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, "").trim() : undefined;
  if (c.req.header("x-api-key") || (bearer && RETIRED.test(bearer))) {
    return { error: `Rigs API keys (ormsr_) are retired. Make an openRMS key for Rigs at ${keysUrl()} and send it as Authorization: Bearer ormk_…` };
  }
  if (!bearer) return null;
  try {
    const r = await verify(bearer);
    if (r.kind === "key") {
      noteKeyUse(r.claims.jti);
      // Keys never carry staff rights or fresh verification: role user, data keyed on sub.
      return { principal: { sub: r.claims.sub, callsign: r.claims.callsign, callsignVerified: false, role: "user", via: "key", scopes: r.claims.scope, jti: r.claims.jti } };
    }
    const cl = r.claims;
    return { principal: { sub: cl.sub, callsign: cl.callsign, callsignVerified: !!cl.callsign_verified, role: cl.role ?? "user", via: "token", radios: radiosOf(cl.radios) } };
  } catch (e) {
    if (e instanceof TokenError && e.code === "revoked") return { error: "this API key has been revoked" };
    return null;
  }
}

export const hasScope = (p: Principal, scope: KeyScope) => p.via === "token" || !!p.scopes?.includes(scope);

export type AuthEnv = { Variables: { principal: Principal } };

/**
 * `scope`: the key scope a route needs (access tokens always pass).
 * `tokenOnly`: staff routes and anything not key-grantable; keys get 403 whatever their scopes.
 */
export const requireAuth = (opts: { tokenOnly?: boolean; scope?: KeyScope } = {}): MiddlewareHandler<AuthEnv> => async (c, next) => {
  const o = await principalFrom(c);
  if (!o || "error" in o) {
    return c.json({ error: { code: "unauthorized", message: o?.error ?? `sign in at openRMS Accounts, or send an openRMS API key (ormk_…) from ${keysUrl()}` } }, 401);
  }
  const p = o.principal;
  if (opts.tokenOnly && p.via !== "token") return c.json({ error: { code: "forbidden", message: "this needs a signed-in session, not an API key" } }, 403);
  if (opts.scope && !hasScope(p, opts.scope)) return c.json({ error: { code: "insufficient_scope", message: `this API key needs the ${opts.scope} scope` } }, 403);
  c.set("principal", p);
  await next();
};

const RANK: Record<string, number> = { user: 0, moderator: 1, admin: 2, superadmin: 3 };
export const isModerator = (p: Principal) => p.via === "token" && (RANK[p.role] ?? 0) >= 1;

export type MaybeAuthEnv = { Variables: { principal: Principal | null } };
/** Public reads. A key without profiles:read-private reads like an anonymous visitor. */
export const optionalAuth: MiddlewareHandler<MaybeAuthEnv> = async (c, next) => {
  const o = await principalFrom(c);
  const p = o && "principal" in o ? o.principal : null;
  c.set("principal", p && hasScope(p, "profiles:read-private") ? p : null);
  await next();
};
