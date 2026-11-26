# openRMS Rigs

Crowd-sourced radio settings profiles, one per radio model and operation (FT8, CW, SSB, RTTY,
Winlink ARDOP/VARA/Mercury...). Profiles are checked against what Hamlib can set on that radio,
and apps can read the radio, show the differences and apply them. Nothing in a profile can key
the transmitter.

**Provides:** the Rigs API service and website (`openrms-rigs`, rigs.openrms.dev): crowd-sourced
radio settings profiles, the Rigs API (`/api/v1`, OpenAPI 3.1), a Hamlib capability catalog.
**Consumes:** openRMS-Spec (`rigs/`: profile JSON Schema and OpenAPI), openRMS-Accounts (JWTs),
PostgreSQL (own database `openrms_rigs`), Hamlib (`rigctl`, catalog build only).
**Status:** alpha. Not deployed.

**Used by:** rigctlWeb, hamstack, openRMS-Translator (later) and third parties.
**License:** code AGPL-3.0-or-later (`LICENSE`); profile content CC-BY-SA-4.0
(`profiles/LICENSE`, see `profiles/README.md`).

> **Sibling checkouts needed (for now).** Clone these next to this repo, in the same parent folder:
> - **openRMS-Accounts:** `api/` depends on `@openrms/service-auth` through
>   `link:../../openRMS-Accounts/packages/service-auth`, so `pnpm install` fails without it.
> - **openRMS-Spec** ([github.com/open-rms/openRMS-Spec](https://github.com/open-rms/openRMS-Spec)):
>   the API reads the profile schema, the raw-CAT allow-list and the OpenAPI document from it
>   at startup, and the tests run its check vectors. It **won't start
>   without it**. Override the location with `OPENRMS_SPEC_DIR`.

## Layout

| Path | What |
|---|---|
| `api/` | Hono + Drizzle service (TypeScript). Port 8790 |
| `api/catalog/hamlib-<ver>.json` | Capabilities of every Hamlib model, from `rigctl -l` and `--dump-caps` |
| `api/scripts/gen-catalog.ts` | Rebuilds the catalog from the installed Hamlib |
| `profiles/` | Researched example profiles (FT-DX10, IC-7300, IC-7300MK2) with credited sources, CC-BY-SA-4.0. See `profiles/README.md` |
| `site/` | SvelteKit + Tailwind + shadcn-svelte static SPA, a pure client of the API. Port 5174. The submit page has a capability-driven form (built from the radio's Hamlib caps plus the API's `profile` hints) and YAML/JSON tabs that edit the same document |
| `../openRMS-Spec/rigs/` | The contract: profile JSON Schema, OpenAPI, format guide, examples |

## Database

Any PostgreSQL 16+ server works: local Docker, a managed host or your own. The service needs
only its own database and role; it never reads another service's database. Create them once
as an admin role, then point `DATABASE_URL` at the new database (add `?sslmode=verify-full` for a
remote server). Migrations run at startup and with `pnpm migrate`.

```sh
psql "$ADMIN_DATABASE_URL" -v password="$(openssl rand -base64 24)" -f api/db/bootstrap.sql
```

## Development

```sh
# Database: own role + database on any Postgres 16+ (e.g. openRMS-Directory's dev container, 5442)
psql postgres://openrms:openrms@127.0.0.1:5442/postgres -v password=openrms_rigs -f api/db/bootstrap.sql
psql postgres://openrms:openrms@127.0.0.1:5442/postgres -c "CREATE DATABASE openrms_rigs_test OWNER openrms_rigs"

cd api
pnpm install
cp .env.example .env    # set the local issuer and audience, see below
pnpm dev-token          # stub issuer keys for the tests (.dev/)
pnpm seed               # loads openRMS-Spec/rigs/examples
pnpm dev                # migrates, serves http://localhost:8790 (docs at /docs)
pnpm test               # unit + API tests (uses openrms_rigs_test)
pnpm import-profiles ../profiles --dry-run   # validate the example profiles (drop --dry-run, set RIGS_KEY to submit)

cd ../site
pnpm install
pnpm dev                # http://localhost:5174, proxies /api to 8790
```

Sign-in: run openRMS-Accounts locally (port 8789) and sign in on the Site (5173). On localhost the
session cookie is shared across ports, so the Rigs site (5174) gets tokens from
`{issuer}/api/v1/token?aud=http://localhost:8790`. The API's `.env` uses
`OPENRMS_ISSUER=http://localhost:8789` and `OPENRMS_AUDIENCE=http://localhost:8790`.
Defaults are local; a deployment sets both to its own URLs. Tests don't need Accounts. They use a stub issuer (`DEV_JWKS_FILE`, `pnpm dev-token`).

Catalog: `pnpm catalog` rebuilds `catalog/hamlib-<version>.json` from the local Hamlib (about
4 s for 322 models). Keep older catalogs; `GET /rigs?hamlib=` selects one.

## Configuration

- `HOST` (default `127.0.0.1`) and `PORT` (default 8790): keep `HOST=127.0.0.1` with the reverse
  proxy on the same host; use `0.0.0.0` only when the proxy runs elsewhere.
- `DATABASE_URL`: the only database setting. A Unix socket works too, e.g.
  `postgresql://openrms_rigs@/openrms_rigs?host=/var/run/postgresql`. For remote servers, use
  `sslmode=verify-full`.
- `PUBLIC_URL`, `OPENRMS_AUDIENCE`, `OPENRMS_ISSUER`, `SITE_ORIGINS`: see `api/.env.example`.
  The defaults are localhost; set production addresses through the environment.
- `OPENRMS_SPEC_DIR`: path to the openRMS-Spec checkout (default `../../openRMS-Spec`).

## Rules worth knowing

- **No keying, ever.** The validator rejects keying functions (VOX, SBKIN, FBKIN, TBURST,
  TUNER, SEND_*). Functions are an allow-list that matches rigctlWeb's v1. Raw CAT is an
  allow-list of settings command families per protocol, loaded from Spec
  `rigs/cat-allowlist.json` (rigctlWeb enforces the same file), checked on the rendered command, and
  values are numbers or plain identifiers, so nothing can smuggle in a second command.
  `buildPlan` also refuses any multi-line command (`src/lib/safety.ts`). Steps that change
  transmit behaviour are marked `safety: tx`.
- Names and ranges are checked against the catalog. Hamlib's `0..0` means "no range info", not
  "must be 0".
- Rigs are keyed by Hamlib macro. Data is keyed by Accounts `sub`, never by callsign.
- Every edit is an immutable revision. Unverified callsigns, and any profile with raw CAT (even
  from staff), wait for a moderator. While an edit waits, the last published revision stays public.
- `ormsr_` keys are minted here (hashed, kind fixed at creation). They can submit and edit
  profiles. Stars, reports, key management and moderation need a signed-in session.

See `PLAN.md` for phases and open questions.
