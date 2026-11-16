import type { KeyboardEvent } from "react";
import {
  TAB_IDS,
  TAB_LABELS,
  badgeText,
  issueSuffix,
  nextTab,
  panelId,
  tabId,
  type TabId,
} from "../layout/tabs";

const TAB_ICONS: Record<TabId, React.ReactNode> = {
  // Stop-marker, gauge, compass, code: simple glyph-free SVGs so the bar reads at a glance.
  stops: (
    <>
      <rect x="3" y="9" width="18" height="6" rx="2" />
      <circle cx="8" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  score: (
    <>
      <path d="M4.5 16.5a8 8 0 1 1 15 0" />
      <path d="M12 14.5l3.5-4.5" />
    </>
  ),
  directions: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M14.8 9.2l-1.6 4-4 1.6 1.6-4z" />
    </>
  ),
  export: (
    <>
      <path d="M8.5 8L4.5 12l4 4" />
      <path d="M15.5 8l4 4-4 4" />
    </>
  ),
};

/**
 * Bottom tab bar for the one-panel-at-a-time mobile layout: a real tabs
 * pattern (roving tabindex, arrows/Home/End, automatic activation). The
 * Score tab carries a badge with the number of issues.
 */
export function MobileTabBar({
  active,
  onChange,
  issueCount,
  badgeColor,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
  issueCount: number;
  /** CSS colour of the Score badge (the live score band). */
  badgeColor: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTab(active, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <nav className="tabbar" aria-label="Panels">
      {/* The tabs inside are the focusable elements (roving tabindex); this container only routes arrow keys, as in the APG tabs pattern. */}
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div className="tabbar-list" role="tablist" aria-label="Panels" onKeyDown={onKeyDown}>
        {TAB_IDS.map((t) => {
          const selected = t === active;
          const badge = t === "score" ? issueCount : null;
          return (
            <button
              key={t}
              id={tabId(t)}
              type="button"
              role="tab"
              className={`tabbar-tab${selected ? " is-active" : ""}`}
              aria-selected={selected}
              aria-controls={panelId(t)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t)}
            >
              <span className="tabbar-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  focusable="false"
                >
                  {TAB_ICONS[t]}
                </svg>
                {badge ? (
                  <span className="tabbar-badge" style={{ background: badgeColor }}>
                    {badgeText(badge)}
                  </span>
                ) : null}
              </span>
              <span className="tabbar-label">{TAB_LABELS[t]}</span>
              {/* Spoken after the label, so the tab's name starts with its visible text. */}
              {badge ? <span className="sr-only">{issueSuffix(badge)}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
