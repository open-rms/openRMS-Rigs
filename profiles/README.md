# Profile data (CC-BY-SA-4.0)

Profile documents are licensed under the Creative Commons Attribution-ShareAlike 4.0
International license (`LICENSE` in this folder), not the AGPL that covers the code. That
includes:
- profiles contributed through the openRMS Rigs website or API;
- `GET /api/v1/dump.json` and the planned nightly export;
- the profile files in this folder.

Attribution: "openRMS Rigs contributors", with a link to the profile or to https://rigs.openrms.dev.
Each profile also credits the sources its settings come from (`sources`).

## What's here

Researched example profiles, one folder per radio:

| Folder | Profiles |
|---|---|
| `yaesu-ftdx10/` | FT8/FT4, RTTY (AFSK), PSK31, Winlink ARDOP, Winlink VARA HF, SSB, AM, CW |
| `icom-ic7300mk2/` | FT8/FT4 over USB-C, FT8 over the LAN port, SSB, CW |

They were compiled on 2026-11-25 by comparing the manufacturers' manuals with independent setup
guides, lab reports and on-air tests, all listed in each file's `sources`. For every setting:
- the steps cite the sources that support it (`sources: [S1, S3]`);
- `confidence` says how well those sources support it;
- where sources disagree, the step's `note` says so.

Settings are recorded as facts with credit; no text is copied from the sources. Everything is
tagged `unverified` until someone reports a profile working on air. Raw CAT steps are limited
to settings commands, and nothing in a profile can key the transmitter.

`_sources.yaml` in each folder is the shared source list; profiles copy the entries they cite.
**The YAML files are the source of truth**: edit them directly. `pnpm test` in `api/` checks
that every file validates against the radio's Hamlib capabilities, builds an apply-plan, and
cites only sources it lists.

## Submitting them to a Rigs site

```sh
cd api
# An ormsr_ key from your Account page (API keys). Profiles are credited to your account.
RIGS_API_URL=https://rigs.openrms.dev RIGS_KEY=ormsr_… pnpm import-profiles ../profiles
```

Profiles you already have (same title) are skipped. Add `--dry-run` to only validate. Profiles
with raw CAT steps, or from unverified callsigns or API keys, land in the review queue for a
moderator to publish.
