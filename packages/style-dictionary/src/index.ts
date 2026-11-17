// @opal42/style-dictionary: Style Dictionary hooks for gradient tokens.
//
// The package never imports `style-dictionary`: `register(sd, options)` takes
// the class or an instance (both have the same `register*` methods), so there
// is one copy of the host and nothing to keep in sync. No network, no I/O.

import {
  analyzeToken,
  cssOf,
  isGradientToken,
  refineToken,
  toAttributes,
  tokenPath,
  type Analysis,
  type AnalyzeOptions,
  type SdOptionsLike,
  type TokenLike,
} from "./analyze";
import { isLocked } from "./read";

export { readGradient, isLocked, VENDOR_EXTENSION, DEFAULT_ANGLE } from "./read";
export type { ReadResult, ReadOk, ReadSkip, GradientShape } from "./read";
export { analyzeValue, analyzeToken, isGradientToken } from "./analyze";
export type { Analysis, Finding, GradientAttributes, TokenLike } from "./analyze";

export const TRANSFORM_SCORE = "opal42/gradient-score";
export const TRANSFORM_REFINE = "opal42/gradient-refine";
export const FORMAT_REPORT = "opal42/report-json";
export const FORMAT_CSS = "opal42/css-gradients";
export const ACTION_CHECK = "opal42/gradient-check";
export const TRANSFORM_GROUP = "opal42/css";

export interface Opal42Options {
  /**
   * Lowest smoothness score a gradient token may have. **No default** (PLAN
   * D5): without it nothing is checked. Only scored tokens are compared;
   * unscorable, skipped and hard-stop (stripe) gradients are never counted as failures.
   */
  minScore?: number;
  /** What a score below `minScore` does: `warn` (default) or `error` (throws, failing the build). */
  onBelowMin?: "warn" | "error";
  /** Angle in degrees for gradient tokens that carry none (DTCG gradients have no angle). Default 90. */
  angle?: number;
  /** Where messages go. Default: `console`, silent when Style Dictionary's own verbosity is `silent`. `false` mutes them. */
  log?: false | ((message: string) => void);
}

/** The slice of Style Dictionary (class or instance) that `register` uses. */
export interface StyleDictionaryLike {
  registerTransform(cfg: unknown): void;
  registerTransformGroup(cfg: { name: string; transforms: string[] }): void;
  registerFormat(cfg: unknown): void;
  registerAction(cfg: unknown): void;
}

interface Dict {
  allTokens: TokenLike[];
}

function validate(o: Opal42Options): void {
  if (o.minScore !== undefined && !(typeof o.minScore === "number" && Number.isFinite(o.minScore))) {
    throw new TypeError("@opal42/style-dictionary: minScore must be a finite number");
  }
  if (o.onBelowMin !== undefined && o.onBelowMin !== "warn" && o.onBelowMin !== "error") {
    throw new TypeError('@opal42/style-dictionary: onBelowMin must be "warn" or "error"');
  }
  if (o.angle !== undefined && !(typeof o.angle === "number" && Number.isFinite(o.angle))) {
    throw new TypeError("@opal42/style-dictionary: angle must be a finite number");
  }
}

