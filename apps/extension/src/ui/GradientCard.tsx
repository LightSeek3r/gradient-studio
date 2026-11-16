import { useId, useState } from "react";
import { GROUP_LIMITS, type Entry, type ScoredEntry, type Usage } from "../lib/analyze";
import { studioLink } from "../lib/studio-link";
import { SeverityGlyph } from "./SeverityGlyph";

export interface CardActions {
  /** Copy text; resolves to a message for the status region. */
  copy: (text: string, what: string) => void;
  highlight: (path: string) => void;
  inspect: (path: string) => void;
  studioUrl: string;
}

function Swatch({ css }: { css: string | null }) {
  if (!css) {
    return (
      <div className="swatch is-empty" role="img" aria-label="No preview">
        no preview
      </div>
    );
  }
  return (
    <div className="swatch" role="img" aria-label="Preview of the gradient">
      <span style={{ backgroundImage: css }} />
    </div>
  );
}

function UsageList({ entry, actions }: { entry: Entry; actions: CardActions }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const shown = all ? entry.usages : entry.usages.slice(0, GROUP_LIMITS.usagesShown);
  const more = entry.usages.length - shown.length;
  const unlisted = entry.usageCount - entry.usages.length;
  const elements = entry.usages.filter((u) => u.path !== "").length;
  const rules = entry.usages.length - elements;
  const summary = [
    elements > 0 ? `${elements}${unlisted > 0 ? "+" : ""} element${elements === 1 ? "" : "s"}` : "",
    rules > 0 ? `${rules} rule${rules === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <details open>
      <summary className="section-title">Used by ({summary || entry.usageCount})</summary>
      <ul className="usages" id={listId}>
        {shown.map((u, i) => (
          <UsageRow key={`${u.path}|${u.selector}|${u.origin}|${i}`} usage={u} actions={actions} />
        ))}
      </ul>
      {(more > 0 || unlisted > 0) && (
        <p className="hint">
          {more > 0 && (
            <button type="button" className="btn btn-quiet btn-sm" aria-controls={listId} aria-expanded={all} onClick={() => setAll(true)}>
              Show {more} more
            </button>
          )}
          {unlisted > 0 && ` ${unlisted} more not listed (limit ${GROUP_LIMITS.maxUsagesStored}).`}
        </p>
      )}
    </details>
  );
}

function UsageRow({ usage, actions }: { usage: Usage; actions: CardActions }) {
  const where = usage.origin ? ` in ${usage.origin}` : "";
  return (
    <li>
      <span className="sel">{usage.selector}</span>
      <span className="prop">
        {usage.property}
        {where}
      </span>
      {usage.path !== "" && (
        <>
          <button
            type="button"
            className="btn btn-sm"
            aria-label={`Highlight ${usage.selector} on the page`}
            onClick={() => actions.highlight(usage.path)}
          >
            Highlight
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            aria-label={`Show ${usage.selector} in the Elements panel`}
            onClick={() => actions.inspect(usage.path)}
          >
            Elements
          </button>
        </>
      )}
    </li>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function ScoredCard({ entry, actions, index }: { entry: ScoredEntry; actions: CardActions; index: number }) {
  const titleId = useId();
  const { studio } = entry;
  const studioHref = studio.ok ? studioLink(actions.studioUrl, studio.hash) : "";
  const reasonId = useId();

  return (
    <article className="card" aria-labelledby={titleId} data-testid="gradient-card">
      <div className="card-head">
        <Swatch css={entry.swatch} />
        <div>
          <h3 className="card-title" id={titleId}>
            Gradient {index + 1}
          </h3>
          <p className="card-sub">
            Linear · {entry.usageCount} {entry.usageCount === 1 ? "place" : "places"}
            {entry.issues.length > 0 ? ` · ${entry.issues.length} ${entry.issues.length === 1 ? "issue" : "issues"}` : " · no issues"}
          </p>
        </div>
        <p className="score">
          <span className="score-label">Smoothness score</span>
          <span className="score-num" data-testid="score">
            {entry.score}
          </span>
          <span className="score-of"> / 100</span>
        </p>
      </div>

      <pre className="css-text" aria-label="Gradient CSS">
        {entry.normalizedCss}
      </pre>

      <div className="actions">
        <button type="button" className="btn" onClick={() => actions.copy(entry.normalizedCss, "CSS")}>
          Copy CSS
        </button>
        {entry.refined && (
          <button type="button" className="btn btn-primary" onClick={() => actions.copy(entry.refined!.css, "refined CSS")}>
            Copy refined CSS (+{entry.refined.gain})
          </button>
        )}
        {studio.ok ? (
          <a className="btn" href={studioHref} target="_blank" rel="noopener noreferrer">
            Open in Gradient Studio
          </a>
        ) : (
          <button type="button" className="btn" aria-disabled="true" aria-describedby={reasonId}>
            Open in Gradient Studio
          </button>
        )}
      </div>
      {!studio.ok && (
        <p className="hint" id={reasonId}>
          Not available for this gradient: {studio.reason}
        </p>
      )}

      {entry.fixes.length > 0 && (
        <div>
          <h4 className="section-title" style={{ margin: "0 0 4px" }}>
            Targeted fixes
          </h4>
          <div className="actions">
            {entry.fixes.map((fix) => (
              <button
                key={fix.code}
                type="button"
                className="btn"
                title={`Score ${entry.score} → ${fix.scoreAfter}. Removes: ${fix.code}`}
                onClick={() => actions.copy(fix.css, `fix "${fix.label}"`)}
              >
                Copy fix: {fix.label} (+{fix.gain})
              </button>
            ))}
          </div>
        </div>
      )}

      {entry.issues.length > 0 && (
        <details open>
          <summary className="section-title">What lowered the score ({entry.issues.length})</summary>
          <ul className="issues">
            {entry.issues.map((issue) => (
              <li className="issue" key={issue.code}>
                <SeverityGlyph severity={issue.severity} />
                <div>
                  <div className="issue-head">
                    <span className="issue-name">{issue.name}</span>
                    <span className="issue-points">
                      −{issue.pointsLost}
                      <span className="sr-only"> points, {issue.severityLabel}</span>
                    </span>
                    {issue.where && <span className="issue-where">{issue.where}</span>}
                    <span className="code-tag">{issue.code}</span>
                  </div>
                  <p>{issue.measures}</p>
                  <p className="detail">{issue.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Notes notes={entry.notes} />
      <UsageList entry={entry} actions={actions} />
    </article>
  );
}

function UnscoredCard({ entry, actions, index }: { entry: Exclude<Entry, ScoredEntry>; actions: CardActions; index: number }) {
  const titleId = useId();
  return (
    <article className="card" aria-labelledby={titleId} data-testid="unscored-card">
      <div className="card-head">
        <Swatch css={entry.swatch} />
        <div>
          <h3 className="card-title" id={titleId}>
            Not scored {index + 1}
          </h3>
          <p className="card-sub">
            {entry.kind[0].toUpperCase() + entry.kind.slice(1)} · {entry.usageCount} {entry.usageCount === 1 ? "place" : "places"}
          </p>
        </div>
      </div>
      <p className="reason">
        {entry.reason} <span className="code-tag">{entry.code}</span>
      </p>
      <pre className="css-text" aria-label="Gradient CSS as found">
        {entry.css}
      </pre>
      <Notes notes={entry.notes} />
      <UsageList entry={entry} actions={actions} />
    </article>
  );
}

export function GradientCard({ entry, actions, index }: { entry: Entry; actions: CardActions; index: number }) {
  return entry.status === "scored" ? (
    <ScoredCard entry={entry} actions={actions} index={index} />
  ) : (
    <UnscoredCard entry={entry} actions={actions} index={index} />
  );
}
