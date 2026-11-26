# openRMS-Rigs plan

> Status: **alpha**, 2026-11-25. Host `https://rigs.openrms.dev` (site and API on one origin,
> `/api` proxied to the service). Identity: openRMS-Accounts (`openRMS-Spec/accounts/identity.md`).

## Goal

A shared, open library of "settings that worked" for each radio and operation, in a standard
format that apps can check against the radio and apply safely. It should be useful on a web page
for a person with a menu, and over an API for rigctlWeb and hamstack.

## Decisions

| Topic | Decision |
|---|---|
| Source of truth | PostgreSQL (`openrms_rigs`, own role, shared instance; provider-neutral code, `api/db/bootstrap.sql`). A nightly public export to a git repo (and `GET /dump.json`) keeps the data forkable. Export only goes one way, DB to git. |
| Format | JSON Schema 2020-12 in openRMS-Spec. YAML and JSON are equal serializations, and the API converts between them. |
| Radio identity | Hamlib macro (`RIG_MODEL_IC7300`), plus model number, mfg and name for matching. |
| Capabilities | A catalog generated from `rigctl -l` / `--dump-caps` per Hamlib release and checked in. No radio is needed. |
| Steps | Structured kinds: mode, level, func, parm, cat (raw CAT through `send_cmd`, ascii or CI-V), manual (menu path). The rigctld line is a convenience field. |
| Safety | No keying in profiles, rejected server-side. Functions are an allow-list shared with rigctlWeb. `safety: tx` marks steps that change transmit behaviour. |
| Ratings | "Worked for me" reports (with firmware, Hamlib, interface) rank first; stars come second. Both point at revisions. |
| Auth | Accounts JWTs, verified offline through JWKS with `@openrms/service-auth` (a stub issuer is used in tests only). API keys are minted by Accounts (`ormk_`, scoped to Rigs) and verified offline with a persisted revocation list; Rigs' own `ormsr_` keys are retired. |
| Stack | API: Hono + Drizzle + ajv + jose. Site: SvelteKit (static) + Tailwind + shadcn-svelte, the same versions as openRMS-Site. |

Requirements adopted from peer projects (2026-11-25):

- **rigctlWeb:**
  - refuse keying; functions are an allow-list;
  - plans are structured steps, with `readable` per step;
  - Hamlib names and units, with the unit given per level;
  - model id, mfg and name, plus the tested Hamlib range;
  - ETag and Cache-Control headers;
  - nothing per-user in URLs;
  - additive-only v1, OpenAPI 3.1;
  - a dry-run format (`POST /check`).
- **hamstack:**
  - checks with expected values and ranges (`expect`, `check_only`);
  - raw CAT through `send_cmd` with read, reply and set;
  - version gates for Hamlib and firmware;
  - safety class per step;
  - revert support through readback;
  - per-operation profiles;
  - receive audio targets (`audio.rx_target_dbfs`);
  - an offline bundle (`/dump.json`).

## Phases

- **R0 (done):**
  - catalog generator;
  - profile schema plus two examples (IC-7300 FT8, FT-DX10 ARDOP);
  - validator;
  - apply-plan and check;
  - read API, writes, revisions, moderation, stars, reports and `ormsr_` keys;
  - site pages: browse, rig, profile, account and review queue, developers;
  - submit/edit: a form driven by the radio's Hamlib capabilities, with YAML and JSON tabs over the same document and live validation.
    It offers modes, levels (ranges, units, AGC choices, TX marks), functions (on/off/check; keying ones shown as refused), parameters, menu steps, raw CAT, software and audio targets.
    `GET /rigs/{macro}` returns `profile` hints (settable/checkable/TX/refused) so the form only offers what the validator accepts;
  - tests.
- **R0.5 (done 2026-11-25):**
  - the form lists every level, function and parameter Hamlib can set or read on the selected radio, grouped, each with —/Set/Check;
  - clone with "forked from": parent id and revision stored, link back, changes from the parent, fork count and list (`GET /profiles/{id}/forks`).
- **Favorites and comments (done 2026-11-25):**
  - favorites are private bookmarks (`favorite` table, `PUT/DELETE /profiles/{id}/favorite`, `GET /me/favorites`). Only the owner sees them, there's no public count, and signed-in apps can list them. Existing stars were copied into favorites by migration 0002. Stars stay as a separate public "recommend";
  - comments: plain text, one level of replies, editable and deletable by the author, hidden by moderators (audited), rate limits of 5 per minute and 100 per day, and placeholders kept when a removed comment has replies;
  - next: notify profile authors of new comments (Accounts events or email), a report button for readers, and markdown links once there is a safe renderer.
- **R1:**
  - (done 2026-11-25) verify tokens with `@openrms/service-auth` against local Accounts;
  - add rigs.openrms.dev to Accounts' `TRUSTED_ORIGINS`;
  - deployment (container, reverse proxy, migrations at start);
  - nightly git export;
  - rate limits.
- **R2:**
  - in the form, load caps and current values from a live rigctld, through rigctlWeb or hamstack (a browser can't open rigctld's TCP socket), or from a pasted `\dump_caps`;
  - rigctlWeb and hamstack clients (their sessions build those);
  - a "save my current settings as a profile" flow over device-code sign-in. The client ids
    `rigctlweb` and `hamstack` are registered in Accounts (2026-11-25): public, limited to the Rigs audience;
  - Accounts webhooks (`user.updated` refreshes the callsign snapshot; `user.deleted` removes
    or anonymizes).
- **Forks, next:**
  - when the parent gets a new published revision, show forks "the original changed since you cloned it", with that diff, and a one-click "bring in these changes";
  - "suggest to the original": a fork's changes sent to the parent author as a proposed revision they can accept;
  - clone to a different radio: keep manual, software and audio steps, carry over Hamlib steps whose names exist on the new radio, and list the dropped ones;
  - compare any two profiles side by side (the same diff).
- **R3:**
  - collections (e.g. "POTA FT8 kit");
  - images for manual steps (asset storage);
  - comments;
  - menu tables per firmware for Yaesu/Kenwood EX numbers;
  - more examples from the community.

## Open questions

- **Q1:** The CAT allow-list (Spec `rigs/cat-allowlist.json`, shared with rigctlWeb) covers common Kenwood/Yaesu/Elecraft settings families and
  Icom 04/06/11/14/15/16/1A. Should it grow per backend from vendor CAT references, and should
  some families (EX menus) be restricted per model to known item numbers?
- **Q2:** CI-V framing. Clients add `FE FE <radio> <ctrl> … FD`. Should profiles carry the
  default CI-V address, or should clients always use their configured one (current
  assumption)?
- **Q3:** Units for levels Hamlib leaves opaque (`BKINDL`, `NB`, `METER`). Should we document
  them per backend or leave them as "hamlib"?
- **Q4:** The git export repo name and location (`openrms/rigs-profiles`?).
