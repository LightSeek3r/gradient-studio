import stylelint from "stylelint";
import type { LinterOptions } from "stylelint";
import plugins from "../src/index";

export interface Warn {
  rule: string;
  text: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: string;
}

export interface Out {
  warnings: Warn[];
  invalid: { text: string }[];
  /** The fixed code, when `fix` was asked for. */
  output: string;
  errored: boolean;
}

export type Rules = Record<string, unknown>;

export async function lint(code: string, rules: Rules, opts: { fix?: boolean; customSyntax?: LinterOptions["customSyntax"] } = {}): Promise<Out> {
  const r = await stylelint.lint({
    code,
    config: { plugins, rules } as never,
    fix: opts.fix,
    customSyntax: opts.customSyntax,
  });
  const res = r.results[0];
  return {
    warnings: res.warnings.map((w) => ({
      rule: w.rule,
      text: w.text,
      line: w.line,
      column: w.column,
      endLine: w.endLine,
      endColumn: w.endColumn,
      severity: w.severity,
    })),
    invalid: res.invalidOptionWarnings,
    output: r.code ?? code,
    errored: r.errored,
  };
}

/** Text of the source covered by a warning's range (1-based line/column, end exclusive). */
export function slice(code: string, w: Warn): string {
  const lines = code.split("\n");
  const offset = (line: number, col: number) => lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  return code.slice(offset(w.line, w.column), offset(w.endLine ?? w.line, w.endColumn ?? w.column));
}

/** Wrap a gradient in the one-declaration stylesheet most tests use. Gradient starts at line 2, column 15. */
export const wrap = (value: string, prop = "background") => `a {\n  ${prop}: ${value};\n}\n`;

// Gradients with known v1 scores and findings (spec/scoring-v1.md).
/** 58: lightness/reversal -12 (stop 2), hue/wide-arc -20 (all), chroma/muddy-midpoint -10. */
export const ROUGH = "linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff)";
/** 100, no findings. */
export const SMOOTH = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
/** 87: hue/wide-arc -8, chroma/muddy-midpoint -5. */
export const RED_BLUE = "linear-gradient(red, blue)";
/** 74: abrupt-jump, uneven-speed, rhythm/uneven-gaps. Fixable by moving the middle stop. */
export const GAPS = "linear-gradient(90deg, #ff0000 0%, #ff8800 5%, #ffff00 100%)";
/** 45: lightness/reversal -48 (no targeted fix), hue/wide-arc -20, chroma/saturation-range -5. */
export const RAINBOW = "linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff)";
