// Hamlib's units for common levels (rig.h). Unknown levels are reported as "hamlib".
const UNITS: Record<string, string> = {
  AF: "fraction", RF: "fraction", SQL: "fraction", RFPOWER: "fraction", MICGAIN: "fraction", COMP: "fraction",
  VOXGAIN: "fraction", ANTIVOX: "fraction", MONITOR_GAIN: "fraction", NR: "fraction", PBT_IN: "fraction",
  PBT_OUT: "fraction", USB_AF: "fraction", USB_AF_INPUT: "fraction", BALANCE: "fraction", IF: "Hz",
  PREAMP: "dB", ATT: "dB", CWPITCH: "Hz", NOTCHF: "Hz", KEYSPD: "wpm", BKINDL: "tenths of a dot",
  VOXDELAY: "tenths of a second", AGC: "enum (see agcLevels)", AGC_TIME: "seconds", NB: "level",
  APF: "Hz", SPECTRUM_REF: "dB", RFPOWER_METER_WATTS: "W", BAND_SELECT: "enum", METER: "enum",
};

export const unitOf = (level: string): string => UNITS[level] ?? "hamlib";
