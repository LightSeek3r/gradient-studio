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
import { ColorTextField, CopyButton, FlashButton, NumericTriple, PasteButton } from "./fields";
import { stopCardId, stopHexFieldId } from "./dom-ids";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Segmented } from "./ui/Segmented";

/** `id` of the shared `<datalist>` of CSS color names, rendered once by App. */
export const COLOR_NAME_LIST_ID = "css-color-names";

// ── Complement readout ────────────────────────────────────────────────────────

function ComplementRow({
  label,
  value,
  copyValue,
  copyLabel,
}: {
  label: string;
  value: string;
  copyValue?: string;
  copyLabel: string;
}) {
  return (
    <div className="complement-row">
      <span className="field-label">{label}</span>
      <span className="field-readout mono" title={value}>
        {value}
      </span>
      <CopyButton value={value} copyValue={copyValue} label={copyLabel} />
    </div>
  );
}

/** Which colour notation the card shows at a time. */
export type Notation = "hex" | "rgb" | "hsl" | "name";

const NOTATIONS: { value: Notation; label: string }[] = [
  { value: "hex", label: "HEX" },
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL" },
  { value: "name", label: "NAME" },
];

// ── Stop card ─────────────────────────────────────────────────────────────────

export function StopCard({
  tick,
  index,
  canRemove,
  notation,
  onNotation,
  onColor,
  onPosition,
  onRemove,
  onComplement,
  onSelect,
  onGradientText,
  onDone,
}: {
  tick: GradientTick;
  index: number;
  canRemove: boolean;
  /** Which colour notation is shown (shared across stops). */
  notation: Notation;
  onNotation: (n: Notation) => void;
  onColor: (hex: string) => void;
  onPosition: (position: number) => void;
  onRemove: () => void;
  /** Replace the colour with its complement (a destructive, toasted edit). */
  onComplement: (hex: string) => void;
  onSelect?: () => void;
  /** A whole gradient was pasted into one of this stop's colour fields. */
  onGradientText?: (text: string) => void;
  /** A continuous edit ended (field blur). */
  onDone?: () => void;
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

  const label = (what: string) => `stop ${n} ${what}`;

  return (
    <div
      id={stopCardId(tick.id)}
      className="stop-card"
      role="group"
      aria-label={`Stop ${n}`}
      tabIndex={-1}
      data-stop-id={tick.id}
      onFocus={onSelect}
    >
      {/* Card header */}
      <div className="stop-head">
        <input
          type="color"
          className="field-picker"
          value={tick.color}
          aria-label={`Stop ${n} color picker`}
          onChange={(e) => onColor(e.target.value)}
          onBlur={onDone}
        />
        <span className="stop-index">Stop {n}</span>
        <label className="stop-pos">
          <input
            ref={posRef}
            type="number"
            inputMode="numeric"
            className="field-input field-num mono"
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
          <span className="unit">%</span>
        </label>
        {canRemove && (
          <Button
            variant="icon"
            icon="x"
            className="stop-remove"
            title="Remove this stop"
            aria-label={`Remove stop ${n}`}
            onClick={onRemove}
          />
        )}
      </div>

      {/* ── One notation at a time ── */}
      <div className="stop-color-row">
        <Segmented
          label={`Stop ${n} color notation`}
          options={NOTATIONS}
          value={notation}
          onChange={onNotation}
          className="notation-switch"
        />
      </div>

      <div className="stop-notation">
        {notation === "hex" && (
          <>
            <label className="triple-cell">
              <span className="triple-label" aria-hidden="true">
                Hex
              </span>
              <ColorTextField
                value={formatHex(tick.color)}
                parse={parseHex}
                onCommit={onColor}
                placeholder="#4F46E5"
                ariaLabel={`Stop ${n} hex value`}
                id={stopHexFieldId(tick.id)}
                onGradientPaste={onGradientText}
                onDone={onDone}
              />
            </label>
            <CopyButton value={formatHex(tick.color)} label={label("hex")} />
            <PasteButton onColor={onColor} onGradient={onGradientText} label={label("hex")} />
          </>
        )}

        {notation === "rgb" && (
          <>
            <NumericTriple
              labelPrefix={`Stop ${n}`}
              parts={[
                { label: "R", name: "red", min: 0, max: 255 },
                { label: "G", name: "green", min: 0, max: 255 },
                { label: "B", name: "blue", min: 0, max: 255 },
              ]}
              values={[rgb.r, rgb.g, rgb.b]}
              onCommit={([r, g, b]) => onColor(rgbToHex({ r, g, b }))}
              onDone={onDone}
            />
            <CopyButton value={formatRgb(tick.color)} label={label("RGB")} />
            <PasteButton onColor={onColor} onGradient={onGradientText} label={label("RGB")} />
          </>
        )}

        {notation === "hsl" && (
          <>
            <NumericTriple
              labelPrefix={`Stop ${n}`}
              parts={[
                { label: "H", name: "hue", min: 0, max: 360, suffix: "°" },
                { label: "S", name: "saturation", min: 0, max: 100, suffix: "%" },
                { label: "L", name: "lightness", min: 0, max: 100, suffix: "%" },
              ]}
              values={[hsl.h, hsl.s, hsl.l]}
              onCommit={commitHsl}
              onDone={onDone}
            />
            <CopyButton value={formatHsl(tick.color)} label={label("HSL")} />
            <PasteButton onColor={onColor} onGradient={onGradientText} label={label("HSL")} />
          </>
        )}

        {notation === "name" && (
          <>
            <label className="triple-cell">
              <span className="triple-label" aria-hidden="true">
                Name
              </span>
              <ColorTextField
                value={formatNameDisplay(tick.color)}
                parse={parseName}
                onCommit={onColor}
                listId={COLOR_NAME_LIST_ID}
                placeholder="indigo"
                ariaLabel={`Stop ${n} color name`}
                onGradientPaste={onGradientText}
                onDone={onDone}
              />
            </label>
            <CopyButton
              value={formatNameDisplay(tick.color)}
              copyValue={formatName(tick.color)}
              label={label("name")}
            />
            <PasteButton onColor={onColor} onGradient={onGradientText} label={label("name")} />
          </>
        )}
      </div>

      {/* ── Complement, closed by default ── */}
      <details className="complement">
        <summary className="disclosure-summary complement-summary">
          <Icon name="chevron" size={14} className="disclosure-chevron" />
          <span className="complement-swatch" style={{ background: complement }} aria-hidden="true" />
          <span className="complement-title">Complement</span>
          <span className="complement-note">OKLCH +180°</span>
        </summary>

        <div className="complement-body">
          <FlashButton
            icon="swap"
            label="Replace stop with complement"
            ariaLabel={`Replace stop with complement (stop ${n})`}
            title={`Replace stop ${n} with its complement`}
            okMessage={`Stop ${n} replaced with its complement`}
            okLabel="Replaced"
            size="sm"
            onRun={() => {
              onComplement(complement);
              return true;
            }}
          />
          <ComplementRow label="Hex" value={formatHex(complement)} copyLabel={label("complement hex")} />
          <ComplementRow label="RGB" value={formatRgb(complement)} copyLabel={label("complement RGB")} />
          <ComplementRow label="HSL" value={formatHsl(complement)} copyLabel={label("complement HSL")} />
          <ComplementRow
            label="Name"
            value={formatNameDisplay(complement)}
            copyValue={formatName(complement)}
            copyLabel={label("complement name")}
          />
        </div>
      </details>
    </div>
  );
}
