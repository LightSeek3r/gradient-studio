import { useId, useRef, useState } from "react";
import {
  MAX_DIRECTIONS,
  type GradientBlendMode,
  type GradientDirection,
} from "@opal42/gradient";
import { useT } from "../i18n/context";
import type { Translate } from "../i18n/translator";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Segmented } from "./ui/Segmented";
import { Surface } from "./ui/Surface";

/** Per-direction identity colors for the compass and row markers. */
const DIRECTION_COLORS = [
  "#7c85ff",
  "#3dd68c",
  "#e8c84a",
  "#f06060",
  "#e879f9",
  "#38bdf8",
  "#fb923c",
];

const BLEND_VALUES: readonly GradientBlendMode[] = [
  "normal",
  "screen",
  "multiply",
  "overlay",
  "soft-light",
  "hard-light",
  "lighten",
  "darken",
  "difference",
];

function blendName(mode: GradientBlendMode, t: Translate): string {
  return t(`blend.${mode}.name`);
}

function blendLabel(mode: GradientBlendMode, t: Translate): string {
  return `${t(`blend.${mode}.name`)} — ${t(`blend.${mode}.hint`)}`;
}

const COMPASS_RADIUS = 62;

/** CSS angle (0 = to top, clockwise) → unit vector in screen coordinates. */
function angleToVector(angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

// ── Compass ───────────────────────────────────────────────────────────────────

/**
 * Shows every active direction as a spoke and lets each be dragged (pointer
 * events with capture: mouse, pen and touch) or turned with the keyboard
 * (each handle is an ARIA slider). Reading seven angles as numbers is hard;
 * reading them as a fan is immediate.
 */
function Compass({
  directions,
  onAngle,
  onCommit,
}: {
  directions: GradientDirection[];
  onAngle: (id: number, angle: number) => void;
  onCommit: () => void;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const angleFrom = (clientX: number, clientY: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    if (dx === 0 && dy === 0) return null;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return Math.round(((deg % 360) + 360) % 360);
  };

  const onKeyDown = (e: React.KeyboardEvent, d: GradientDirection) => {
    const step = e.shiftKey ? 15 : 1;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = d.angle + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = d.angle - step;
        break;
      case "PageUp":
        next = d.angle + 15;
        break;
      case "PageDown":
        next = d.angle - 15;
        break;
      case "Home":
        next = 0;
        break;
      default:
        return;
    }
    e.preventDefault();
    onAngle(d.id, ((next % 360) + 360) % 360);
  };

  return (
    <svg
      ref={svgRef}
      className="compass"
      viewBox="-74 -74 148 148"
      role="group"
      aria-label={t("directions.compass")}
    >
      <circle className="compass-ring" cx={0} cy={0} r={COMPASS_RADIUS} />
      <circle className="compass-ring compass-ring-inner" cx={0} cy={0} r={COMPASS_RADIUS / 2} />
      <line className="compass-axis" x1={-COMPASS_RADIUS} y1={0} x2={COMPASS_RADIUS} y2={0} />
      <line className="compass-axis" x1={0} y1={-COMPASS_RADIUS} x2={0} y2={COMPASS_RADIUS} />
      <text className="compass-cardinal" x={0} y={-COMPASS_RADIUS - 6} textAnchor="middle" aria-hidden="true">
        0°
      </text>

      {directions.map((d, i) => {
        const color = DIRECTION_COLORS[i % DIRECTION_COLORS.length];
        const { x, y } = angleToVector(d.angle);
        const reach = COMPASS_RADIUS * (0.45 + 0.55 * (d.weight / 100));
        const dim = !d.enabled;
        return (
          <g
            key={d.id}
            className={`compass-spoke${dim ? " is-off" : ""}${dragId === d.id ? " is-dragging" : ""}`}
          >
            <line
              x1={0}
              y1={0}
              x2={x * reach}
              y2={y * reach}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle
              cx={x * reach}
              cy={y * reach}
              r={8}
              fill={color}
              className="compass-dot"
              aria-hidden="true"
            />
            {/* Invisible, larger hit area: the slider the pointer and keyboard drive. */}
            <circle
              cx={x * reach}
              cy={y * reach}
              r={14}
              fill="transparent"
              className="compass-handle"
              role="slider"
              tabIndex={0}
              aria-label={t("directions.angle", { n: i + 1 })}
              aria-valuemin={0}
              aria-valuemax={359}
              aria-valuenow={d.angle}
              aria-valuetext={t("directions.angleValue", { angle: d.angle })}
              data-direction-id={d.id}
              onKeyDown={(e) => onKeyDown(e, d)}
              onBlur={onCommit}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // Synthetic or already-released pointer: drag still works while over the element.
                }
                (e.currentTarget as SVGCircleElement).focus();
                setDragId(d.id);
              }}
              onPointerMove={(e) => {
                if (dragId !== d.id) return;
                const angle = angleFrom(e.clientX, e.clientY);
                if (angle !== null) onAngle(d.id, angle);
              }}
              onPointerUp={(e) => {
                if (dragId !== d.id) return;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                setDragId(null);
                onCommit();
              }}
              onPointerCancel={() => {
                setDragId(null);
                onCommit();
              }}
            />
            <text
              x={x * reach}
              y={y * reach + 3}
              textAnchor="middle"
              className="compass-handle-label"
              aria-hidden="true"
            >
              {i + 1}
            </text>
          </g>
        );
      })}

      <circle className="compass-hub" cx={0} cy={0} r={3} />
    </svg>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export interface DirectionsPanelProps {
  directions: GradientDirection[];
  blend: GradientBlendMode;
  /** One-panel-at-a-time layout: the panel is always expanded, with no disclosure. */
  tabbed: boolean;
  onAngle: (id: number, angle: number) => void;
  onWeight: (id: number, weight: number) => void;
  onEnabled: (id: number, enabled: boolean) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
  onSpread: () => void;
  /** "Spread: N" preset - changes the count, keeping existing layers. */
  onCount: (count: number) => void;
  onBlend: (next: GradientBlendMode) => void;
  /** A continuous edit (drag, slider, typing) ended. */
  onCommit: () => void;
}

