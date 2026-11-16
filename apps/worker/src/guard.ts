// CPU guards: reject requests whose total work would be too large, before any
// scoring runs. Pure, cheap (one linear scan of at most 32 KB), never throws.

import { DEFAULT_REFINE_MAX_STOPS, MAX_STOPS_PER_REQUEST } from "./limits";

export interface Budget {
  /** Total stops one refine_gradient request may contain. 0 disables the tool. */
  refineMaxStops: number;
}

export function parseBudget(refineMaxStops: unknown): Budget {
  const n = typeof refineMaxStops === "string" && /^\d{1,4}$/.test(refineMaxStops.trim()) ? Number(refineMaxStops.trim()) : DEFAULT_REFINE_MAX_STOPS;
  return { refineMaxStops: n };
}

const PRELUDE = /^\s*(?:[-+]?(?:\d+\.?\d*|\.\d+)(?:deg|grad|rad|turn)|to\s|in\s|from\s)/i;

/**
 * An estimate of the stops in some css: for every gradient function, its
 * top-level commas, plus one unless the first argument is an angle, a
 * `to <side>` or an `in <space>` clause. Commas inside nested functions
 * (rgb(1, 2, 3)) are not counted. Colour hints count as stops (safe side).
 */
export function estimateCssStops(css: string): number {
  const open: boolean[] = []; // per open "(": is it a gradient function?
  let stops = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css.charCodeAt(i);
    if (c === 40 /* ( */) {
      const isGradient = i >= 8 && css.startsWith("gradient", i - 8);
      open.push(isGradient);
      if (isGradient && !PRELUDE.test(css.slice(i + 1, i + 40))) stops += 1;
    } else if (c === 41 /* ) */) {
      open.pop();
    } else if (c === 44 /* , */ && open.length > 0 && open[open.length - 1] === true) {
      stops += 1;
    }
  }
  return stops;
}

export function estimateStops(args: unknown): number {
  if (typeof args !== "object" || args === null) return 0;
  const a = args as Record<string, unknown>;
  let n = 0;
  if (Array.isArray(a.stops)) n += a.stops.length;
  if (typeof a.css === "string") n += estimateCssStops(a.css);
  return n;
}

/** A refusal message for a tool call that is too heavy, or null when it may run. */
export function overBudget(tool: string, args: unknown, budget: Budget): string | null {
  if (tool === "refine_gradient") {
    if (budget.refineMaxStops === 0) return "refine_gradient is disabled on this deployment (it needs more CPU than the plan allows); use score_gradient, or run the stdio server locally";
    const n = estimateStops(args);
    if (n > budget.refineMaxStops) {
      return `refine_gradient accepts at most ${budget.refineMaxStops} stops in total per request on this deployment (this request has about ${n}); send fewer or smaller gradients, or run the stdio server locally`;
    }
    return null;
  }
  if (tool === "score_gradient" || tool === "render_preview") {
    const n = estimateStops(args);
    if (n > MAX_STOPS_PER_REQUEST) {
      return `${tool} accepts at most ${MAX_STOPS_PER_REQUEST} stops in total per request on this deployment (this request has about ${n}); send fewer gradients per call`;
    }
  }
  return null;
}
