// Drives a scan: many short in-page calls instead of one long one. Pure
// orchestration over an injected `EvalFn`, so tests can run it against jsdom or
// a fake.

import { parseScanResult } from "./scan-result";
import { scanExpression } from "./scanner";
import { DEFAULT_LIMITS, type RawHit, type ScanLimits, type ScanRequest, type ScanResult } from "./scan-types";

/** Evaluates an expression in the inspected page and resolves to its value; rejects with an Error on a page exception. */
export type EvalFn = (expression: string) => Promise<unknown>;

export interface SkippedSheet {
  label: string;
  reason: "cross-origin" | "error";
}

export interface ScanStats {
  /** Elements in the document at the end of the scan. */
  elementsTotal: number;
  /** Elements actually examined (≤ limits.maxElements). */
  elementsScanned: number;
  /** The document has more elements than the cap; the rest was not examined. */
  elementCapReached: boolean;
  sheetsTotal: number;
  sheetsScanned: number;
  /** More stylesheets than the cap: the rest was not read. */
  sheetCapReached: boolean;
  /** Sheets that could not be read (cross-origin, or a read error). */
  sheetsSkipped: SkippedSheet[];
  /** Sheets whose rule list was cut at the per-sheet cap. */
  sheetsCapped: number;
  rulesScanned: number;
  /** Values clipped at the length limit. */
  truncatedValues: number;
  /** Collection stopped at the total hit cap. */
  hitCapReached: boolean;
  readyState: "loading" | "interactive" | "complete" | "unknown";
  /** In-page calls made (diagnostic). */
  calls: number;
}

export interface ScanOutcome {
  hits: RawHit[];
  stats: ScanStats;
}

export class ScanError extends Error {
  readonly code: "page-error" | "bad-result" | "cancelled";
  constructor(message: string, code: "page-error" | "bad-result" | "cancelled") {
    super(message);
    this.name = "ScanError";
    this.code = code;
  }
}

export interface RunOptions {
  limits?: Partial<ScanLimits>;
  /** Checked between calls; when true the scan stops with a `cancelled` ScanError. */
  isCancelled?: () => boolean;
  /** Called after each call with a 0..1 estimate. */
  onProgress?: (fraction: number) => void;
}

const MAX_CALLS = 2000;

export async function runScan(evalFn: EvalFn, options: RunOptions = {}): Promise<ScanOutcome> {
  const limits: ScanLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const isCancelled = options.isCancelled ?? (() => false);
  let calls = 0;

  const call = async (req: ScanRequest): Promise<ScanResult> => {
    if (isCancelled()) throw new ScanError("Scan cancelled", "cancelled");
    if (++calls > MAX_CALLS) throw new ScanError("The page needed too many scan steps", "bad-result");
    let raw: unknown;
    try {
      raw = await evalFn(scanExpression(req));
    } catch (e) {
      throw new ScanError(e instanceof Error ? e.message : String(e), "page-error");
    }
    const result = parseScanResult(raw);
    if (!result) throw new ScanError("The page returned data the panel could not read", "bad-result");
    if (result.op === "error") throw new ScanError(result.message, "page-error");
    if (result.op !== req.op) throw new ScanError("Unexpected scan result", "bad-result");
    return result;
  };

  const hits: RawHit[] = [];
  const customProps: string[] = [];
  const stats: ScanStats = {
    elementsTotal: 0,
    elementsScanned: 0,
    elementCapReached: false,
    sheetsTotal: 0,
    sheetsScanned: 0,
    sheetCapReached: false,
    sheetsSkipped: [],
    sheetsCapped: 0,
    rulesScanned: 0,
    truncatedValues: 0,
    hitCapReached: false,
    readyState: "unknown",
    calls: 0,
  };

  const take = (more: RawHit[]) => {
    for (const hit of more) {
      if (hits.length >= limits.maxHits) {
        stats.hitCapReached = true;
        return;
      }
      if (hit.truncated) stats.truncatedValues++;
      hits.push(hit);
    }
  };

  const info = await call({ op: "info" });
  if (info.op !== "info") throw new ScanError("Unexpected scan result", "bad-result");
  stats.readyState = info.readyState;
  stats.sheetsTotal = info.sheets;
  stats.elementsTotal = info.elements;
  const sheetCount = Math.min(info.sheets, limits.maxSheets);
  stats.sheetCapReached = info.sheets > limits.maxSheets;

  // Work estimate for progress: sheets count as one unit each, elements by index.
  const elementGoal = Math.min(info.elements, limits.maxElements);
  const totalWork = Math.max(1, sheetCount + elementGoal);
  let done = 0;
  const progress = () => options.onProgress?.(Math.min(1, done / totalWork));

  // 1. Stylesheets (also yields the custom property names to look for on elements).
  for (let index = 0; index < sheetCount; index++) {
    let skip = 0;
    for (;;) {
      const r = await call({
        op: "sheet",
        index,
        skip,
        maxRules: limits.maxRulesPerSheet,
        budgetMs: limits.budgetMs,
        maxValueLength: limits.maxValueLength,
      });
      if (r.op !== "sheet") throw new ScanError("Unexpected scan result", "bad-result");
      if (r.status !== "ok") {
        stats.sheetsSkipped.push({ label: r.label || `stylesheet ${index + 1}`, reason: r.status });
        break;
      }
      take(r.hits);
      for (const name of r.customProps) if (!customProps.includes(name) && customProps.length < 200) customProps.push(name);
      if (r.capped) stats.sheetsCapped++;
      if (r.next === null) stats.rulesScanned += r.rules;
      if (r.next === null) {
        stats.sheetsScanned++;
        break;
      }
      if (r.next <= skip) throw new ScanError("Stylesheet scan made no progress", "bad-result");
      skip = r.next;
    }
    done++;
    progress();
  }

  // 2. Elements, in chunks. The count is re-read on every call (the DOM may change).
  let start = 0;
  for (;;) {
    const r = await call({
      op: "elements",
      start,
      count: Math.min(limits.elementChunk, limits.maxElements - start),
      budgetMs: limits.budgetMs,
      customProps,
      pseudo: limits.pseudo,
      maxValueLength: limits.maxValueLength,
      maxHits: Math.max(1, limits.maxHits - hits.length),
    });
    if (r.op !== "elements") throw new ScanError("Unexpected scan result", "bad-result");
    take(r.hits);
    stats.elementsTotal = r.total;
    stats.elementsScanned = Math.min(r.next, r.total, limits.maxElements);
    done += r.next - start;
    progress();
    if (r.hitCapReached) stats.hitCapReached = true;
    start = r.next;
    if (stats.hitCapReached) break;
    if (start >= r.total) break;
    if (start >= limits.maxElements) {
      stats.elementCapReached = r.total > limits.maxElements;
      break;
    }
  }
  stats.elementCapReached = stats.elementCapReached || stats.elementsTotal > limits.maxElements;
  stats.calls = calls;
  options.onProgress?.(1);
  return { hits, stats };
}
