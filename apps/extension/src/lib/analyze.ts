// Turns raw scan hits into the list the panel shows. Pure: no DOM, no browser
// API, so it is tested without a browser. All scoring is done by
// @opal42/gradient; nothing here is a scoring rule.
//
//   groupHits    parse every hit, merge the same gradient found in several
//                places (a stylesheet rule and the element it styles, or the
//                same text on many elements), cap usages and groups
//   analyzeGroup score, explain, propose fixes, refine, build copy text
//
// Wording follows PLAN D5: a smoothness score by our definition, no verdicts.

import {
  parseGradient,
  proposeFixes,
  refine,
  score,
  toCSS,
  type GradientDocument,
  type Issue,
  type ParsedGradient,
} from "@opal42/gradient";
import { reasonText, warningText } from "./reasons";
import { ruleText, SEVERITY_LABEL } from "./rule-text";
import type { HitSource, RawHit } from "./scan-types";
import { studioHash, type StudioHash } from "./studio-link";

export const GROUP_LIMITS = {
  /** Distinct gradients kept; more are counted in `droppedGroups`. */
  maxGroups: 500,
  /** Usages kept per gradient (the true count is still reported). */
  maxUsagesStored: 100,
  /** Usages shown by default in the UI. */
  usagesShown: 5,
  /** Characters of gradient text kept for display. */
  maxCssDisplay: 1200,
} as const;

export interface Usage {
  source: HitSource;
  property: string;
  /** Label: `div.card`, `.hero::before`, or a stylesheet rule's selector. */
  selector: string;
  /** Exact selector for highlighting; empty for stylesheet rules. */
  path: string;
  /** Stylesheet label; empty for elements. */
  origin: string;
}

export interface Group {
  id: string;
  key: string;
  /** The gradient function as found (clipped for display). */
  css: string;
  parsed: ParsedGradient | null;
  /** The text was clipped by the scanner: not parsed. */
  truncated: boolean;
  usages: Usage[];
  /** Distinct usages seen, including those beyond `maxUsagesStored`. */
  usageCount: number;
  /** Order of first appearance (page order: rules first, then elements). */
  order: number;
}

export interface GroupResult {
  groups: Group[];
  /** Distinct gradients dropped at the `maxGroups` cap. */
  droppedGroups: number;
  /** Hits whose text had `gradient(` but no gradient the parser could find (e.g. inside a string). */
  unparsedHits: number;
}

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/ ?([(),]) ?/g, "$1")
    .trim()
    .toLowerCase();
}

function usageKey(u: Usage): string {
  return `${u.origin}\u0000${u.path}\u0000${u.selector}\u0000${u.source}`;
}

/** Parse and merge hits. Deterministic for a given hit order. */
export function groupHits(hits: readonly RawHit[]): GroupResult {
  const byKey = new Map<string, Group>();
  const seenUsage = new Map<string, Set<string>>();
  let dropped = 0;
  let unparsed = 0;
  let order = 0;

  const add = (key: string, make: () => Omit<Group, "usages" | "usageCount" | "id" | "order">, usage: Usage) => {
    let group = byKey.get(key);
    if (!group) {
      if (byKey.size >= GROUP_LIMITS.maxGroups) {
        dropped++;
        return;
      }
      group = { ...make(), id: `g${byKey.size + 1}`, usages: [], usageCount: 0, order: order++ };
      byKey.set(key, group);
      seenUsage.set(key, new Set());
    }
    const seen = seenUsage.get(key)!;
    const uk = usageKey(usage);
    if (seen.has(uk)) return;
    seen.add(uk);
    group.usageCount++;
    if (group.usages.length < GROUP_LIMITS.maxUsagesStored) group.usages.push(usage);
  };

  for (const hit of hits) {
    const usage: Usage = { source: hit.source, property: hit.property, selector: hit.selector, path: hit.path, origin: hit.origin };

    if (hit.truncated) {
      const text = hit.value.slice(0, GROUP_LIMITS.maxCssDisplay);
      add(`truncated|${normalizeText(text.slice(0, 300))}|${hit.value.length}`, () => ({ key: "", css: text, parsed: null, truncated: true }), usage);
      continue;
    }

    const found = parseGradient(hit.value).gradients;
    if (found.length === 0) {
      unparsed++;
      continue;
    }
    for (const parsed of found) {
      const text = hit.value.slice(parsed.range.start, parsed.range.end);
      const doc = parsed.document;
      const css = doc ? toCSS(doc) : null;
      const key = css ? `${parsed.kind}|${css}` : `${parsed.kind}|${parsed.vendorPrefix ?? ""}|${normalizeText(text)}`;
      add(key, () => ({ key, css: text.slice(0, GROUP_LIMITS.maxCssDisplay), parsed, truncated: false }), usage);
    }
  }

  return { groups: [...byKey.values()], droppedGroups: dropped, unparsedHits: unparsed };
}

