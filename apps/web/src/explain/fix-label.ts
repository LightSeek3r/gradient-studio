// ── Localised label of a targeted fix ─────────────────────────────────────────
// Core's `proposeFixes` returns an English `label` ("Make stop 2 lighter").
// The app rebuilds the sentence from the fix's stable parts instead (its kind,
// the stops it edits and what it changed), so it reads in the active language.

import { hexToOklch, type Fix, type GradientTick } from "@opal42/gradient";
import type { I18n } from "../i18n/translator";

/** 1-based number of every tick in position order (ties keep array order, as CSS paints them). */
function stopNumbers(ticks: readonly GradientTick[]): Map<number, number> {
  const order = ticks.map((tick, i) => ({ id: tick.id, p: tick.position, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  return new Map(order.map((o, rank) => [o.id, rank + 1]));
}

export function fixLabel(fix: Pick<Fix<GradientTick[]>, "kind" | "changedStops" | "document" | "label">, ticks: readonly GradientTick[], i18n: I18n): string {
  const { t } = i18n;
  const numbers = stopNumbers(ticks);
  const changed = fix.changedStops.filter((i) => ticks[i] && fix.document[i]);
  if (changed.length === 0) return fix.label;
  const list = changed.map((i) => numbers.get(ticks[i].id) ?? i + 1).sort((a, b) => a - b);
  const refs = { count: list.length, list: i18n.list(list) };
  const who = t("stops.refThe", refs);
  const whoOf = t("stops.refOf", refs);
  const one = changed.length === 1 ? changed[0] : -1;
  switch (fix.kind) {
    case "lightness": {
      if (one < 0) return t("fix.label.lightnessMany", { who: whoOf });
      const lighter = hexToOklch(fix.document[one].color).L > hexToOklch(ticks[one].color).L;
      return t(lighter ? "fix.label.lighter" : "fix.label.darker", { who });
    }
    case "hue":
      return one < 0 ? t("fix.label.hueMany", { who: whoOf }) : t("fix.label.hueOne", { who: whoOf });
    case "chroma": {
      if (one < 0) return t("fix.label.chromaMany", { who: whoOf });
      const more = hexToOklch(fix.document[one].color).C > hexToOklch(ticks[one].color).C;
      return t(more ? "fix.label.chromaRaise" : "fix.label.chromaLower", { who: whoOf });
    }
    case "position":
      return one < 0
        ? t("fix.label.positionMany", { who })
        : t("fix.label.positionOne", { who, position: i18n.percent(fix.document[one].position) });
    default:
      return t("fix.label.mixed", { who });
  }
}
