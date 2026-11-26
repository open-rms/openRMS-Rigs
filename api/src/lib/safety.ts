import { readFileSync } from "node:fs";
import { paths } from "../paths.js";

// What a profile may ask a client to change. The rule is the same as rigctlWeb's v1 API:
// nothing in an apply-plan may key the transmitter, and functions are an allow-list so a
// function Hamlib adds later stays refused until someone looks at it.

/** Functions that can make the radio transmit on their own (TUNER: some radios start a tune cycle). */
export const KEYING_FUNCS = new Set(["VOX", "SBKIN", "FBKIN", "TBURST", "SEND_MORSE", "SEND_VOICE_MEM", "TUNER"]);

export function isKeyingFunc(name: string): boolean {
  const n = name.toUpperCase();
  return KEYING_FUNCS.has(n) || n.startsWith("SEND_");
}

/** Functions a profile may set. Matches rigctlWeb's v1Funcs (internal/server/v1.go). */
export const SETTABLE_FUNCS = new Set(
  `FAGC NB NB2 COMP TONE TSQL CSQL DSQL ANF NR AIP APF MON MN RF ARO LOCK MUTE VSC REV SQL ABM BC MBC
   BC2 RIT XIT AFC SCOPE RESUME ANL AFLT DUAL_WATCH DIVERSITY SPECTRUM SPECTRUM_HOLD`.split(/\s+/),
);

/** Levels and functions that change transmit behaviour: clients ask the operator first. */
export const TX_LEVELS = new Set(["RFPOWER", "MICGAIN", "COMP", "VOXGAIN", "VOXDELAY", "ANTIVOX", "KEYSPD", "BKINDL", "BKIN_DLYMS", "USB_AF_INPUT", "TXEQ"]);
export const TX_FUNCS = new Set(["COMP"]);

/** Levels that are meters or read-only by nature: never targets. */
export const METER_LEVELS = /^(RAWSTR|STRENGTH|SWR|ALC|.*_METER.*|COMP_METER)$/;

/**
 * Raw CAT is an allow-list of command families that read or change settings and can't make
 * the radio transmit, tune or send. The list lives in openRMS-Spec (rigs/cat-allowlist.json)
 * so Rigs and rigctlWeb enforce exactly the same rules; see profile.md, "Raw CAT allow-list".
 */
type Family = { prefix: string; name: string; read: boolean; set: boolean; safety: "rx" | "tx" };
type Denied = { prefix: string; reason: string };
type ProtocolList = { command_pattern: string; allowed_chars?: string; terminator?: string; families: Family[]; denied: Denied[] };
export type CatAllowlist = { version: string; value_pattern: string; protocols: { ascii: ProtocolList; civ: ProtocolList } };

export const CAT_ALLOWLIST: CatAllowlist = JSON.parse(readFileSync(paths.catAllowlist, "utf8"));
export type CatUse = "read" | "set";

const longest = <T extends { prefix: string }>(list: T[], cmd: string) =>
  list.filter((f) => cmd.startsWith(f.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];

/** The parts of a command that are checked one by one (ascii: each ';'-terminated command). */
function parts(protocol: "ascii" | "civ", command: string): string[] {
  return protocol === "civ" ? [command.toUpperCase()] : command.split(";").filter(Boolean);
}

/** Returns why a rendered CAT command isn't allowed for this use, or null if it is. */
export function catProblem(protocol: "ascii" | "civ", command: string, use: CatUse = "set"): string | null {
  if (!command) return "empty command";
  const list = CAT_ALLOWLIST.protocols[protocol];
  if (protocol === "civ") {
    if (!new RegExp(list.command_pattern).test(command.toUpperCase())) return "CI-V commands are hex bytes with no spaces";
  } else if (!new RegExp(list.allowed_chars!).test(command) || !command.endsWith(list.terminator!)) {
    return "ASCII CAT commands are letters and digits ending in ';', with no spaces";
  }
  const pattern = new RegExp(list.command_pattern);
  for (const part of parts(protocol, command)) {
    const label = protocol === "civ" ? part.slice(0, 4) : `${part.slice(0, 4)}…`;
    const denied = longest(list.denied, part);
    if (denied) return `CAT command ${label} is refused (${denied.reason})`;
    const fam = pattern.test(part) ? longest(list.families, part) : undefined;
    if (!fam) return `CAT command ${label} is not on the allow-list`;
    if (!fam[use]) return `CAT command ${label} (${fam.name}) can't be used to ${use}`;
  }
  return null;
}

/** tx when any part of an (allowed) command belongs to a family that changes transmit behaviour. */
export function catSafety(protocol: "ascii" | "civ", command: string): "rx" | "tx" {
  const list = CAT_ALLOWLIST.protocols[protocol];
  return parts(protocol, command).some((p) => longest(list.families, p)?.safety === "tx") ? "tx" : "rx";
}

/** A CAT template with every placeholder filled with a harmless digit, for checking its shape. */
export const sampleOf = (template: string) => template.replace(/\{value(?::(\d+))?\}/g, (_, w) => "0".repeat(Number(w ?? 1)));

/** A value that may be inserted into a CAT template. */
export const CAT_VALUE = new RegExp(CAT_ALLOWLIST.value_pattern);
/** Hamlib identifiers: level/func/parm names and mode names. */
export const HAMLIB_NAME = /^[A-Z0-9_]{1,32}$/;
export const MODE_NAME = /^[A-Z0-9-]{1,16}$/;