// ── Per-gradient analysis ─────────────────────────────────────────────────────

export interface IssueView {
  code: string;
  /** Short lower-case rule name, e.g. "lightness reversal". */
  name: string;
  /** One sentence: what the rule measures. */
  measures: string;
  /** The finding's own message from the scorer (counts, angles). */
  detail: string;
  severity: Issue["severity"];
  severityLabel: string;
  pointsLost: number;
  /** "stop 2", "stops 1 and 3", "between 50% and 100%", or "". Stops are numbered in CSS source order. */
  where: string;
}

export interface FixView {
  code: string;
  /** "Make stop 2 darker" */
  label: string;
  kind: string;
  /** Points gained, always > 0. */
  gain: number;
  /** The score after the fix. */
  scoreAfter: number;
  /** The gradient with the fix applied. */
  css: string;
}

export interface RefinedView {
  css: string;
  scoreAfter: number;
  gain: number;
}

export type StudioInfo = StudioHash;

export interface ScoredEntry {
  status: "scored";
  id: string;
  /** Order of first appearance on the page. */
  order: number;
  kind: "linear";
  css: string;
  swatch: string;
  /** The gradient as the panel prints it (normalised), the text copy actions start from. */
  normalizedCss: string;
  usages: Usage[];
  usageCount: number;
  score: number;
  issues: IssueView[];
  fixes: FixView[];
  refined: RefinedView | null;
  studio: StudioInfo;
  hasHardStops: boolean;
  notes: string[];
}

export interface UnscoredEntry {
  status: "not-scored";
  id: string;
  order: number;
  kind: "linear" | "radial" | "conic";
  css: string;
  /** CSS for a preview, or null when none can be shown safely. */
  swatch: string | null;
  usages: Usage[];
  usageCount: number;
  /** Parser skip code or scorer unscorable code. */
  code: string;
  reason: string;
  notes: string[];
}

export type Entry = ScoredEntry | UnscoredEntry;

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function whereText(issue: Issue): string {
  const stops = issue.stopIndices ?? [];
  const nums = stops.map((i) => i + 1);
  let text = "";
  if (nums.length === 1) text = `stop ${nums[0]}`;
  else if (nums.length === 2) text = `stops ${nums[0]} and ${nums[1]}`;
  else if (nums.length > 2) text = `stops ${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`;
  if (issue.segment && issue.segment.end > issue.segment.start) {
    const seg = `between ${pct(issue.segment.start)} and ${pct(issue.segment.end)}`;
    text = text ? `${text}, ${seg}` : seg;
  }
  return text;
}

