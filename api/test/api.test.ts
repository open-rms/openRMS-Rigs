// End-to-end through the Hono app against the test database (openrms_rigs_test), with tokens
// signed by the dev stub issuer (scripts/dev-token.ts).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://openrms_rigs:openrms_rigs@127.0.0.1:5442/openrms_rigs_test";
process.env.DEV_JWKS_FILE = new URL("../.dev/jwks.json", import.meta.url).pathname;
process.env.OPENRMS_ISSUER = "http://localhost:8789";

const token = (sub: string, call: string, role: string) =>
  execFileSync("node_modules/.bin/tsx", ["scripts/dev-token.ts", sub, call, role], { encoding: "utf8", env: { ...process.env } }).trim().split("\n").pop()!;

const yaml = readFileSync(new URL("../../../openRMS-Spec/rigs/examples/ic7300-ft8.yaml", import.meta.url), "utf8");

let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let pool: { query: (q: string) => Promise<unknown>; end: () => Promise<void> };
let user: string, other: string, mod: string, verified: string;

beforeAll(async () => {
  const { migrate } = await import("../src/migrate.js");
  const db = await import("../src/db/index.js");
  pool = db.pool;
  await migrate();
  await pool.query("TRUNCATE profile, profile_revision, star, report, api_key, audit_log, favorite, comment CASCADE");
  app = (await import("../src/app.js")).createApp();
  user = token("u-1", "K1ABC", "user");
  other = token("u-2", "K2XYZ", "user");
  mod = token("m-1", "W1MOD", "moderator"); // dev-token marks non-users as callsign_verified
  verified = token("v-1", "W2VER", "admin");
}, 60_000);
afterAll(async () => { await pool?.end(); });

