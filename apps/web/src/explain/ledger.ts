// ── Points ledger (pure) ──────────────────────────────────────────────────────
// Turns the findings of a score into the arithmetic the UI shows:
//   100 − 20 wide hue arc − 12 lightness reversal … = 58
// Each finding's `pointsLost` is its NOMINAL penalty. A dimension cannot go
// below 0 (spec/scoring-v1.md "Clamping"), so the penalties can add up to more
// than 100 − score. The excess is shown as an explicit "floor 0" line that
// gives the points back, instead of pretending the subtraction works.

import { V1_MODEL, type Finding } from "@opal42/gradient";
import { DIMENSIONS, ruleText, type DimensionKey } from "./explain";

export const LEDGER_START = 100;

export interface LedgerRow {
  code: string;
  name: string;
  measures: string;
  severity: Finding["severity"];
  dimension: DimensionKey;
  pointsLost: number;
  message: string;
  /** Indices into the position-sorted stops. */
  stops?: number[];
  /** `[start, end]`, positions 0-100. */
  segment?: [number, number];
}

export interface LedgerFloor {
  dimension: DimensionKey;
  label: string;
  /** The dimension's budget. */
  weight: number;
  /** Sum of the nominal penalties in this dimension. */
  nominal: number;
  /** `nominal − weight`: points that could not be taken. */
  absorbed: number;
}

export interface DimensionSummary {
  dimension: DimensionKey;
  label: string;
  weight: number;
  /** Points kept, 0..weight. */
  kept: number;
}

export interface Ledger {
  start: number;
  /** Sorted by points lost, largest first; ties keep rule order. */
  rows: LedgerRow[];
  /** Sum of every row's `pointsLost`. */
  nominal: number;
  /** One entry per dimension pushed below 0. */
  floors: LedgerFloor[];
  /** Sum of the floors' `absorbed`. */
  absorbed: number;
  /** `start − nominal + absorbed`. */
  total: number;
  dimensions: DimensionSummary[];
  /** True when `total` equals the engine's score (always, for v1). */
  balanced: boolean;
}

export function buildLedger(findings: readonly Finding[], score: number): Ledger {
  const rows: LedgerRow[] = findings
    .map((f, order) => ({ f, order }))
    .sort((a, b) => b.f.pointsLost - a.f.pointsLost || a.order - b.order)
    .map(({ f }) => {
      const text = ruleText(f.code);
      const row: LedgerRow = {
        code: f.code,
        name: text.name,
        measures: text.measures,
        severity: f.severity,
        dimension: f.dimension,
        pointsLost: f.pointsLost,
        message: f.message,
      };
      if (f.stops) row.stops = [...f.stops];
      if (f.segment) row.segment = [f.segment[0], f.segment[1]];
      return row;
    });

  const weights = V1_MODEL.weights as Record<DimensionKey, number>;
  const floors: LedgerFloor[] = [];
  const dimensions: DimensionSummary[] = [];
  for (const { key, label } of DIMENSIONS) {
    const weight = weights[key];
    const nominal = rows.reduce((sum, r) => (r.dimension === key ? sum + r.pointsLost : sum), 0);
    dimensions.push({ dimension: key, label, weight, kept: Math.max(0, weight - nominal) });
    if (nominal > weight) floors.push({ dimension: key, label, weight, nominal, absorbed: nominal - weight });
  }

  const nominal = rows.reduce((sum, r) => sum + r.pointsLost, 0);
  const absorbed = floors.reduce((sum, f) => sum + f.absorbed, 0);
  const total = LEDGER_START - nominal + absorbed;
  return { start: LEDGER_START, rows, nominal, floors, absorbed, total, dimensions, balanced: total === score };
}

/** `100 − 20 − 12 + 2 (floor 0) = 58`, with real minus signs. */
export function ledgerEquation(ledger: Ledger): string {
  const parts = [String(ledger.start), ...ledger.rows.map((r) => `− ${r.pointsLost}`)];
  for (const f of ledger.floors) parts.push(`+ ${f.absorbed} (${f.label.toLowerCase()} floor 0)`);
  return `${parts.join(" ")} = ${ledger.total}`;
}

/** The same sum in words, for assistive tech. */
export function ledgerSentence(ledger: Ledger): string {
  if (ledger.rows.length === 0) return `${ledger.start} points, no deductions.`;
  const parts = ledger.rows.map((r) => `minus ${r.pointsLost} for ${r.name}`);
  for (const f of ledger.floors) {
    parts.push(`plus ${f.absorbed} given back because ${f.label.toLowerCase()} cannot go below 0`);
  }
  return `${ledger.start} ${parts.join(", ")}, equals ${ledger.total}.`;
}

function joinNumbers(numbers: number[]): string {
  if (numbers.length <= 1) return numbers.join("");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/** "stop 2" / "stops 1 and 3" / "0%–35%" / "stops 1 and 2, 0%–5%"; empty when unlocated. */
export function locationText(row: Pick<LedgerRow, "stops" | "segment">): string {
  const parts: string[] = [];
  if (row.stops && row.stops.length > 0) {
    parts.push(`${row.stops.length === 1 ? "stop" : "stops"} ${joinNumbers(row.stops.map((i) => i + 1))}`);
  }
  if (row.segment) parts.push(`${row.segment[0]}%–${row.segment[1]}%`);
  return parts.join(", ");
}