/** Characters a preview may contain. Excludes quotes, `;`, braces, `\`, `:` and `@`, so nothing can open a URL or a second declaration. */
const SWATCH_CHARS = /^[A-Za-z0-9\s().,%#+\-/]+$/;
const SWATCH_FORBIDDEN = /url|image|element|paint|attr|env|var|expression|cross-fade/i;

/** A raw gradient text may be previewed only when it is a plain gradient function. */
export function safeSwatch(text: string): string | null {
  if (text.length === 0 || text.length > 2000) return null;
  if (!/^(repeating-)?(linear|radial|conic)-gradient\(/i.test(text)) return null;
  if (!SWATCH_CHARS.test(text) || SWATCH_FORBIDDEN.test(text)) return null;
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return null;
  }
  return depth === 0 && text.endsWith(")") ? text : null;
}

function notesFor(parsed: ParsedGradient): string[] {
  const notes: string[] = [];
  for (const w of parsed.warnings) {
    const text = warningText(w.code);
    if (text && !notes.includes(text)) notes.push(text);
  }
  return notes;
}

function baseKind(group: Group): "linear" | "radial" | "conic" {
  const kind = group.parsed?.kind;
  return kind === "radial" || kind === "conic" ? kind : "linear";
}

export function analyzeGroup(group: Group): Entry {
  const common = { id: group.id, order: group.order, css: group.css, usages: group.usages, usageCount: group.usageCount };

  if (group.truncated || !group.parsed) {
    return {
      status: "not-scored",
      kind: "linear",
      ...common,
      swatch: null,
      code: "too-long",
      reason: reasonText("too-long"),
      notes: [],
    };
  }

  const parsed = group.parsed;
  const doc = parsed.document;
  if (!doc) {
    const code = parsed.skipped?.code ?? "syntax";
    return {
      status: "not-scored",
      kind: baseKind(group),
      ...common,
      swatch: safeSwatch(group.css),
      code,
      reason: reasonText(code),
      notes: notesFor(parsed),
    };
  }

  const result = score(doc);
  const normalizedCss = toCSS(doc) ?? group.css;
  if (result.status !== "ok") {
    return {
      status: "not-scored",
      kind: "linear",
      ...common,
      swatch: toCSS(doc) ?? safeSwatch(group.css),
      code: result.code,
      reason: reasonText(result.code),
      notes: notesFor(parsed),
    };
  }

  const notes = notesFor(parsed);
  if (result.analysis.hasHardStops) {
    notes.push("Has hard stops (two stops at one position). The v1 score reads them as abrupt transitions, so a striped or stepped design will show deductions.");
  }

  const issues: IssueView[] = result.issues.map((issue) => {
    const text = ruleText(issue.code);
    return {
      code: issue.code,
      name: text.name,
      measures: text.measures,
      detail: issue.message,
      severity: issue.severity,
      severityLabel: SEVERITY_LABEL[issue.severity],
      pointsLost: issue.pointsLost,
      where: whereText(issue),
    };
  });

  const fixes: FixView[] = [];
  for (const fix of proposeFixes(doc)) {
    const css = toCSS(fix.document);
    if (!css || fix.after.status !== "ok") continue;
    fixes.push({ code: fix.code, label: fix.label, kind: fix.kind, gain: fix.gain, scoreAfter: fix.after.score, css });
  }

  let refined: RefinedView | null = null;
  const r = refine(doc);
  if (r.refined && r.after.status === "ok" && r.after.score > result.score) {
    const css = toCSS(r.document);
    if (css) refined = { css, scoreAfter: r.after.score, gain: r.after.score - result.score };
  }

  return {
    status: "scored",
    kind: "linear",
    ...common,
    swatch: normalizedCss,
    normalizedCss,
    score: result.score,
    issues,
    fixes,
    refined,
    studio: studioHash(doc as GradientDocument),
    hasHardStops: result.analysis.hasHardStops,
    notes,
  };
}

// ── Whole-scan summary ────────────────────────────────────────────────────────

export interface Summary {
  total: number;
  scored: number;
  notScored: number;
  /** Gradients with at least one issue. */
  withIssues: number;
}

export function summarize(entries: readonly Entry[]): Summary {
  let scored = 0;
  let withIssues = 0;
  for (const e of entries) {
    if (e.status === "scored") {
      scored++;
      if (e.issues.length > 0) withIssues++;
    }
  }
  return { total: entries.length, scored, notScored: entries.length - scored, withIssues };
}

/** The sentence announced in the polite live region after a scan. */
export function summaryText(s: Summary): string {
  if (s.total === 0) return "No gradients found on this page.";
  const parts = [`${s.total} ${s.total === 1 ? "gradient" : "gradients"} found`, `${s.scored} scored`];
  if (s.notScored > 0) parts.push(`${s.notScored} not scored`);
  return `${parts.join(", ")}.`;
}

export type SortKey = "score-asc" | "score-desc" | "usage" | "page";

/** Sort without mutating. Not-scored entries come after scored ones (except in page order and by usage). */
export function sortEntries(entries: readonly Entry[], key: SortKey): Entry[] {
  const list = [...entries];
  const scoreOf = (e: Entry) => (e.status === "scored" ? e.score : Number.POSITIVE_INFINITY);
  const byOrder = (a: Entry, b: Entry) => a.order - b.order;
  switch (key) {
    case "score-asc":
      return list.sort((a, b) => scoreOf(a) - scoreOf(b) || byOrder(a, b));
    case "score-desc":
      return list.sort((a, b) => {
        const sa = a.status === "scored" ? -a.score : Number.POSITIVE_INFINITY;
        const sb = b.status === "scored" ? -b.score : Number.POSITIVE_INFINITY;
        return sa - sb || byOrder(a, b);
      });
    case "usage":
      return list.sort((a, b) => b.usageCount - a.usageCount || byOrder(a, b));
    default:
      return list.sort(byOrder);
  }
}
