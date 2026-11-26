import { accessToken } from "./auth.ts";

export type Scalar = number | boolean | string;
export type RigSummary = { macro: string; hamlib_model: number; mfg: string; name: string; status: string; pseudo: boolean; profiles: number; yours?: boolean };
/** One of the user's radios ("My radios" at openRMS Accounts). */
export type MyRadio = { model: string; hamlib_model: number | null; label: string | null; primary: boolean; mfg: string | null; name: string | null; profiles: number };
export type Control = { range: { min: number; max: number; step: number } | null; choices?: string[]; unit?: string };
export type Rig = RigSummary & {
  backend_version: string; caps_available: boolean; hamlib: string;
  caps: { modes: string[]; agc_levels: Record<string, string>; funcs: { get: string[]; set: string[] }; levels: { get: Record<string, Control>; set: Record<string, Control> }; parms: { get: Record<string, Control>; set: Record<string, Control> } };
  /** What a profile may use on this radio (the validator's rules). */
  profile: {
    settable_levels: string[]; checkable_levels: string[]; settable_funcs: string[]; checkable_funcs: string[];
    settable_parms: string[]; tx_levels: string[]; tx_funcs: string[]; refused_funcs: string[]; cat_protocol: "ascii" | "civ";
  };
};
export type Step = {
  id: string; kind: "mode" | "level" | "func" | "parm" | "cat" | "manual"; name: string; value?: Scalar; passband_hz?: number;
  expect?: { min?: number; max?: number; one_of?: Scalar[]; not?: Scalar[] }; check_only?: boolean; safety?: "rx" | "tx";
  unit?: string; display?: string; cat?: { protocol: "ascii" | "civ"; read?: string; reply?: string; set?: string; values?: Record<string, string> };
  manual?: { menu: string; value: string; image?: string }; menu?: string[]; note?: string;
  sources?: string[]; confidence?: "high" | "medium" | "low";
};
export type Source = { id: string; title: string; author?: string; url?: string; date?: string; note?: string };
export type ProfileDoc = {
  schema: string; title: string; summary?: string; rig: { macro: string; hamlib_model: number; mfg: string; name: string; firmware?: string };
  operation: string; connection: string; interface?: string; hamlib: string;
  audio?: { rx_target_dbfs?: number; rx_note?: string; tx_note?: string }; steps: Step[];
  software?: { app: string; setting: string; value: string; note?: string }[]; sources?: Source[]; notes?: string; tags?: string[];
};
export type Envelope = {
  id: string; revision: number; current_revision: number; published_revision: number | null; status: string; title: string;
  rig_macro: string; operation: string; author: { callsign: string | null }; stats: { stars: number; worked: number; not_worked: number; forks?: number; comments?: number };
  forked_from: null | { id: string; revision: number | null; title?: string; author?: { callsign: string | null }; rig_macro?: string; available?: boolean };
  created_at: string; updated_at: string; links: Record<string, string>; document?: ProfileDoc;
  /** Signed-in reader's own state (single profile responses). */
  viewer?: null | { favorite: boolean; starred: boolean; starred_at: string | null; report: { worked: boolean; revision: number } | null; owner: boolean };
};
export type PlanStep = {
  id: string; kind: string; name: string; safety: "rx" | "tx"; readable: boolean; check_only: boolean; rigctld: { get: string | null; set: string | null };
  text: string; note?: string; unit?: string; menu?: string[]; tolerance?: number;
  cat?: { protocol: "ascii" | "civ"; read?: string; reply?: string; set?: string; set_command?: string };
};
/** Key metadata from Accounts (identity.md §5.1); never the key itself. */
export type AccountKey = { jti: string; aud?: string; name?: string; scopes?: string[]; created_at?: string; expires_at?: string; last_used_at?: string | null; revoked_at?: string | null; renewable?: boolean; replaced_by?: string | null };
export type Issue = { path: string; message: string };
export type Comment = {
  id: number; parent_id: number | null; revision: number; author: { callsign: string | null }; body: string | null;
  created_at: string; edited_at: string | null; deleted: boolean; hidden: boolean; mine: boolean; replies?: Comment[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

async function call<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.auth !== false) {
    const t = await accessToken();
    if (t) headers.set("Authorization", `Bearer ${t}`);
  }
  const r = await fetch(`/api/v1${path}`, { ...init, headers });
  const ct = r.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok && r.status !== 422) throw new ApiError(r.status, (body as any)?.error?.message ?? r.statusText, (body as any)?.error?.details);
  return body as T;
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  operations: () => call<{ operations: string[] }>("/operations", { auth: false }),
  /** Signed in: the user's radios rank first (and carry `yours`). */
  rigs: (q?: string) => call<{ hamlib: string; count: number; rigs: RigSummary[] }>(`/rigs${qs({ q })}`),
  myRadios: () => call<{ source: string; radios: MyRadio[] }>("/me/radios"),
  rig: (macro: string) => call<Rig>(`/rigs/${encodeURIComponent(macro)}`, { auth: false }),
  /** For editors: revalidate (ETag) instead of trusting the HTTP cache, and fill in hints an older API lacks. */
  rigForEditor: async (macro: string) => {
    const r = await call<Rig>(`/rigs/${encodeURIComponent(macro)}`, { auth: false, cache: "no-cache" });
    r.profile ??= {
      settable_levels: Object.keys(r.caps.levels.set), checkable_levels: Object.keys(r.caps.levels.get),
      settable_funcs: r.caps.funcs.set, checkable_funcs: r.caps.funcs.get, settable_parms: Object.keys(r.caps.parms.set),
      tx_levels: [], tx_funcs: [], refused_funcs: [], cat_protocol: r.mfg === "Icom" ? "civ" : "ascii",
    };
    return r;
  },
  profiles: (o: { rig?: string; operation?: string; q?: string; sort?: string; limit?: number }) =>
    call<{ total: number; profiles: Envelope[] }>(`/profiles${qs(o)}`, { auth: false }),
  profile: (id: string, revision?: number) => call<Envelope>(`/profiles/${id}${qs({ revision })}`),
  plan: (id: string) => call<{ steps: PlanStep[] }>(`/profiles/${id}/apply-plan`),
  yaml: (id: string) => call<string>(`/profiles/${id}.yaml`),
  validate: (text: string) => call<{ ok: boolean; errors: Issue[]; warnings: Issue[] }>("/validate", { method: "POST", body: text, headers: { "content-type": "application/yaml" }, auth: false }),
  create: (text: string, fork?: { id: string; revision: number }) =>
    call<Envelope & { error?: { message: string; details?: Issue[] }; warnings?: Issue[] }>(`/profiles${fork ? qs({ forked_from: fork.id, forked_revision: fork.revision }) : ""}`, { method: "POST", body: text, headers: { "content-type": "application/yaml" } }),
  favorites: (o: { rig?: string; operation?: string } = {}) => call<{ total: number; favorites: (Envelope & { saved_at: string })[] }>(`/me/favorites${qs(o)}`),
  favorite: (id: string, on: boolean) => call<{ favorite: boolean }>(`/profiles/${id}/favorite`, { method: on ? "PUT" : "DELETE" }),
  comments: (id: string) => call<{ count: number; comments: Comment[] }>(`/profiles/${id}/comments`),
  postComment: (id: string, body: string, parent_id?: number) =>
    call<Comment>(`/profiles/${id}/comments`, { method: "POST", body: JSON.stringify({ body, parent_id }), headers: { "content-type": "application/json" } }),
  editComment: (cid: number, body: string) => call<Comment>(`/comments/${cid}`, { method: "PATCH", body: JSON.stringify({ body }), headers: { "content-type": "application/json" } }),
  deleteComment: (cid: number) => call<null>(`/comments/${cid}`, { method: "DELETE" }),
  hideComment: (cid: number, hidden: boolean) => call<{ hidden: boolean }>(`/admin/comments/${cid}/hide`, { method: "POST", body: JSON.stringify({ hidden }), headers: { "content-type": "application/json" } }),
  forks: (id: string) => call<{ forks: Envelope[] }>(`/profiles/${id}/forks`, { auth: false }),
  yamlAt: (id: string, revision: number) => call<string>(`/profiles/${id}.yaml${qs({ revision })}`),
  update: (id: string, text: string) => call<Envelope & { error?: { message: string; details?: Issue[] }; warnings?: Issue[] }>(`/profiles/${id}`, { method: "PUT", body: text, headers: { "content-type": "application/yaml" } }),
  star: (id: string, on: boolean) => call<{ starred: boolean; stars: number }>(`/profiles/${id}/star`, { method: on ? "PUT" : "DELETE" }),
  report: (id: string, body: { worked: boolean; firmware?: string; hamlib?: string; interface?: string; note?: string }) =>
    call<{ ok: boolean }>(`/profiles/${id}/reports`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  reports: (id: string) => call<{ reports: { revision: number; callsign: string | null; worked: boolean; firmware: string | null; hamlib: string | null; interface: string | null; note: string | null; created_at: string }[] }>(`/profiles/${id}/reports`, { auth: false }),
  /** Your Rigs API keys, listed from Accounts (keys are made and revoked at Accounts). */
  keys: () => call<{ manage_url: string; available: boolean; keys: AccountKey[] }>("/me/keys"),
  me: () => call<{ sub: string; callsign: string | null; callsign_verified: boolean; role: string; moderator: boolean }>("/me"),
  myProfiles: () => call<{ profiles: Envelope[] }>("/me/profiles"),
  queue: () => call<{ profiles: Envelope[] }>("/admin/profiles"),
  setStatus: (id: string, status: string) => call<Envelope>(`/admin/profiles/${id}/status`, { method: "POST", body: JSON.stringify({ status }), headers: { "content-type": "application/json" } }),
};

export const OP_LABELS: Record<string, string> = {
  ssb: "SSB voice", am: "AM", fm: "FM", cw: "CW", rtty: "RTTY", psk: "PSK", ft8: "FT8", ft4: "FT4", js8: "JS8Call", olivia: "Olivia",
  sstv: "SSTV", packet: "Packet", "winlink-ardop": "Winlink ARDOP", "winlink-vara": "Winlink VARA", "winlink-mercury": "Winlink Mercury",
  "winlink-packet": "Winlink packet", "digital-other": "Other digital", other: "Other",
};
export const opLabel = (op: string) => OP_LABELS[op] ?? op;