/** One-line description of the layers: "Direction 135° · 1 layer". */
function directionsSummary(directions: GradientDirection[], blend: GradientBlendMode, t: Translate): string {
  if (directions.length === 1) return t("directions.summaryOne", { angle: directions[0].angle });
  const angles = directions.map((d) => `${d.angle}°`).join(", ");
  return t("directions.summaryMany", {
    count: directions.length,
    angles,
    blend: blendName(blend, t).toLowerCase(),
  });
}

export function DirectionsPanel({
  directions,
  blend,
  tabbed,
  onAngle,
  onWeight,
  onEnabled,
  onAdd,
  onRemove,
  onSpread,
  onCount,
  onBlend,
  onCommit,
}: DirectionsPanelProps) {
  const t = useT();
  const enabledCount = directions.filter((d) => d.enabled).length;
  // A single layer is the common case and needs no screen space; several do.
  const [open, setOpen] = useState(directions.length > 1);
  const expanded = tabbed || open;
  const bodyId = useId();
  const summary = directionsSummary(directions, blend, t);
  const spreadOptions = Array.from({ length: MAX_DIRECTIONS }, (_, i) => ({
    value: i + 1,
    label: String(i + 1),
    ariaLabel: t("directions.spreadAria", { count: i + 1 }),
    title: t("directions.spreadTitle", { count: i + 1 }),
  }));

  return (
    <Surface as="section" pad="none" className="directions" aria-labelledby={`${bodyId}-h`}>
      <h2 className="panel-title" id={`${bodyId}-h`}>
        {tabbed ? (
          <span className="panel-title-static">
            {t("directions.title")}
            <span className="panel-summary">{summary}</span>
          </span>
        ) : (
          <button
            type="button"
            className="disclosure-button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
          >
            <Icon name="chevron" size={14} className="disclosure-chevron" />
            <span className="panel-title-text">{t("directions.title")}</span>
            <span className="panel-summary">{summary}</span>
          </button>
        )}
      </h2>

      <div id={bodyId} className="directions-content" hidden={!expanded}>
        <p className="panel-hint">
          {t("directions.hint", { count: directions.length, max: MAX_DIRECTIONS })}
        </p>
        <div className="directions-body">
          <Compass directions={directions} onAngle={onAngle} onCommit={onCommit} />

          <div className="directions-rows">
            {directions.map((d, i) => {
              const color = DIRECTION_COLORS[i % DIRECTION_COLORS.length];
              // Never let the last active direction be switched off - there would
              // be nothing left to render.
              const lockEnabled = d.enabled && enabledCount === 1;
              return (
                <div key={d.id} className={`dir-row${d.enabled ? "" : " is-off"}`}>
                  <button
                    type="button"
                    className="dir-toggle"
                    style={{ background: d.enabled ? color : "transparent", borderColor: color }}
                    title={
                      lockEnabled
                        ? t("directions.keepOne")
                        : d.enabled
                          ? t("directions.mute")
                          : t("directions.activate")
                    }
                    aria-pressed={d.enabled}
                    aria-label={t("directions.active", { n: i + 1 })}
                    disabled={lockEnabled}
                    onClick={() => onEnabled(d.id, !d.enabled)}
                  >
                    {i + 1}
                  </button>

                  <label className="dir-angle">
                    <input
                      type="number"
                      inputMode="numeric"
                      className="field-input field-num"
                      min={0}
                      max={360}
                      value={d.angle}
                      aria-label={t("directions.angle", { n: i + 1 })}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (e.target.value.trim() !== "" && Number.isFinite(n)) onAngle(d.id, n);
                      }}
                      onBlur={onCommit}
                    />
                    <span className="unit">°</span>
                  </label>

                  <input
                    type="range"
                    className="dir-slider"
                    min={0}
                    max={359}
                    value={d.angle}
                    aria-label={t("directions.angleSlider", { n: i + 1 })}
                    onChange={(e) => onAngle(d.id, +e.target.value)}
                    onPointerUp={onCommit}
                    onBlur={onCommit}
                  />

                  {directions.length > 1 && (
                    <Button
                      variant="icon"
                      icon="x"
                      className="dir-remove"
                      title={t("directions.removeTitle")}
                      aria-label={t("directions.remove", { n: i + 1 })}
                      onClick={() => onRemove(d.id)}
                    />
                  )}

                  <label className="dir-weight">
                    <span className="unit">{t("directions.weight")}</span>
                    <input
                      type="range"
                      className="dir-slider dir-slider-weight"
                      min={1}
                      max={100}
                      value={d.weight}
                      aria-label={t("directions.weightAria", { n: i + 1 })}
                      onChange={(e) => onWeight(d.id, +e.target.value)}
                      onPointerUp={onCommit}
                      onBlur={onCommit}
                    />
                    <span className="dir-weight-value mono">{d.weight}</span>
                  </label>
                </div>
              );
            })}

            <div className="dir-actions">
              <Button variant="secondary" size="sm" icon="plus" onClick={onAdd} disabled={directions.length >= MAX_DIRECTIONS}>
                {t("directions.add")}
              </Button>
              <Button variant="ghost" size="sm" icon="rotate" onClick={onSpread}>
                {t("directions.spreadEvenly")}
              </Button>
              <div className="dir-presets">
                <span className="dir-presets-label" aria-hidden="true">
                  {t("directions.spread")}
                </span>
                <Segmented
                  mode="buttons"
                  size="sm"
                  label={t("directions.spreadGroup")}
                  options={spreadOptions}
                  value={directions.length}
                  onChange={onCount}
                />
              </div>
            </div>

            {/* Blend only matters once there are layers to blend. */}
            {directions.length > 1 && (
              <label className="dir-blend">
                <span className="unit">{t("directions.blend")}</span>
                <select
                  className="field-input field-select"
                  value={blend}
                  aria-label={t("directions.blendAria")}
                  onChange={(e) => onBlend(e.target.value as GradientBlendMode)}
                >
                  {BLEND_VALUES.map((m) => (
                    <option key={m} value={m}>
                      {blendLabel(m, t)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>
    </Surface>
  );
}
