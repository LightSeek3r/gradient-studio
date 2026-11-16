import { useCallback, useMemo, useRef, useState } from "react";
import { sortEntries, type Entry, type SortKey } from "../lib/analyze";
import { makeEvalFn, type DevtoolsApi } from "../lib/devtools-api";
import { copyText } from "../lib/copy";
import { highlightExpression, inspectExpression } from "../lib/highlight";
import { loadSettings, saveSettings } from "../lib/settings";
import { scanNotices } from "../lib/notices";
import { GradientCard, type CardActions } from "./GradientCard";
import { SettingsForm } from "./SettingsForm";
import { useScanner } from "./use-scanner";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score-asc", label: "Lowest score first" },
  { key: "score-desc", label: "Highest score first" },
  { key: "usage", label: "Most used" },
  { key: "page", label: "Order found" },
];

export function App({ api }: { api: DevtoolsApi | null }) {
  const { state, rescan } = useScanner(api);
  const [sort, setSort] = useState<SortKey>("score-asc");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(() => loadSettings());
  const [toast, setToast] = useState({ text: "", n: 0 });
  const evalFn = useMemo(() => (api ? makeEvalFn(api) : null), [api]);
  const toastCount = useRef(0);

  const say = useCallback((text: string) => {
    toastCount.current++;
    // A trailing non-breaking space on alternate messages makes a repeated message announce again.
    setToast({ text: toastCount.current % 2 ? text : `${text}\u00a0`, n: toastCount.current });
  }, []);

  const runOnPage = useCallback(
    async (expression: string | null, done: string) => {
      if (!evalFn || !expression) return say("Could not reach the page.");
      try {
        const result = await evalFn(expression);
        if (result === "missing") say("That element is no longer on the page.");
        else if (result === "ok") say(done);
        else say("Could not reach that element.");
      } catch {
        say("Could not reach the page.");
      }
    },
    [evalFn, say],
  );

  const actions: CardActions = useMemo(
    () => ({
      studioUrl: settings.studioUrl,
      copy: (text, what) => {
        void copyText(text).then((ok) => say(ok ? `Copied ${what}.` : "Copying was blocked. Select the CSS text and copy it by hand."));
      },
      highlight: (path) => void runOnPage(highlightExpression(path), "Highlighted on the page."),
      inspect: (path) => void runOnPage(inspectExpression(path), "Selected in the Elements panel."),
    }),
    [settings.studioUrl, say, runOnPage],
  );

  const sorted = useMemo(() => sortEntries(state.entries, sort), [state.entries, sort]);
  const scored = sorted.filter((e): e is Extract<Entry, { status: "scored" }> => e.status === "scored");
  const unscored = sorted.filter((e) => e.status === "not-scored");
  const notices = scanNotices(state.stats, state.group?.droppedGroups ?? 0);
  const scanning = state.phase === "scanning";

  return (
    <>
      <header className="bar">
        <h1>Gradients</h1>
        <label className="field-inline">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary" onClick={rescan} disabled={!api || scanning} aria-disabled={!api || scanning}>
          {scanning ? "Scanning…" : "Re-scan"}
        </button>
        <button type="button" className="btn" aria-expanded={settingsOpen} aria-controls="settings-panel" onClick={() => setSettingsOpen((v) => !v)}>
          Settings
        </button>
      </header>
      {scanning && (
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
      )}

      <div id="settings-panel" hidden={!settingsOpen}>
        {settingsOpen && (
          <SettingsForm
            value={settings.studioUrl}
            onSave={(url) => {
              const saved = saveSettings(url);
              if (!saved) return false;
              setSettings(saved);
              say("Settings saved.");
              return true;
            }}
          />
        )}
      </div>

      {/* Polite live regions: the result count, and the outcome of copy/highlight clicks. */}
      <p className="status" role="status" aria-live="polite" data-testid="count">
        {state.announcement}
      </p>
      <p className="sr-only" role="status" aria-live="polite" data-testid="toast">
        {toast.text}
      </p>
      {toast.text.trim() && (
        <p className="hint" style={{ padding: "0 12px" }} aria-hidden="true">
          {toast.text}
        </p>
      )}

      {!api && (
        <p className="notice is-error">This page is not running inside DevTools. Open DevTools on a web page and choose the “Gradients” panel.</p>
      )}
      {state.error && (
        <p className="notice is-error" role="alert">
          The page could not be scanned: {state.error}. Pages such as the browser’s own settings and extension stores do not allow it.
        </p>
      )}
      {notices.length > 0 && (
        <ul className="notices" aria-label="What the scan did not cover">
          {notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <main aria-busy={scanning}>
        {state.phase === "done" && state.summary.total === 0 && (
          <p className="empty">
            No gradients found. The panel reads computed styles of elements (background, border-image, mask, list-style-image), custom properties and
            same-origin stylesheets.
          </p>
        )}

        {scored.length > 0 && (
          <section aria-labelledby="scored-title">
            <h2 className="list-title" id="scored-title">
              Scored ({scored.length})
            </h2>
            <ul className="cards">
              {scored.map((entry, i) => (
                <li key={entry.id}>
                  <GradientCard entry={entry} index={i} actions={actions} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {unscored.length > 0 && (
          <section aria-labelledby="unscored-title">
            <details>
              <summary className="list-title" id="unscored-title">
                Not scored ({unscored.length})
              </summary>
              <ul className="cards">
                {unscored.map((entry, i) => (
                  <li key={entry.id}>
                    <GradientCard entry={entry} index={i} actions={actions} />
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )}
      </main>

      <footer>
        Smoothness score 0–100 by the Opal42 v1 definition (spec/scoring-v1.md): it describes how evenly a gradient moves through colour and is not a
        verdict on a design. Everything runs on this device; the panel makes no network requests.
      </footer>
    </>
  );
}
