// Builds the rig capability catalog from the locally installed Hamlib.
//
//   pnpm catalog            # writes catalog/hamlib-<version>.json
//
// Sources: `rigctl -l` (model list) and `rigctl -m <n> --dump-caps` per model. Neither opens a
// radio. Rigs are keyed by their Hamlib macro (RIG_MODEL_IC7300); the number is kept for
// convenience but can change between Hamlib releases.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EMPTY_CAPS, parseCaps, parseModelList, type CatalogRig } from "../src/lib/hamlib-parse.js";

function run(args: string[]): string {
  try {
    return execFileSync("rigctl", args, { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // rigctl may exit non-zero after printing a complete dump (backend warnings).
    const out = (e as { stdout?: string }).stdout;
    if (out) return out;
    throw e;
  }
}

const versionLine = run(["--version"]).trim();
const hamlibVersion = /Hamlib\s+([\d.]+\S*)/.exec(versionLine)?.[1] ?? "unknown";
const models = parseModelList(run(["-l"]));

const rigs: CatalogRig[] = [];
const failures: { model: number; macro: string; error: string }[] = [];
for (const m of models) {
  try {
    rigs.push({ ...m, ...parseCaps(run(["-m", String(m.model), "-u"])), capsAvailable: true });
  } catch (e) {
    // Network bridges (NET rigctl) connect to their server just to dump caps. They are not
    // radios, so list them without capabilities instead of failing.
    if (m.pseudo) {
      rigs.push({ ...m, ...EMPTY_CAPS, capsAvailable: false });
      continue;
    }
    failures.push({ model: m.model, macro: m.macro, error: (e as Error).message });
  }
}

const outDir = fileURLToPath(new URL("../catalog/", import.meta.url));
mkdirSync(outDir, { recursive: true });
const file = `${outDir}hamlib-${hamlibVersion}.json`;
writeFileSync(file, JSON.stringify({ hamlibVersion, hamlibBuild: versionLine, rigs }, null, 1) + "\n");
console.log(`${rigs.length}/${models.length} models written to ${file}`);
if (failures.length) {
  console.error(`${failures.length} failures:`, failures);
  process.exitCode = 1;
}