export function register(sd: StyleDictionaryLike, options: Opal42Options = {}): void {
  validate(options);
  const angleOpts: AnalyzeOptions = options.angle === undefined ? {} : { angle: options.angle };
  const out = (sdOptions: SdOptionsLike | undefined, message: string, warn = false) => {
    if (options.log === false) return;
    if (typeof options.log === "function") return options.log(message);
    if (sdOptions?.log?.verbosity === "silent") return;
    (warn ? console.warn : console.log)(message);
  };
  const reported = new WeakSet<object>();

  /** Throws or warns when a scored token is below `minScore`. */
  const check = (tokens: TokenLike[], sdOptions: SdOptionsLike | undefined) => {
    const min = options.minScore;
    if (min === undefined) return;
    const below: string[] = [];
    for (const t of [...tokens].sort((a, b) => tokenPath(a).localeCompare(tokenPath(b)))) {
      if (!isGradientToken(t, sdOptions)) continue;
      const a = analyzeToken(t, sdOptions, angleOpts);
      // Like the Stylelint plugin's default, stripes (hard stops) are not compared: v1 does not adjust for them.
      if (a.status !== "scored" || a.hasHardStops || a.score >= min) continue;
      const codes = a.findings.map((f) => f.code);
      below.push(`  ${tokenPath(t)}: ${a.score}${codes.length ? ` (${[...new Set(codes)].join(", ")})` : ""}`);
    }
    if (below.length === 0) return;
    const message = `opal42: ${below.length} gradient token${below.length === 1 ? "" : "s"} below minScore ${min} (smoothness score, scoring model v1):\n${below.join("\n")}`;
    if (options.onBelowMin === "error") throw new Error(message);
    const first = tokens[0];
    if (first && reported.has(first)) return;
    if (first) reported.add(first);
    out(sdOptions, message, true);
  };

  sd.registerTransform({
    name: TRANSFORM_SCORE,
    type: "attribute",
    filter: (token: TokenLike, o?: SdOptionsLike) => isGradientToken(token, o),
    // Reads the (reference-resolved) value and returns attributes only: the token value is never touched.
    transform: (token: TokenLike, _platform: unknown, o?: SdOptionsLike) => ({ opal42: toAttributes(analyzeToken(token, o, angleOpts)) }),
  });

  sd.registerTransform({
    name: TRANSFORM_REFINE,
    type: "value",
    // Transitive: runs after Style Dictionary has resolved `{references}` inside the value.
    transitive: true,
    filter: (token: TokenLike, o?: SdOptionsLike) => isGradientToken(token, o),
    transform: (token: TokenLike, _platform: unknown, o?: SdOptionsLike) => {
      const r = refineToken(token, o, angleOpts);
      const path = tokenPath(token);
      if (r.applied) {
        const stops = r.report.changedStops.map((i) => i + 1).join(", ");
        out(o, `opal42 refine: ${path}: score ${r.report.before} -> ${r.report.after} (stops changed: ${stops || "positions only"})`);
        return r.value;
      }
      out(o, `opal42 refine: ${path}: left as is (${r.code})`);
      // A value transform must return the value (returning undefined would defer the token).
      return o?.usesDtcg ? token.$value : token.value;
    },
  });

  sd.registerTransformGroup({ name: TRANSFORM_GROUP, transforms: ["name/kebab", "color/css", TRANSFORM_SCORE] });

  sd.registerFormat({
    name: FORMAT_REPORT,
    format: ({ dictionary, options: o }: { dictionary: Dict; options: SdOptionsLike }) => {
      check(dictionary.allTokens, o);
      return buildReport(dictionary.allTokens, o, options);
    },
  });

  sd.registerFormat({
    name: FORMAT_CSS,
    format: ({ dictionary, file, options: o }: { dictionary: Dict; file?: { options?: { selector?: string } }; options: SdOptionsLike }) => {
      check(dictionary.allTokens, o);
      const selector = file?.options?.selector ?? ":root";
      const lines: string[] = [];
      for (const t of dictionary.allTokens) {
        if (!isGradientToken(t, o)) continue;
        const name = String(t.name ?? tokenPath(t));
        const c = cssOf(t, o, angleOpts);
        lines.push("css" in c ? `  --${name}: ${c.css};` : `  /* skipped ${name}: ${c.code} */`);
      }
      return `/* Generated by @opal42/style-dictionary. */\n${selector} {\n${lines.join("\n")}${lines.length ? "\n" : ""}}\n`;
    },
  });

  sd.registerAction({
    name: ACTION_CHECK,
    do: (dictionary: Dict, _platform: unknown, o?: SdOptionsLike) => check(dictionary.allTokens, o),
    undo: () => undefined,
  });
}

export interface ReportEntry {
  path: string;
  /** Smoothness score of the value as built (after any refinement); null when not scored. */
  score: number | null;
  /** Score the `opal42/gradient-score` transform recorded, when it differs (i.e. a refinement was applied). */
  scoreBeforeRefine?: number;
  status: "scored" | "unscorable" | "skipped";
  hardStops?: true;
  findings: { code: string; severity: string; pointsLost: number; stops: number[] }[];
  code?: string;
  reason?: string;
  locked?: true;
}

export interface Report {
  tool: "@opal42/style-dictionary";
  scoringModel: "v1";
  /** The smoothness score is a metric by our definition, not a quality verdict. */
  note: string;
  minScore?: number;
  summary: { gradients: number; scored: number; unscorable: number; skipped: number };
  tokens: ReportEntry[];
}

function entryOf(t: TokenLike, a: Analysis): ReportEntry {
  const path = tokenPath(t);
  const locked = isLocked(t.$extensions ?? t.extensions);
  const lock = locked ? { locked: true as const } : {};
  const prior = (t.attributes?.opal42 as { score?: number | null } | undefined)?.score;
  if (a.status === "scored") {
    return {
      path,
      score: a.score,
      ...(typeof prior === "number" && prior !== a.score ? { scoreBeforeRefine: prior } : {}),
      status: "scored",
      ...(a.hasHardStops ? { hardStops: true as const } : {}),
      findings: a.findings,
      ...lock,
    };
  }
  return { path, score: null, status: a.status, findings: [], code: a.code, reason: a.reason, ...lock };
}

export function buildReport(tokens: TokenLike[], o: SdOptionsLike | undefined, options: Opal42Options = {}): string {
  const angleOpts: AnalyzeOptions = options.angle === undefined ? {} : { angle: options.angle };
  const entries = tokens
    .filter((t) => isGradientToken(t, o))
    .map((t) => entryOf(t, analyzeToken(t, o, angleOpts)))
    .sort((a, b) => a.path.localeCompare(b.path));
  const count = (s: ReportEntry["status"]) => entries.filter((e) => e.status === s).length;
  const report: Report = {
    tool: "@opal42/style-dictionary",
    scoringModel: "v1",
    note: "The score is a smoothness score by our definition (scoring model v1), not a quality verdict.",
    ...(options.minScore === undefined ? {} : { minScore: options.minScore }),
    summary: { gradients: entries.length, scored: count("scored"), unscorable: count("unscorable"), skipped: count("skipped") },
    tokens: entries,
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
