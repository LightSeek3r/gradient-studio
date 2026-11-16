// One source of truth for turning a 0-100 score into a label and colour, so the
// header chip, the score strip and the tab badge never disagree.
//
// PLAN D5: the number is a smoothness score by our definition, not a quality
// verdict. The bands are therefore descriptive ("smooth" … "rough"), not grades
// ("Excellent" … "Poor"), and their colours are steps of one cool hue rather
// than a green/amber/red pass-fail signal.

import type { Translate } from "./i18n/translator";

export interface ScoreBand {
  /** Neutral description in the active language: smooth / mostly smooth / uneven / rough. */
  label: string;
  /** CSS colour token for text, borders and fills. */
  color: string;
  /** 1 (smooth) … 4 (rough). */
  level: 1 | 2 | 3 | 4;
}

export function scoreBand(score: number, t: Translate): ScoreBand {
  if (score >= 80) return { label: t("band.smooth"), color: "var(--band-1)", level: 1 };
  if (score >= 65) return { label: t("band.mostlySmooth"), color: "var(--band-2)", level: 2 };
  if (score >= 45) return { label: t("band.uneven"), color: "var(--band-3)", level: 3 };
  return { label: t("band.rough"), color: "var(--band-4)", level: 4 };
}

/** "+3", "−7" (a real minus sign), "±0". */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return "±0";
}

/** Spoken once when an edit gesture ends: "Score up 3, now 61". Empty when nothing changed. */
export function deltaSentence(from: number, to: number, t: Translate): string {
  const delta = to - from;
  if (delta === 0) return "";
  return t(delta > 0 ? "announce.scoreUp" : "announce.scoreDown", { delta: Math.abs(delta), score: to });
}
