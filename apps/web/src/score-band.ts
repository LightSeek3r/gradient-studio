// One source of truth for turning a 0-100 score into a label and colour, so the
// header chip, the analysis panel and the per-dimension bars never disagree.

export interface ScoreBand {
  /** Human label: Excellent / Good / Fair / Poor. */
  label: string;
  /** CSS colour token for text, borders and fills. */
  color: string;
  tone: "good" | "warn" | "bad";
}

export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return { label: "Excellent", color: "var(--score-good)", tone: "good" };
  if (score >= 65) return { label: "Good", color: "var(--score-good)", tone: "good" };
  if (score >= 45) return { label: "Fair", color: "var(--score-warn)", tone: "warn" };
  return { label: "Poor", color: "var(--score-bad)", tone: "bad" };
}
