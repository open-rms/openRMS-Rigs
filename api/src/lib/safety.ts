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
 * the radio transmit, tune or send. Anything else (Yaesu/Kenwood TX, MX, VX, BI, AC, KY, PB,
 * Elecraft SW*, TT, Flex/Thetis ZZ*, Icom 1C/17/28 and VOX/BK-IN under 16) is refused.
 *
 * ascii (Kenwood, Yaesu, Elecraft): every ';'-terminated command must start with one of these.
 * civ (Icom): hex body without preamble/addresses/FD; first byte from the list, with denied sub-commands.
 */
export const ASCII_PREFIXES = new Set([
  "EX", "MN", "MP", // menus
  "MD", "DT", // mode, data mode
  "GT", "AG", "RG", "SQ", "RA", "PA", "IS", "SH", "BW", "FW", // receive: AGC, gains, att, preamp, shift, width
  "NA", "NB", "NL", "NR", "BC", "CO", "AN", "AP", "RL", "ML", // receive DSP, monitor level
  "PC", "MG", "PR", "KS", "KP", // transmit-side settings (power, mic gain, processor, key speed/pitch): safety tx
  "SM", "RM", // meters (read)
]);
const CIV_FIRST = new Set(["04", "06", "11", "14", "15", "16", "1A"]);
const CIV_DENY = ["1646", "1647"]; // VOX, break-in

const ASCII_CMD = /^[A-Z]{2}[A-Za-z0-9]*$/;

/** Returns why a rendered CAT command isn't allowed, or null if it is. */
export function catProblem(protocol: "ascii" | "civ", command: string): string | null {
  if (!command) return "empty command";
  if (protocol === "civ") {
    const c = command.toUpperCase();
    if (!/^([0-9A-F]{2})+$/.test(c)) return "CI-V commands are hex bytes with no spaces";
    if (!CIV_FIRST.has(c.slice(0, 2)) || CIV_DENY.some((d) => c.startsWith(d))) return `CI-V command ${c.slice(0, 4)} is not on the allow-list`;
    return null;
  }
  if (!/^[A-Za-z0-9;]+$/.test(command) || !command.endsWith(";")) return "ASCII CAT commands are letters and digits ending in ';', with no spaces";
  for (const part of command.split(";").filter(Boolean)) {
    if (!ASCII_CMD.test(part) || !ASCII_PREFIXES.has(part.slice(0, 2))) return `CAT command ${part.slice(0, 4)}… is not on the allow-list`;
  }
  return null;
}

/** A CAT template with every placeholder filled with a harmless digit, for checking its shape. */
export const sampleOf = (template: string) => template.replace(/\{value(?::(\d+))?\}/g, (_, w) => "0".repeat(Number(w ?? 1)));

/** A value that may be inserted into a CAT template. */
export const CAT_VALUE = /^[A-Za-z0-9]{1,16}$/;
/** Hamlib identifiers: level/func/parm names and mode names. */
export const HAMLIB_NAME = /^[A-Z0-9_]{1,32}$/;
export const MODE_NAME = /^[A-Z0-9-]{1,16}$/;
