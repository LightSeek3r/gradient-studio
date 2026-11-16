import { useI18n } from "../i18n/context";
import { layoutLane } from "../explain/lane";
import { locationText, type LedgerRow } from "../explain/ledger";
import { SeverityGlyph } from "./SeverityGlyph";

export interface IssueLaneProps {
  /** Ledger rows (biggest deduction first). */
  rows: readonly LedgerRow[];
  /** Positions (0-100) of the position-sorted stops. */
  positions: readonly number[];
  /** The issue highlighted from elsewhere (ledger row hovered or focused). */
  active: string | null;
  onActive: (code: string | null) => void;
  /** Marker activated: open that issue's ledger row. */
  onOpen: (code: string) => void;
  /** False on the touch layout: the lane is then a picture only (the ledger lists every issue as text). */
  interactive: boolean;
}

/**
 * The issue lane: directly under the stop bar and in its coordinate frame.
 * A finding that names a segment is a bracket under that segment; the stops a
 * finding names carry a marker whose shape encodes the severity. Hovering or
 * focusing a marker highlights its ledger row, and the other way round.
 */
export function IssueLane({ rows, positions, active, onActive, onOpen, interactive }: IssueLaneProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const layout = layoutLane(rows, positions, interactive ? 4 : 3);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const empty = layout.marks.length === 0;

  return (
    <div
      className={`issue-lane${empty ? " is-empty" : ""}${interactive ? "" : " is-static"}`}
      data-testid="issue-lane"
      role={interactive && !empty ? "group" : undefined}
      aria-label={interactive && !empty ? t("lane.group") : undefined}
      aria-hidden={interactive && !empty ? undefined : true}
      style={{ "--lane-rows": Math.max(1, layout.rows) } as React.CSSProperties}
    >
      {empty && <div className="issue-lane-track" />}
      {layout.marks.map((m) => {
        const row = byCode.get(m.code)!;
        const span = m.end - m.start;
        const cls = `lane-mark sev-${row.severity}${m.bracket ? " is-bracket" : ""}${span === 0 ? " is-point" : ""}${active === m.code ? " is-active" : ""}`;
        const style = { left: `${m.start}%`, width: `${span}%`, "--row": m.row } as React.CSSProperties;
        const where = locationText(row, i18n);
        const content = (
          <>
            <span className="lane-line" />
            {(m.bracket ? [(m.start + m.end) / 2] : m.stopPositions).map((p, i) => (
              <span key={i} className="lane-stop" style={{ left: span > 0 ? `${((p - m.start) / span) * 100}%` : "50%" }}>
                <SeverityGlyph severity={row.severity} size={10} />
              </span>
            ))}
          </>
        );
        if (!interactive) {
          return (
            <span key={m.code} className={cls} style={style} data-code={m.code}>
              {content}
            </span>
          );
        }
        return (
          <button
            key={m.code}
            type="button"
            className={cls}
            style={style}
            data-code={m.code}
            aria-label={t("lane.markAria", { name: row.name, points: row.pointsLost, where: where ? `, ${where}` : "" })}
            title={t("lane.markTitle", { name: row.name, points: row.pointsLost, where: where ? ` · ${where}` : "" })}
            onPointerEnter={() => onActive(m.code)}
            onPointerLeave={() => onActive(null)}
            onFocus={() => onActive(m.code)}
            onBlur={() => onActive(null)}
            onClick={() => onOpen(m.code)}
          >
            {content}
          </button>
        );
      })}
      {layout.overflow > 0 && (
        <span className="lane-overflow mono" title={t("lane.overflow", { count: layout.overflow })}>
          +{layout.overflow}
        </span>
      )}
    </div>
  );
}
