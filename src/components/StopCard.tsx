import {
  complementHex,
  formatHex,
  formatHsl,
  formatName,
  formatRgb,
  hexToHsl,
  hexToHslPrecise,
  hslToHex,
  parseHex,
  parseName,
} from "../color-formats";
import { hexToRgb, rgbToHex, type GradientTick } from "../gradient-engine";
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

function ComplementRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-readout">{value}</span>
      <CopyButton value={value} />
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
        <span className="stop-index">Stop {index + 1}</span>
        <label className="stop-pos">
          <input
            type="number"
            className="field-input field-num"
            min={0}
            max={100}
            value={tick.position}
            aria-label={`Stop ${index + 1} position`}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onPosition(Math.min(100, Math.max(0, Math.round(n))));
            }}
          />
          <span className="triple-suffix">%</span>
        </label>
        {canRemove && (
          <button
            type="button"
            className="btn btn-remove"
            title="Remove this stop"
            aria-label={`Remove stop ${index + 1}`}
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
              aria-label={`Stop ${index + 1} color picker`}
              onChange={(e) => onColor(e.target.value)}
            />
            <span className="field-hint">system color picker</span>
          </div>

          <div className="field-row">
            <span className="field-label">Hex</span>
            <ColorTextField
              value={formatHex(tick.color)}
              parse={parseHex}
              onCommit={onColor}
              placeholder="#4F46E5"
              ariaLabel={`Stop ${index + 1} hex value`}
            />
            <CopyButton value={formatHex(tick.color)} />
            <PasteButton onColor={onColor} />
          </div>

          <div className="field-row">
            <span className="field-label">RGB</span>
            <NumericTriple
              parts={[
                { label: "R", min: 0, max: 255 },
                { label: "G", min: 0, max: 255 },
                { label: "B", min: 0, max: 255 },
              ]}
              values={[rgb.r, rgb.g, rgb.b]}
              onCommit={([r, g, b]) => onColor(rgbToHex({ r, g, b }))}
            />
            <CopyButton value={formatRgb(tick.color)} />
            <PasteButton onColor={onColor} />
          </div>

          <div className="field-row">
            <span className="field-label">HSL</span>
            <NumericTriple
              parts={[
                { label: "H", min: 0, max: 360, suffix: "°" },
                { label: "S", min: 0, max: 100, suffix: "%" },
                { label: "L", min: 0, max: 100, suffix: "%" },
              ]}
              values={[hsl.h, hsl.s, hsl.l]}
              onCommit={commitHsl}
            />
            <CopyButton value={formatHsl(tick.color)} />
            <PasteButton onColor={onColor} />
          </div>

          <div className="field-row">
            <span className="field-label">Name</span>
            <ColorTextField
              value={formatName(tick.color)}
              parse={parseName}
              onCommit={onColor}
              listId={COLOR_NAME_LIST_ID}
              placeholder="indigo"
              ariaLabel={`Stop ${index + 1} color name`}
            />
            <CopyButton value={formatName(tick.color)} />
            <PasteButton onColor={onColor} />
          </div>
        </div>

        {/* ── Complement, copy-only ── */}
        <details className="field-group" open>
          <summary className="field-group-label disclosure-summary">
            <span className="complement-swatch" style={{ background: complement }} />
            Complement <span className="field-group-note">OKLCH +180°</span>
          </summary>

          <div className="field-row">
            <span className="field-label">Swap</span>
            <FlashButton
              glyph="↔ Use this instead"
              title="Replace this stop with its complement"
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
          <ComplementRow label="Name" value={formatName(complement)} />
        </details>
      </div>
    </div>
  );
}