const auth = (t: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${t}`, ...extra });
const json = async (r: Response | Promise<Response>) => (await r).json() as Promise<any>;

describe("api", () => {
  let id = "";

  it("lists rigs from the catalog", async () => {
    const j = await json(app.request("/api/v1/rigs?q=ic-7300"));
    expect(j.rigs.map((r: any) => r.macro)).toContain("RIG_MODEL_IC7300");
  });

  it("requires auth to create", async () => {
    expect((await app.request("/api/v1/profiles", { method: "POST", body: yaml })).status).toBe(401);
  });

  it("an unverified user's profile waits for review and is hidden from others", async () => {
    const r = await app.request("/api/v1/profiles", { method: "POST", body: yaml, headers: auth(user, { "content-type": "application/yaml" }) });
    expect(r.status).toBe(201);
    const j = await r.json() as any;
    id = j.id;
    expect(j.status).toBe("pending");
    expect((await app.request(`/api/v1/profiles/${id}`)).status).toBe(404);
    expect((await app.request(`/api/v1/profiles/${id}`, { headers: auth(other) })).status).toBe(404);
    expect((await app.request(`/api/v1/profiles/${id}`, { headers: auth(user) })).status).toBe(200);
  });

  it("only moderators approve", async () => {
    const body = JSON.stringify({ status: "published" });
    const h = { "content-type": "application/json" };
    expect((await app.request(`/api/v1/admin/profiles/${id}/status`, { method: "POST", body, headers: auth(user, h) })).status).toBe(403);
    const j = await json(app.request(`/api/v1/admin/profiles/${id}/status`, { method: "POST", body, headers: auth(mod, h) }));
    expect(j.status).toBe("published");
    expect(j.published_revision).toBe(1);
    expect((await app.request(`/api/v1/profiles/${id}`)).status).toBe(200);
  });

  it("an unreviewed edit keeps the published revision public", async () => {
    const edited = yaml.replace("value: 0.35", "value: 0.3");
    const j = await json(app.request(`/api/v1/profiles/${id}`, { method: "PUT", body: edited, headers: auth(user) }));
    expect(j).toMatchObject({ revision: 2, status: "pending", published_revision: 1 });
    const pub = await json(app.request(`/api/v1/profiles/${id}`));
    expect(pub.revision).toBe(1);
    expect((await app.request(`/api/v1/profiles/${id}?revision=2`)).status).toBe(404);
    expect((await json(app.request(`/api/v1/profiles/${id}`, { headers: auth(user) }))).revision).toBe(2);
    expect((await app.request(`/api/v1/profiles/${id}`, { method: "PUT", body: edited, headers: auth(other) })).status).toBe(403);
  });

  it("verified accounts publish directly", async () => {
    const j = await json(app.request("/api/v1/profiles", { method: "POST", body: yaml.replace(/^title: .*/m, "title: Verified one"), headers: auth(verified) }));
    expect(j.status).toBe("published");
  });

  it("stars and reports update the stats", async () => {
    expect((await json(app.request(`/api/v1/profiles/${id}/star`, { method: "PUT", headers: auth(other) }))).stars).toBe(1);
    expect((await json(app.request(`/api/v1/profiles/${id}/star`, { method: "PUT", headers: auth(other) }))).stars).toBe(1);
    const h = { "content-type": "application/json" };
    await app.request(`/api/v1/profiles/${id}/reports`, { method: "POST", body: JSON.stringify({ worked: true, firmware: "1.42" }), headers: auth(other, h) });
    await app.request(`/api/v1/profiles/${id}/reports`, { method: "POST", body: JSON.stringify({ worked: false }), headers: auth(mod, h) });
    const j = await json(app.request(`/api/v1/profiles/${id}`));
    expect(j.stats).toMatchObject({ stars: 1, worked: 1, not_worked: 1, forks: 0 });
  });

  it("serves YAML and JSON documents with ETags", async () => {
    const r = await app.request(`/api/v1/profiles/${id}.yaml`);
    expect(r.headers.get("content-type")).toMatch(/yaml/);
    expect(await r.text()).toMatch(/^schema: openrms-rigs\/profile\/v1/);
    const etag = r.headers.get("etag")!;
    expect((await app.request(`/api/v1/profiles/${id}.yaml`, { headers: { "If-None-Match": etag } })).status).toBe(304);
    expect((await json(app.request(`/api/v1/profiles/${id}.json`))).rig.macro).toBe("RIG_MODEL_IC7300");
  });

  it("apply-plan and check", async () => {
    const plan = await json(app.request(`/api/v1/profiles/${id}/apply-plan`));
    expect(plan.steps.find((s: any) => s.id === "power").rigctld.set).toBe("L RFPOWER 0.35");
    const chk = await json(app.request(`/api/v1/profiles/${id}/check`, { method: "POST", body: JSON.stringify({ current: { power: 0.35 } }), headers: { "content-type": "application/json" } }));
    expect(chk.steps.find((s: any) => s.id === "power")).toMatchObject({ status: "ok", noop: true });
  });

  it("validate rejects keying with 422", async () => {
    const r = await app.request("/api/v1/validate", { method: "POST", body: yaml.replace("name: NB\n", "name: TUNER\n") });
    expect(r.status).toBe(422);
  });

  it("ormsr_ keys: minted once, work for writes, not for stars or moderation, revocable", async () => {
    const k = await json(app.request("/api/v1/me/keys", { method: "POST", body: "{}", headers: auth(user, { "content-type": "application/json" }) }));
    expect(k.key).toMatch(/^ormsr_/);
    const me = await json(app.request("/api/v1/me", { headers: { "x-api-key": k.key } }));
    expect(me).toMatchObject({ sub: "u-1", via: "key", callsign: "K1ABC" });
    expect((await app.request(`/api/v1/profiles/${id}/star`, { method: "PUT", headers: { "x-api-key": k.key } })).status).toBe(403);
    expect((await app.request("/api/v1/me/keys", { headers: { "x-api-key": k.key } })).status).toBe(403);
    expect((await app.request(`/api/v1/me/keys/${k.id}`, { method: "DELETE", headers: auth(user) })).status).toBe(204);
    expect((await app.request("/api/v1/me", { headers: { "x-api-key": k.key } })).status).toBe(401);
  });

  it("rejects tokens for another audience", async () => {
    const wrong = execFileSync("node_modules/.bin/tsx", ["scripts/dev-token.ts", "u-1", "K1ABC", "user"], {
      encoding: "utf8", env: { ...process.env, OPENRMS_AUDIENCE: "http://localhost:8787" },
    }).trim().split("\n").pop()!;
    expect((await app.request("/api/v1/me", { headers: auth(wrong) })).status).toBe(401);
  });

  it("dump contains only public profiles at their published revision", async () => {
    const j = await json(app.request("/api/v1/dump.json"));
    const mine = j.profiles.find((p: any) => p.id === id);
    expect(mine.revision).toBe(1);
    expect(mine.document.steps.find((s: any) => s.id === "power").value).toBe(0.35);
    expect(mine.plan.steps.find((s: any) => s.id === "power")).toMatchObject({ safety: "tx", readable: true });
  });

  it("dump ETag is stable until something changes", async () => {
    const r1 = await app.request("/api/v1/dump.json");
    const etag = r1.headers.get("etag")!;
    expect((await app.request("/api/v1/dump.json", { headers: { "If-None-Match": etag } })).status).toBe(304);
  });
});

describe("editor hints", () => {
  it("offers only allowed controls", async () => {
    const j = await json(app.request("/api/v1/rigs/RIG_MODEL_IC7300"));
    expect(j.profile.settable_funcs).toContain("NB");
    expect(j.profile.settable_funcs).not.toContain("VOX");
    expect(j.profile.refused_funcs).toEqual(expect.arrayContaining(["VOX", "TUNER"]));
    expect(j.profile.settable_levels).toContain("RFPOWER");
    expect(j.profile.settable_levels).not.toContain("SWR");
    expect(j.profile.tx_levels).toContain("RFPOWER");
    expect(j.profile.cat_protocol).toBe("civ");
  });
});

describe("forks", () => {
  it("records forked from, counts forks, lists them", async () => {
    const list = await json(app.request("/api/v1/profiles?rig=RIG_MODEL_IC7300"));
    const parent = list.profiles[0];
    const body = yaml.replace(/^title: .*/m, "title: My tweak").replace("value: 0.35", "value: 0.5");
    const r = await app.request(`/api/v1/profiles?forked_from=${parent.id}&forked_revision=1`, { method: "POST", body, headers: auth(verified) });
    expect(r.status).toBe(201);
    const child = (await r.json()) as any;
    expect(child.forked_from).toEqual({ id: parent.id, revision: 1 });
    const full = await json(app.request(`/api/v1/profiles/${child.id}`));
    expect(full.forked_from).toMatchObject({ id: parent.id, revision: 1, title: parent.title, available: true });
    const p = await json(app.request(`/api/v1/profiles/${parent.id}`));
    expect(p.stats.forks).toBeGreaterThanOrEqual(1);
    const forks = await json(app.request(`/api/v1/profiles/${parent.id}/forks`));
    expect(forks.forks.map((f: any) => f.id)).toContain(child.id);
  });
  it("refuses an unknown parent", async () => {
    const r = await app.request("/api/v1/profiles?forked_from=nope-000000", { method: "POST", body: yaml, headers: auth(verified) });
    expect(r.status).toBe(400);
  });
});

describe("favorites (private)", () => {
  it("saved privately: listed for the owner only, no public count, removable", async () => {
    const list = await json(app.request("/api/v1/profiles?rig=RIG_MODEL_IC7300"));
    const id = list.profiles[0].id;
    const starsBefore = (await json(app.request(`/api/v1/profiles/${id}`))).stats.stars;
    expect((await json(app.request(`/api/v1/profiles/${id}/favorite`, { method: "PUT", headers: auth(mod) }))).favorite).toBe(true);
    expect((await json(app.request(`/api/v1/profiles/${id}`))).stats.stars).toBe(starsBefore);
    let fav = await json(app.request("/api/v1/me/favorites", { headers: auth(mod) }));
    expect(fav.favorites.map((f: any) => f.id)).toContain(id);
    expect((await json(app.request("/api/v1/me/favorites", { headers: auth(other) }))).favorites.map((f: any) => f.id)).not.toContain(id);
    expect((await json(app.request("/api/v1/me/favorites?rig=RIG_MODEL_FTDX10", { headers: auth(mod) }))).favorites.map((f: any) => f.id)).not.toContain(id);
    const r = await app.request(`/api/v1/profiles/${id}`, { headers: auth(mod) });
    expect(r.headers.get("cache-control")).toMatch(/private/);
    expect(((await r.json()) as any).viewer).toMatchObject({ favorite: true });
    expect((await json(app.request(`/api/v1/profiles/${id}`))).viewer).toBeNull();
    await app.request(`/api/v1/profiles/${id}/favorite`, { method: "DELETE", headers: auth(mod) });
    fav = await json(app.request("/api/v1/me/favorites", { headers: auth(mod) }));
    expect(fav.favorites.map((f: any) => f.id)).not.toContain(id);
    expect((await app.request("/api/v1/me/favorites")).status).toBe(401);
  });
});

describe("comments", () => {
  const h = { "content-type": "application/json" };
  let pid = "", cid = 0;
  it("posts, replies, counts, and requires sign-in", async () => {
    pid = (await json(app.request("/api/v1/profiles?rig=RIG_MODEL_IC7300"))).profiles[0].id;
    expect((await app.request(`/api/v1/profiles/${pid}/comments`, { method: "POST", body: JSON.stringify({ body: "hi" }), headers: h })).status).toBe(401);
    const r = await app.request(`/api/v1/profiles/${pid}/comments`, { method: "POST", body: JSON.stringify({ body: "  Worked at 30%   MOD on fw 1.42 <b>x</b>  " }), headers: auth(other, h) });
    expect(r.status).toBe(201);
    const c1 = (await r.json()) as any;
    cid = c1.id;
    expect(c1).toMatchObject({ body: "Worked at 30%   MOD on fw 1.42 <b>x</b>", mine: true, author: { callsign: "K2XYZ" } });
    const rep = await json(app.request(`/api/v1/profiles/${pid}/comments`, { method: "POST", body: JSON.stringify({ body: "Thanks!", parent_id: cid }), headers: auth(user, h) }));
    expect(rep.parent_id).toBe(cid);
    // replies to replies are refused
    expect((await app.request(`/api/v1/profiles/${pid}/comments`, { method: "POST", body: JSON.stringify({ body: "x", parent_id: rep.id }), headers: auth(user, h) })).status).toBe(400);
    const list = await json(app.request(`/api/v1/profiles/${pid}/comments`));
    const top = list.comments.find((c: any) => c.id === cid);
    expect(top.replies.map((x: any) => x.body)).toEqual(["Thanks!"]);
    expect(top.mine).toBe(false);
    expect((await json(app.request(`/api/v1/profiles/${pid}`))).stats.comments).toBeGreaterThanOrEqual(2);
  });
  it("only the author edits; author or moderator deletes; moderator hides", async () => {
    expect((await app.request(`/api/v1/comments/${cid}`, { method: "PATCH", body: JSON.stringify({ body: "nope" }), headers: auth(user, h) })).status).toBe(403);
    const e = await json(app.request(`/api/v1/comments/${cid}`, { method: "PATCH", body: JSON.stringify({ body: "Worked at 30% MOD." }), headers: auth(other, h) }));
    expect(e.edited_at).toBeTruthy();
    expect((await app.request(`/api/v1/admin/comments/${cid}/hide`, { method: "POST", body: "{}", headers: auth(user, h) })).status).toBe(403);
    expect((await json(app.request(`/api/v1/admin/comments/${cid}/hide`, { method: "POST", body: JSON.stringify({ reason: "test" }), headers: auth(mod, h) }))).hidden).toBe(true);
    // hidden but has a reply: stays as a placeholder without body for the public
    const pub = (await json(app.request(`/api/v1/profiles/${pid}/comments`))).comments.find((c: any) => c.id === cid);
    expect(pub).toMatchObject({ hidden: true, body: null, author: { callsign: null } });
    expect(pub.replies.length).toBe(1);
    const modView = (await json(app.request(`/api/v1/profiles/${pid}/comments`, { headers: auth(mod) }))).comments.find((c: any) => c.id === cid);
    expect(modView.body).toBe("Worked at 30% MOD.");
    expect((await app.request(`/api/v1/comments/${cid}`, { method: "DELETE", headers: auth(user) })).status).toBe(403);
    expect((await app.request(`/api/v1/comments/${cid}`, { method: "DELETE", headers: auth(other) })).status).toBe(204);
  });
  it("rejects empty and oversized bodies", async () => {
    for (const b of ["   ", "x".repeat(4001)]) {
      expect((await app.request(`/api/v1/profiles/${pid}/comments`, { method: "POST", body: JSON.stringify({ body: b }), headers: auth(verified, h) })).status).toBe(400);
    }
  });
});
