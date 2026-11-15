import type { Suggestion } from "../suggest/compare";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Segmented } from "./ui/Segmented";

export type CompareView = "original" | "suggested";

const VIEW_OPTIONS = [
  { value: "original" as const, label: "Original" },
  { value: "suggested" as const, label: "Suggested" },
];

/** Original | Suggested segmented control: what the sticky preview and Export show. */
export function CompareToggle({ view, onView }: { view: CompareView; onView: (v: CompareView) => void }) {
  return (
    <Segmented
      label="Preview"
      options={VIEW_OPTIONS}
      value={view}
      onChange={onView}
      className="compare-toggle"
    />
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
        <Button variant="primary" icon="sparkles" block onClick={onSuggest}>
          Suggest
        </Button>
      </div>
    );
  }
  if (!suggestion.useful) {
    return (
      <p className="suggest-note" role="note">
        <Icon name="info" size={14} />
        <span>{suggestion.reason}</span>
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
        Score <span className="delta-before mono">{before}</span> → <span className="delta-after mono">{after}</span>
        <span className="delta-gain mono"> ({after - before >= 0 ? "+" : ""}{after - before})</span>
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
              <span className="diff-text mono">
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
        <Button variant="primary" icon="check" onClick={onApplySelected} disabled={selectedChanged === 0}>
          Apply selected ({selectedChanged})
        </Button>
        <Button variant="secondary" onClick={onApplyAll}>
          Apply all
        </Button>
      </div>
    </div>
  );
}
