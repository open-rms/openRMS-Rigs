const e = process.env;
const PUBLIC_URL = e.PUBLIC_URL ?? "http://localhost:8790";
export const env = {
  DATABASE_URL: e.DATABASE_URL ?? "postgres://openrms_rigs:openrms_rigs@127.0.0.1:5442/openrms_rigs",
  /** Interface to listen on. Keep 127.0.0.1 behind a reverse proxy on the same host; 0.0.0.0 only when the proxy runs elsewhere. */
  HOST: e.HOST ?? "127.0.0.1",
  PORT: Number(e.PORT ?? 8790),
  /** Public URL of this API; also the JWT audience (identity.md §3). */
  PUBLIC_URL,
  AUDIENCE: e.OPENRMS_AUDIENCE ?? PUBLIC_URL,
  /** Trusted Accounts issuers, comma-separated (identity.md §1). */
  ISSUERS: (e.OPENRMS_ISSUER ?? "http://localhost:8789").split(",").map((s) => s.trim()).filter(Boolean),
  /** Development only: a local JWKS file replaces issuer discovery (see scripts/dev-token.ts). */
  DEV_JWKS_FILE: e.DEV_JWKS_FILE ?? "",
  /** This service's Accounts client (client credentials, scope accounts.keys): denylist pull, key use reports, key list. */
  ACCOUNTS_CLIENT_ID: e.ACCOUNTS_CLIENT_ID ?? "openrms-rigs",
  ACCOUNTS_CLIENT_SECRET: e.ACCOUNTS_CLIENT_SECRET ?? "",
  /** Secret for Accounts webhooks (openrms-signature), POST /api/v1/webhooks/accounts. */
  ACCOUNTS_WEBHOOK_SECRET: e.ACCOUNTS_WEBHOOK_SECRET ?? "",
  SITE_ORIGINS: (e.SITE_ORIGINS ?? "http://localhost:5174").split(",").map((s) => s.trim()).filter(Boolean),
};
