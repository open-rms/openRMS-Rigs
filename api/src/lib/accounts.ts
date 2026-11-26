// Calls to the openRMS Accounts API for services (identity.md §6), with this service's client
// credentials (scope accounts.keys). Used to report key use and list a user's keys.
import { env } from "../env.js";

const issuer = () => env.ISSUERS[0]!.replace(/\/+$/, "");
let cached: { value: string; until: number } | undefined;

export const accountsConfigured = () => !!env.ACCOUNTS_CLIENT_SECRET && env.ISSUERS.length > 0;

async function serviceToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 30_000) return cached.value;
  const disc = (await (await fetch(`${issuer()}/.well-known/openid-configuration`)).json()) as { token_endpoint: string };
  const basic = Buffer.from(`${encodeURIComponent(env.ACCOUNTS_CLIENT_ID)}:${encodeURIComponent(env.ACCOUNTS_CLIENT_SECRET)}`).toString("base64");
  const res = await fetch(disc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: "client_credentials", resource: issuer(), scope: "accounts.keys" }).toString(),
  });
  if (!res.ok) throw new Error(`client credentials: HTTP ${res.status}`);
  const t = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { value: t.access_token, until: Date.now() + (t.expires_in ?? 900) * 1000 };
  return t.access_token;
}

export async function accountsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${issuer()}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await serviceToken()}` },
  });
  if (res.status === 401) cached = undefined;
  return res;
}

/** Where people mint and manage keys. */
export const keysUrl = () => `${issuer()}/keys`;
