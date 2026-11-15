// ── Generic undo/redo history ─────────────────────────────────────────────────
// Wraps any pure reducer. Pure itself: the caller passes the time, so tests
// can drive coalescing without timers.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Coalescing key of the last recorded step (null = next step is new). */
  lastKey: string | null;
  /** Time (ms) of the last recorded step. */
  lastTime: number;
}

export type HistoryAction<A, T> =
  /** Apply `action`; steps with the same `key` within the window merge. */
  | { type: "do"; action: A; key?: string; time: number }
  | { type: "undo" }
  | { type: "redo" }
  /** End the current coalescing run (pointer up, field blur). */
  | { type: "commit" }
  /** Replace everything with a fresh history at `present` (no undo). */
  | { type: "load"; present: T };

export interface HistoryOptions {
  /** Maximum number of undo steps kept. */
  limit?: number;
  /** Same-key steps closer together than this merge into one. */
  coalesceMs?: number;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 800;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastTime: -Infinity };
}

export function createHistoryReducer<T, A>(
  reducer: (state: T, action: A) => T,
  { limit = HISTORY_LIMIT, coalesceMs = COALESCE_MS }: HistoryOptions = {},
) {
  return function historyReducer(h: History<T>, ha: HistoryAction<A, T>): History<T> {
    switch (ha.type) {
      case "do": {
        const next = reducer(h.present, ha.action);
        if (next === h.present) return h; // no-op: record nothing
        const key = ha.key ?? null;
        const coalesce =
          key !== null && key === h.lastKey && ha.time - h.lastTime <= coalesceMs && h.past.length > 0;
        if (coalesce) {
          return { ...h, present: next, future: [], lastTime: ha.time };
        }
        const past = [...h.past, h.present];
        if (past.length > limit) past.splice(0, past.length - limit);
        return { past, present: next, future: [], lastKey: key, lastTime: ha.time };
      }
      case "undo": {
        if (h.past.length === 0) return h;
        const past = h.past.slice(0, -1);
        return {
          past,
          present: h.past[h.past.length - 1],
          future: [h.present, ...h.future],
          lastKey: null,
          lastTime: -Infinity,
        };
      }
      case "redo": {
        if (h.future.length === 0) return h;
        return {
          past: [...h.past, h.present],
          present: h.future[0],
          future: h.future.slice(1),
          lastKey: null,
          lastTime: -Infinity,
        };
      }
      case "commit":
        return h.lastKey === null ? h : { ...h, lastKey: null };
      case "load":
        return createHistory(ha.present);
    }
  };
}
