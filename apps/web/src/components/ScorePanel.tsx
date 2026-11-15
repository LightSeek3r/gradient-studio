import { scoreBand, type ScoreBand } from "../score-band";
import { Icon } from "./ui/Icon";

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = (value / max) * 100;
  const color = scoreBand(pct).color;
  return (
    <div className="score-bar">
      <div className="score-bar-header">
        <span>{label}</span>
        <span className="mono" style={{ color }}>
          {value}/{max}
        </span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** The rail's header strip: the live score and its band, always in view on desktop. */
export function ScoreStrip({ score, band }: { score: number; band: ScoreBand }) {
  return (
    <div className="score-strip" style={{ "--band": band.color } as React.CSSProperties}>
      <span className="score-number mono">{score}</span>
      <span className="score-max">/100</span>
      <span className="score-badge" style={{ background: `color-mix(in srgb, ${band.color} 14%, transparent)` }}>
        {band.label}
      </span>
    </div>
  );
}

/**
 * Score details: the four dimension bars and the list of issues. The
 * `#score-ledger` container is where the points ledger (U2) will replace the
 * anonymous bars.
 */
export function ScoreDetails({
  details,
  issues,
  band,
}: {
  details: { lightness: number; hue: number; chroma: number; spacing: number };
  issues: string[];
  band: ScoreBand;
}) {
  return (
    <div id="score-ledger" className="score-ledger">
      <ScoreBar label="Lightness flow" value={details.lightness} max={30} />
      <ScoreBar label="Hue arc" value={details.hue} max={30} />
      <ScoreBar label="Chroma balance" value={details.chroma} max={20} />
      <ScoreBar label="Stop rhythm" value={details.spacing} max={20} />
      {issues.length > 0 && (
        <ul className="issues" aria-label="Issues">
          {issues.map((issue, i) => (
            <li key={i} className="issue">
              <Icon name={band.tone === "good" ? "info" : "alert"} size={14} className={`issue-icon${band.tone === "good" ? " is-neutral" : ""}`} />
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
