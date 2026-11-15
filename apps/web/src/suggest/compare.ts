// ── Honest suggestion compare (pure) ──────────────────────────────────────────
// Wraps core `refineGradient` for the UI: per-stop diffs, partial apply and
// plain-language reasons when refine declines.

import { refineGradient, scoreGradient, type GradientTick, type RefineResult } from "@opal42/gradient";
import { sortTicks } from "../state/document";

export interface StopDiff {
  id: number;
  /** 1-based number of the stop in the ORIGINAL's position order. */
  index: number;
  before: { color: string; position: number };
  after: { color: string; position: number };
  changed: boolean;
}

export interface Suggestion {
  /** The ticks the suggestion was computed from (by reference). */
  base: GradientTick[];
  result: RefineResult;
  diffs: StopDiff[];
  /** True when refine accepted AND at least one stop actually differs. */
  useful: boolean;
  /** Why there is nothing to apply, in words (when !useful). */
  reason?: string;
}

export function declineReason(result: RefineResult, ticks: GradientTick[]): string {
  switch (result.declined) {
    case "unscorable":
      return `This gradient can't be scored (${scoreGradient(ticks).reason ?? "outside the scoring domain"}), so there is nothing to refine.`;
    case "single-position":
      return "All stops sit at one position (a hard stop), so there is nothing to redistribute.";
    case "would-lower-score":
      return `No refinement scores higher than your gradient (${result.before}), so it is left as is.`;
    default:
      return "Your stops are already where the refinement would put them.";
  }
}

export function computeSuggestion(ticks: GradientTick[]): Suggestion {
  const result = refineGradient(ticks);
  const byId = new Map(result.stops.map((t) => [t.id, t]));
  const diffs: StopDiff[] = sortTicks(ticks).map((t, i) => {
    const s = byId.get(t.id) ?? t;
    return {
      id: t.id,
      index: i + 1,
      before: { color: t.color, position: t.position },
      after: { color: s.color, position: s.position },
      changed: s.color !== t.color || s.position !== t.position,
    };
  });
  const useful = result.refined && diffs.some((d) => d.changed);
  return {
    base: ticks,
    result,
    diffs,
    useful,
    reason: useful ? undefined : declineReason(result, ticks),
  };
}

/** The original with only the `selected` stops taken from the suggestion. */
export function candidateTicks(s: Suggestion, selected: ReadonlySet<number>): GradientTick[] {
  const byId = new Map(s.result.stops.map((t) => [t.id, t]));
  return s.base.map((t) => {
    const next = selected.has(t.id) ? byId.get(t.id) : undefined;
    return next ? { id: t.id, color: next.color, position: next.position } : t;
  });
}
