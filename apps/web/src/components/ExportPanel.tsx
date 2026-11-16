import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { GradientBlendMode, GradientDirection, GradientStyle, GradientTick } from "@opal42/gradient";
import { writeClipboardText } from "../clipboard";
import {
  DEFAULT_EXPORT_KEY,
  EXPORT_TABS,
  buildExportViews,
  nextExportKey,
  type ExportKey,
} from "../export/export-model";
import { useT } from "../i18n/context";
import { FlashButton } from "./fields";
import { Surface } from "./ui/Surface";

const tabDomId = (k: ExportKey) => `export-tab-${k}`;
const PANEL_ID = "export-tabpanel";

/**
 * Export tabs: the CSS tab (the app's own, multi-direction aware) and one tab
 * per other format of `@opal42/gradient/export`. Shows exactly what the
 * preview shows: `ticks` is the preview's stop list (the suggestion while the
 * suggested view is active).
 */
export function ExportPanel({
  ticks,
  directions,
  blend,
  style,
  showingSuggested,
}: {
  ticks: readonly GradientTick[];
  directions: readonly GradientDirection[];
  blend: GradientBlendMode;
  style: GradientStyle;
  showingSuggested: boolean;
}) {
  const t = useT();
  const [key, setKey] = useState<ExportKey>(DEFAULT_EXPORT_KEY);
  const views = useMemo(() => buildExportViews(ticks, directions, blend, style, t), [ticks, directions, blend, style, t]);
  const view = views[key];
  const tabRefs = useRef<Partial<Record<ExportKey, HTMLButtonElement | null>>>({});
  const text = view.lines.join("\n");

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextExportKey(key, e.key);
    if (!next) return;
    e.preventDefault();
    setKey(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <Surface as="section" aria-labelledby="export-h" className="export-panel">
      <div className="panel-head">
        <h2 className="panel-title" id="export-h">
          {showingSuggested ? t("export.titleSuggested") : t("export.title")}
        </h2>
        <FlashButton
          key={key}
          icon="copy"
          label={t("export.copy", { label: view.label })}
          variant="primary"
          size="sm"
          title={t("export.copyTitle", { label: view.label })}
          okLabel={t("common.copied")}
          errLabel={t("common.copyFailed")}
          okMessage={t("export.copiedSr", { label: view.label })}
          errMessage={t("common.copyFailed")}
          onRun={() => (view.unsupported === null ? writeClipboardText(text) : false)}
        />
      </div>

      <div
        className="segmented segmented--sm export-tabs"
        role="tablist"
        aria-label={t("export.tabs")}
      >
        {EXPORT_TABS.map((tab) => {
          const active = tab.key === key;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[tab.key] = el;
              }}
              type="button"
              role="tab"
              id={tabDomId(tab.key)}
              aria-selected={active}
              aria-controls={PANEL_ID}
              tabIndex={active ? 0 : -1}
              className={`segmented-item${active ? " is-active" : ""}`}
              onClick={() => setKey(tab.key)}
              onKeyDown={onKeyDown}
            >
              {views[tab.key].label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabDomId(key)} className="export-body">
        <p className="export-meta">
          <span className="export-lang">{view.language}</span>
          {view.native && <span className="export-badge">{t("export.untested")}</span>}
        </p>
        {view.scope && (
          <p className="export-note export-scope" role="note">
            {view.scope}
          </p>
        )}
        {view.unsupported === null ? (
          <pre
            className="export-code"
            data-format={view.key}
            // A scrollable code block must be reachable by keyboard (axe: scrollable-region-focusable).
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-label={t(showingSuggested ? "export.codeLabelSuggested" : "export.codeLabel", { label: view.label })}
          >
            {view.lines.map((line, i) => (
              <div key={i}>{line === "" ? "\u00a0" : line}</div>
            ))}
          </pre>
        ) : (
          <p className="export-note">
            {t("export.unsupported", { reason: view.unsupported })}
          </p>
        )}
        {view.notes.length > 0 && (
          <ul className="export-notes">
            {view.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {showingSuggested && (
          <p className="export-note">
            {t("export.suggestedNote")}
          </p>
        )}
      </div>
    </Surface>
  );
}
