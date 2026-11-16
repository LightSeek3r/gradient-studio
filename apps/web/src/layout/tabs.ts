// ── Mobile panel tabs ─────────────────────────────────────────────────────────
// Pure helpers behind the bottom tab bar (the WAI-ARIA "tabs" pattern with
// automatic activation): which panels exist, which tab a key moves to, and
// the spoken suffix of a tab that carries a badge.

import type { Translate } from "../i18n/translator";

export const TAB_IDS = ["stops", "score", "directions", "export"] as const;
export type TabId = (typeof TAB_IDS)[number];

/** The visible name of a tab in the active language. */
export function tabLabel(tab: TabId, t: Translate): string {
  return t(`tabs.${tab}`);
}

export const DEFAULT_TAB: TabId = "stops";

/** The ids that wire a tab to its panel. */
export const tabId = (t: TabId) => `tab-${t}`;
export const panelId = (t: TabId) => `panel-${t}`;

/**
 * The tab a key press moves to, or null when the key isn't a tab-navigation
 * key. Arrows wrap around; Home/End jump to the ends.
 */
export function nextTab(current: TabId, key: string, tabs: readonly TabId[] = TAB_IDS): TabId | null {
  const i = tabs.indexOf(current);
  if (i === -1 || tabs.length === 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return tabs[(i + 1) % tabs.length];
    case "ArrowLeft":
    case "ArrowUp":
      return tabs[(i - 1 + tabs.length) % tabs.length];
    case "Home":
      return tabs[0];
    case "End":
      return tabs[tabs.length - 1];
    default:
      return null;
  }
}

/** Spoken after the "Score" label, e.g. ", 2 issues" (empty without a badge). */
export function issueSuffix(badge: number | null, t: Translate): string {
  if (badge === null || badge <= 0) return "";
  return t("tabs.issues", { count: badge });
}

/** The text of a tab badge: capped so it never outgrows its pill. */
export function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count);
}
