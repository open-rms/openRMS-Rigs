// Version ranges: space-separated comparators that must all hold, e.g. ">=4.6 <4.8".

function cmp(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

const TERM = /(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){0,2})/g;

export function satisfies(version: string, range: string | undefined): boolean {
  if (!range) return true;
  const v = /\d+(?:\.\d+){0,2}/.exec(version)?.[0];
  if (!v) return false;
  for (const m of range.matchAll(TERM)) {
    const op = m[1] ?? "=", target = m[2]!;
    const c = cmp(v, target);
    const ok = op === ">=" ? c >= 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : op === "<" ? c < 0 : c === 0;
    if (!ok) return false;
  }
  return true;
}
