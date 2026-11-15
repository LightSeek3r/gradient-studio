import type { Suggestion } from "../suggest/compare";

export type CompareView = "original" | "suggested";

/** Original | Suggested segmented control, shown directly above the preview. */
export function CompareToggle({ view, onView }: { view: CompareView; onView: (v: CompareView) => void }) {
  return (
    <div className="btn-row toggle-row compare-toggle" role="group" aria-label="Preview">
      <button
        type="button"
        className={`btn btn-toggle ${view === "original" ? "active" : ""}`}
        aria-pressed={view === "original"}
        onClick={() => onView("original")}
      >
        Original
      </button>
      <button
        type="button"
        className={`btn btn-toggle ${view === "suggested" ? "active" : ""}`}
        aria-pressed={view === "suggested"}
        onClick={() => onView("suggested")}
      >
        Suggested
      </button>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="diff-swatch" style={{ background: color }} aria-hidden="true" />;
}

/**
 * The refinement panel body: Suggest, or (once computed) the score delta, a
 * per-stop diff with checkboxes and Apply selected / Apply all, or the reason
 * refine declined.
 */
export function SuggestionPanel({
  suggestion,
  selected,
  selectedScore,
  onSuggest,
  onToggle,
  onApplySelected,
  onApplyAll,
}: {
  suggestion: Suggestion | null;
  selected: ReadonlySet<number>;
  /** Score of the original with only the selected stops changed. */
  selectedScore: number | null;
  onSuggest: () => void;
  onToggle: (id: number) => void;
  onApplySelected: () => void;
  onApplyAll: () => void;
}) {
  if (!suggestion) {
    return (
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={onSuggest}>
          ✦ Suggest
        </button>
      </div>
    );
  }
  if (!suggestion.useful) {
    return (
      <p className="suggest-note" role="note">
        {suggestion.reason}
      </p>
    );
  }

  const { before, after } = suggestion.result;
  const changed = suggestion.diffs.filter((d) => d.changed);
  const selectedChanged = changed.filter((d) => selected.has(d.id)).length;
  const fmt = (n: number) => `${Math.round(n * 100) / 100}%`;

  return (
    <div className="suggestion">
      <p className="suggest-delta">
        Score <span className="delta-before">{before}</span> → <span className="delta-after">{after}</span>
        <span className="delta-gain"> ({after - before >= 0 ? "+" : ""}{after - before})</span>
        {selectedScore !== null && selectedChanged < changed.length && (
          <span className="delta-selected"> · selected only: {selectedScore}</span>
        )}
      </p>
      <ul className="diff-list" aria-label="Suggested changes per stop">
        {suggestion.diffs.map((d) => (
          <li key={d.id} className={`diff-row${d.changed ? "" : " is-same"}`}>
            <label className="diff-label">
              <input
                type="checkbox"
                checked={selected.has(d.id)}
                disabled={!d.changed}
                onChange={() => onToggle(d.id)}
                aria-label={`Apply change to stop ${d.index}`}
              />
              <span className="diff-stop">Stop {d.index}</span>
              <Swatch color={d.before.color} />
              <span className="diff-arrow" aria-hidden="true">→</span>
              <Swatch color={d.after.color} />
              <span className="diff-text">
                {d.before.color === d.after.color ? d.before.color : `${d.before.color} → ${d.after.color}`}
                {", "}
                {d.before.position === d.after.position
                  ? fmt(d.before.position)
                  : `${fmt(d.before.position)} → ${fmt(d.after.position)}`}
                {!d.changed && " (unchanged)"}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="btn-row">
        <button type="button" className="btn btn-apply" onClick={onApplySelected} disabled={selectedChanged === 0}>
          Apply selected ({selectedChanged})
        </button>
        <button type="button" className="btn btn-apply" onClick={onApplyAll}>
          Apply all
        </button>
      </div>
    </div>
  );
}
