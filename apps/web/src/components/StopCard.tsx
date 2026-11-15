import { useRef, useState } from "react";
import {
  complementHex,
  formatHex,
  formatHsl,
  formatName,
  formatNameDisplay,
  formatRgb,
  hexToHsl,
  hexToHslPrecise,
  hexToRgb,
  hslToHex,
  parseHex,
  parseName,
  rgbToHex,
  type GradientTick,
} from "@opal42/gradient";
import {
  ColorTextField,
  CopyButton,
  FlashButton,
  NumericTriple,
  PasteButton,
} from "./fields";

/** `id` of the shared `<datalist>` of CSS color names, rendered once by App. */
export const COLOR_NAME_LIST_ID = "css-color-names";

// ── Complement readout ────────────────────────────────────────────────────────

function ComplementRow({
  label,
  value,
  copyValue,
}: {
  label: string;
  value: string;
  copyValue?: string;
}) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-readout" title={value}>
        {value}
      </span>
      <CopyButton value={value} copyValue={copyValue} />
    </div>
  );
}

// ── Stop card ─────────────────────────────────────────────────────────────────

export function StopCard({
  tick,
  index,
  canRemove,
  onColor,
  onPosition,
  onRemove,
}: {
  tick: GradientTick;
  index: number;
  canRemove: boolean;
  onColor: (hex: string) => void;
  onPosition: (position: number) => void;
  onRemove: () => void;
}) {
  const rgb = hexToRgb(tick.color);
  const hsl = hexToHsl(tick.color);
  const complement = complementHex(tick.color);
  const n = index + 1;

  // Position is edited as a local draft and committed on blur/Enter only, so the
  // stop never re-sorts (and the cards never renumber) under the cursor, and an
  // empty or invalid draft can't snap the stop to 0.
  const [posDraft, setPosDraft] = useState<string | null>(null);
  const posRef = useRef<HTMLInputElement>(null);
  const commitPosition = () => {
    if (posDraft === null) return;
    const num = Number(posDraft);
    if (posDraft.trim() !== "" && Number.isFinite(num)) {
      const next = Math.min(100, Math.max(0, Math.round(num)));
      if (next !== tick.position) onPosition(next);
    }
    setPosDraft(null);
  };

  // Integer HSL is lossy, so a committed channel that still matches what was
  // displayed is one the user didn't touch — feed those back at full precision
  // rather than re-deriving the color from rounded values, which would drift.
  const commitHsl = ([h, s, l]: [number, number, number]) => {
    const precise = hexToHslPrecise(tick.color);
    onColor(
      hslToHex({
        h: h === hsl.h ? precise.h : h,
        s: s === hsl.s ? precise.s : s,
        l: l === hsl.l ? precise.l : l,
      }),
    );
  };

  return (
    <div className="stop-card">
      {/* Card header */}
      <div className="stop-head">
        <span className="stop-swatch" style={{ background: tick.color }} />
        <span className="stop-index">Stop {n}</span>
        <label className="stop-pos">
          <input
            ref={posRef}
            type="number"
            className="field-input field-num"
            min={0}
            max={100}
            value={posDraft ?? tick.position}
            aria-label={`Stop ${n} position`}
            onChange={(e) => setPosDraft(e.target.value)}
            onBlur={commitPosition}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitPosition();
                // The card may re-sort and move in the DOM; keep keyboard focus on it.
                requestAnimationFrame(() => posRef.current?.focus());
              } else if (e.key === "Escape") {
                setPosDraft(null);
              }
            }}
          />
          <span className="triple-suffix">%</span>
        </label>
        {canRemove && (
          <button
            type="button"
            className="btn btn-remove"
            title="Remove this stop"
            aria-label={`Remove stop ${n}`}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </div>

      <div className="stop-body">
        {/* ── Editable color, every notation at once ── */}
        <div className="field-group">
          <div className="field-group-label">Color</div>

          <div className="field-row">
            <span className="field-label">Pick</span>
            <input
              type="color"
              className="field-picker"
              value={tick.color}
              aria-label={`Stop ${n} color picker`}
              onChange={(e) => onColor(e.target.value)}
            />
          </div>

          <div className="field-row">
            <span className="field-label">Hex</span>
            <ColorTextField
              value={formatHex(tick.color)}
              parse={parseHex}
              onCommit={onColor}
              placeholder="#4F46E5"
              ariaLabel={`Stop ${n} hex value`}
            />
            <CopyButton value={formatHex(tick.color)} />
            <PasteButton onColor={onColor} label={`stop ${n} hex`} />
          </div>

          <div className="field-row">
            <span className="field-label">RGB</span>
            <NumericTriple
              labelPrefix={`Stop ${n}`}
              parts={[
                { label: "R", name: "red", min: 0, max: 255 },
                { label: "G", name: "green", min: 0, max: 255 },
                { label: "B", name: "blue", min: 0, max: 255 },
              ]}
              values={[rgb.r, rgb.g, rgb.b]}
              onCommit={([r, g, b]) => onColor(rgbToHex({ r, g, b }))}
            />
            <CopyButton value={formatRgb(tick.color)} />
            <PasteButton onColor={onColor} label={`stop ${n} RGB`} />
          </div>

          <div className="field-row">
            <span className="field-label">HSL</span>
            <NumericTriple
              labelPrefix={`Stop ${n}`}
              parts={[
                { label: "H", name: "hue", min: 0, max: 360, suffix: "°" },
                { label: "S", name: "saturation", min: 0, max: 100, suffix: "%" },
                { label: "L", name: "lightness", min: 0, max: 100, suffix: "%" },
              ]}
              values={[hsl.h, hsl.s, hsl.l]}
              onCommit={commitHsl}
            />
            <CopyButton value={formatHsl(tick.color)} />
            <PasteButton onColor={onColor} label={`stop ${n} HSL`} />
          </div>

          <div className="field-row">
            <span className="field-label">Name</span>
            <ColorTextField
              value={formatNameDisplay(tick.color)}
              parse={parseName}
              onCommit={onColor}
              listId={COLOR_NAME_LIST_ID}
              placeholder="indigo"
              ariaLabel={`Stop ${n} color name`}
            />
            <CopyButton value={formatNameDisplay(tick.color)} copyValue={formatName(tick.color)} />
            <PasteButton onColor={onColor} label={`stop ${n} name`} />
          </div>
        </div>

        {/* ── Complement, copy-only ── */}
        <details className="field-group">
          <summary className="field-group-label disclosure-summary">
            <span className="complement-swatch" style={{ background: complement }} />
            Complement <span className="field-group-note">OKLCH +180°</span>
          </summary>

          <div className="field-row">
            <span className="field-label">Swap</span>
            <FlashButton
              text
              glyph="Replace stop with complement"
              ariaLabel={`Replace stop with complement (stop ${n})`}
              title={`Replace stop ${n} with its complement`}
              okMessage={`Stop ${n} replaced with its complement`}
              okGlyph="✓ Replaced"
              className="btn-swap"
              onRun={() => {
                onColor(complement);
                return true;
              }}
            />
          </div>

          <ComplementRow label="Hex" value={formatHex(complement)} />
          <ComplementRow label="RGB" value={formatRgb(complement)} />
          <ComplementRow label="HSL" value={formatHsl(complement)} />
          <ComplementRow
            label="Name"
            value={formatNameDisplay(complement)}
            copyValue={formatName(complement)}
          />
        </details>
      </div>
    </div>
  );
}
