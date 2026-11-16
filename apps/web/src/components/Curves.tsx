import { useMemo } from "react";
import type { GradientTick } from "@opal42/gradient";
import { curvePath, sampleCurves, type CurveKey } from "../explain/curves";
import type { LedgerRow } from "../explain/ledger";
import { sortTicks } from "../state/document";
import { Icon } from "./ui/Icon";

const W = 1000;
const H = 44;
const PAD = 4;

/** Which chart(s) a finding is drawn on. Rhythm is about positions, so it shows on all three. */
function chartsOf(row: LedgerRow): readonly CurveKey[] {
  if (row.dimension === "rhythm") return ["lightness", "chroma", "hue"];
  return [row.dimension];
}

export interface CurvesProps {
  ticks: GradientTick[];
  rows: readonly LedgerRow[];
  active: string | null;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** `stage`: aligned under the stop bar; `panel`: stand-alone (mobile Score tab). */
  placement: "stage" | "panel";
}

/**
 * Lightness, chroma and hue along the gradient, on the stop bar's x-axis.
 * Sampled as the exported CSS paints (sRGB mixing between stops) and read in
 * OKLCH. Segments named by findings are shaded behind the matching curve.
 */
export function Curves({ ticks, rows, active, open, onToggle, placement }: CurvesProps) {
  const data = useMemo(() => sampleCurves(ticks), [ticks]);
  const sorted = sortTicks(ticks);
  if (!data) return null;
  const x = (p: number) => (p / 100) * W;

  return (
    <details className={`curves curves--${placement}`} open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary className="disclosure-summary curves-summary">
        <Icon name="chevron" size={14} className="disclosure-chevron" />
        Curves
        <span className="curves-hint">lightness, chroma and hue along the gradient</span>
      </summary>
      <div className="curves-body">
        {data.curves.map((c) => {
          const shaded = rows.filter((r) => chartsOf(r).includes(c.key));
          const range =
            c.min === null || c.max === null
              ? "–"
              : c.key === "hue"
                ? `${Math.round(c.max - c.min)}° span`
                : `${c.min.toFixed(2)}–${c.max.toFixed(2)}`;
          return (
            <figure key={c.key} className={`curve curve--${c.key}`}>
              <figcaption className="curve-caption">
                <span className="curve-label">{c.label}</span>
                <span className="curve-range mono">{range}</span>
              </figcaption>
              <svg
                className="curve-svg"
                viewBox={`0 ${-PAD} ${W} ${H + PAD * 2}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={c.summary}
              >
                <title>{c.summary}</title>
                {shaded.map((r) =>
                  r.segment ? (
                    <rect
                      key={r.code}
                      className={`curve-shade sev-${r.severity}${active === r.code ? " is-active" : ""}`}
                      x={x(r.segment[0])}
                      y={-PAD}
                      width={Math.max(4, x(r.segment[1]) - x(r.segment[0]))}
                      height={H + PAD * 2}
                    />
                  ) : (
                    (r.stops ?? []).map((i) =>
                      sorted[i] ? (
                        <rect
                          key={`${r.code}-${i}`}
                          className={`curve-shade is-stop sev-${r.severity}${active === r.code ? " is-active" : ""}`}
                          x={Math.min(W - 10, Math.max(0, x(sorted[i].position) - 5))}
                          y={-PAD}
                          width={10}
                          height={H + PAD * 2}
                        />
                      ) : null,
                    )
                  ),
                )}
                {sorted.map((t) => (
                  <line key={t.id} className="curve-tick" x1={x(t.position)} x2={x(t.position)} y1={-PAD} y2={H + PAD} vectorEffect="non-scaling-stroke" />
                ))}
                <path className="curve-line" d={curvePath(data.xs, c.values, c.domain, W, H)} vectorEffect="non-scaling-stroke" />
              </svg>
            </figure>
          );
        })}
        <p className="curves-note">
          As the exported CSS is painted (sRGB mixing between stops), measured in OKLCH. Thin lines are your stops; shaded
          spans are the issues listed in the score.
        </p>
      </div>
    </details>
  );
}
