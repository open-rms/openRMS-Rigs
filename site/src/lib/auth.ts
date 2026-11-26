// Sign-in comes from openRMS Accounts (openRMS-Spec/accounts/identity.md §3a): the shared
// .openrms.dev session cookie lets this page fetch a short-lived JWT for the Rigs audience.
// The dev box on /account can also hold a pasted token (e.g. from the API's stub issuer for tests).
import { writable, get } from "svelte/store";

const envs = import.meta.env as Record<string, string | undefined>;
export const ISSUER = envs.VITE_OPENRMS_ISSUER ?? "http://localhost:8789";
export const AUDIENCE = envs.VITE_RIGS_AUDIENCE ?? "http://localhost:8790";
/** Accounts sign-in page; it returns to `next` (trusted origins only) with the session cookie set. */
const SIGNIN = envs.VITE_SIGNIN_URL ?? `${ISSUER}/login`;
const DEV_KEY = "rigs.devToken";

type Cached = { token: string; exp: number };
let cached: Cached | null = null;

export type Me = { sub: string; callsign: string | null; callsign_verified: boolean; role: string; moderator: boolean };
export const me = writable<Me | null>(null);

function expOf(token: string): number {
  try { return (JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))).exp as number) * 1000; } catch { return 0; }
}

export async function accessToken(): Promise<string | null> {
  if (cached && cached.exp - Date.now() > 60_000) return cached.token;
  // A pasted test token wins only while it's valid; an expired one is dropped so the real
  // Accounts session is used (a stale one used to leave people looking signed out).
  const dev = localStorage.getItem(DEV_KEY);
  if (dev) {
    if (expOf(dev) - Date.now() > 30_000) {
      cached = { token: dev, exp: expOf(dev) };
      return dev;
    }
    localStorage.removeItem(DEV_KEY);
  }
  try {
    const r = await fetch(`${ISSUER}/api/v1/token?aud=${encodeURIComponent(AUDIENCE)}`, { credentials: "include" });
    if (!r.ok) return null;
    const { token } = (await r.json()) as { token: string };
    cached = { token, exp: expOf(token) };
    return token;
  } catch {
    return null;
  }
}

export function setDevToken(token: string | null) {
  cached = null;
  if (token) localStorage.setItem(DEV_KEY, token.trim());
  else localStorage.removeItem(DEV_KEY);
}

export const signInUrl = () => `${SIGNIN}?next=${encodeURIComponent(location.href)}`;
export const signUpUrl = () => `${ISSUER}/signup?next=${encodeURIComponent(location.href)}`;
export const accountUrl = () => `${ISSUER}/account`;

/** Ends the Accounts session (shared by every openRMS app on this domain). */
export async function signOut() {
  setDevToken(null);
  try {
    await fetch(`${ISSUER}/api/auth/sign-out`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
  } finally {
    cached = null;
    me.set(null);
  }
}

/** Forget the cached token, e.g. after signing in or out in another tab. */
export const resetToken = () => { cached = null; };
export const isSignedIn = () => !!get(me);
