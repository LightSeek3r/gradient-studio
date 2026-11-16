// Minimal ANSI styling. Colour is used for emphasis and for failures only; a
// score is never coloured by "band", because the metric makes no quality claim.

export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
}

const wrap = (open: number, close: number) => (s: string) => `\u001b[${open}m${s}\u001b[${close}m`;

export function makeStyle(enabled: boolean): Style {
  if (!enabled) {
    const id = (s: string) => s;
    return { bold: id, dim: id, red: id, yellow: id, green: id };
  }
  return { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), yellow: wrap(33, 39), green: wrap(32, 39) };
}
