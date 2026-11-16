// Validation of what the in-page scanner returns. The page is untrusted: it can
// patch JSON, Array and getComputedStyle, so a result may be anything. These
// functions accept only the exact shapes of scan-types.ts, bound every length and
// count, and never throw. Anything else is `null` (the runner then reports a
// failed scan instead of using the data).

import type { ElementsResult, InfoResult, RawHit, ScanResult, SheetResult } from "./scan-types";

/** Hard bounds, independent of the scan limits the caller chose. */
export const BOUNDS = {
  value: 100_000,
  selector: 400,
  path: 800,
  origin: 400,
  property: 120,
  hitsPerChunk: 5000,
  customProps: 200,
  count: 100_000_000,
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);
const int = (v: unknown, min = 0, max: number = BOUNDS.count): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

const SOURCES = new Set(["computed", "stylesheet", "custom-property"]);

export function parseHit(raw: unknown): RawHit | null {
  if (!isRecord(raw)) return null;
  const { source, property, value, selector, path, origin, truncated } = raw;
  if (typeof source !== "string" || !SOURCES.has(source)) return null;
  const p = str(property, BOUNDS.property);
  const v = str(value, BOUNDS.value);
  const s = str(selector, BOUNDS.selector);
  const pa = str(path, BOUNDS.path);
  const o = str(origin, BOUNDS.origin);
  if (p === null || v === null || s === null || pa === null || o === null) return null;
  if (p.length === 0 || v.indexOf("gradient(") === -1) return null;
  if (truncated !== undefined && typeof truncated !== "boolean") return null;
  return { source: source as RawHit["source"], property: p, value: v, selector: s, path: pa, origin: o, ...(truncated ? { truncated: true } : {}) };
}

function parseHits(raw: unknown): RawHit[] | null {
  if (!Array.isArray(raw) || raw.length > BOUNDS.hitsPerChunk) return null;
  const out: RawHit[] = [];
  for (const item of raw) {
    const hit = parseHit(item);
    if (!hit) return null;
    out.push(hit);
  }
  return out;
}

const CUSTOM_RE = /^--\S{1,118}$/;

function parseCustomProps(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > BOUNDS.customProps) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !CUSTOM_RE.test(item)) return null;
    out.push(item);
  }
  return out;
}

export function parseInfo(raw: unknown): InfoResult | null {
  if (!isRecord(raw) || raw.op !== "info") return null;
  const elements = int(raw.elements);
  const sheets = int(raw.sheets);
  const state = raw.readyState;
  if (elements === null || sheets === null) return null;
  if (state !== "loading" && state !== "interactive" && state !== "complete" && state !== "unknown") return null;
  return { op: "info", elements, sheets, readyState: state };
}

export function parseSheet(raw: unknown): SheetResult | null {
  if (!isRecord(raw) || raw.op !== "sheet") return null;
  const index = int(raw.index);
  const label = str(raw.label, BOUNDS.origin);
  const rules = int(raw.rules);
  const status = raw.status;
  const hits = parseHits(raw.hits);
  const customProps = parseCustomProps(raw.customProps);
  const next = raw.next === null ? null : int(raw.next);
  if (index === null || label === null || rules === null || hits === null || customProps === null) return null;
  if (status !== "ok" && status !== "cross-origin" && status !== "error") return null;
  if (raw.next !== null && next === null) return null;
  if (typeof raw.capped !== "boolean") return null;
  return { op: "sheet", index, label, status, hits, customProps, rules, next, capped: raw.capped };
}

export function parseElements(raw: unknown): ElementsResult | null {
  if (!isRecord(raw) || raw.op !== "elements") return null;
  const start = int(raw.start);
  const next = int(raw.next, 1);
  const total = int(raw.total);
  const hits = parseHits(raw.hits);
  if (start === null || next === null || total === null || hits === null) return null;
  if (next <= start) return null; // a chunk must make progress, or the runner would loop forever
  if (typeof raw.hitCapReached !== "boolean") return null;
  return { op: "elements", start, next, total, hits, hitCapReached: raw.hitCapReached };
}

/** The scanner's own failure report (`{ op: "error" }`), message bounded. */
export function parseError(raw: unknown): { op: "error"; message: string } | null {
  if (!isRecord(raw) || raw.op !== "error") return null;
  const message = str(raw.message, 1000);
  return message === null ? null : { op: "error", message };
}

/** The eval result may arrive as the object itself or, defensively, as JSON text. */
export function normalizeEvalResult(raw: unknown): unknown {
  if (typeof raw === "string") {
    if (raw.length > 50_000_000) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

export function parseScanResult(raw: unknown): ScanResult | null {
  try {
    const value = normalizeEvalResult(raw);
    return parseInfo(value) ?? parseSheet(value) ?? parseElements(value) ?? parseError(value);
  } catch {
    return null; // e.g. a getter that throws: treat as unreadable
  }
}
