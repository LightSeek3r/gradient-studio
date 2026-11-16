// ── Issue lane layout (pure) ──────────────────────────────────────────────────
// Places each located finding on the stop bar's x-axis and stacks overlapping
// ones into rows, biggest deduction first.

import type { LedgerRow } from "./ledger";

export interface LaneMark {
  code: string;
  /** 0-based row, top first. */
  row: number;
  /** Extent on the bar, positions 0-100 (`start === end` for a single stop). */
  start: number;
  end: number;
  /** True when the finding names a segment (drawn as a bracket). */
  bracket: boolean;
  /** Positions (0-100) of the stops the finding names (drawn as markers). */
  stopPositions: number[];
}

export interface LaneLayout {
  marks: LaneMark[];
  rows: number;
  /** Located findings that did not fit in `maxRows`. */
  overflow: number;
}

/** Marks closer than this (percent of the bar) are considered overlapping. */
export const LANE_CLEARANCE = 5;

export function layoutLane(rows: readonly LedgerRow[], positions: readonly number[], maxRows = 4): LaneLayout {
  const marks: LaneMark[] = [];
  const occupied: [number, number][][] = [];
  let overflow = 0;
  for (const r of rows) {
    const stopPositions = (r.stops ?? []).map((i) => positions[i]).filter((p): p is number => typeof p === "number" && Number.isFinite(p));
    const extent = [...stopPositions, ...(r.segment ?? [])];
    if (extent.length === 0) continue;
    const start = Math.min(...extent);
    const end = Math.max(...extent);
    let row = 0;
    while (row < occupied.length && occupied[row].some(([a, b]) => start < b + LANE_CLEARANCE && end > a - LANE_CLEARANCE)) row++;
    if (row >= maxRows) {
      overflow++;
      continue;
    }
    (occupied[row] ??= []).push([start, end]);
    marks.push({ code: r.code, row, start, end, bracket: r.segment !== undefined, stopPositions });
  }
  return { marks, rows: occupied.length, overflow };
}
