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
import { useT } from "../i18n/context";
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

const NOTATION_VALUES: readonly Notation[] = ["hex", "rgb", "hsl", "name"];

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
  const t = useT();
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

  const channel = (c: "red" | "green" | "blue" | "hue" | "saturation" | "lightness") =>
    t("stop.channelLabel", { n, channel: t(`channel.${c}`) });
  const notations = NOTATION_VALUES.map((value) => ({ value, label: t(`notation.${value}`) }));

  return (
    <div
      id={stopCardId(tick.id)}
      className="stop-card"
      role="group"
      aria-label={t("stop.group", { n })}
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
          aria-label={t("stop.picker", { n })}
          onChange={(e) => onColor(e.target.value)}
          onBlur={onDone}
        />
        <span className="stop-index">{t("stop.heading", { n })}</span>
        <label className="stop-pos">
          <input
            ref={posRef}
            type="number"
            inputMode="numeric"
            className="field-input field-num mono"
            min={0}
            max={100}
            value={posDraft ?? tick.position}
            aria-label={t("stop.position", { n })}
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
            title={t("stop.removeTitle")}
            aria-label={t("stop.remove", { n })}
            onClick={onRemove}
          />
        )}
      </div>

      {/* ── One notation at a time ── */}
      <div className="stop-color-row">
        <Segmented
          label={t("stop.notation", { n })}
          options={notations}
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
                {t("field.hex")}
              </span>
              <ColorTextField
                value={formatHex(tick.color)}
                parse={parseHex}
                onCommit={onColor}
                placeholder="#4F46E5"
                ariaLabel={t("stop.hexValue", { n })}
                id={stopHexFieldId(tick.id)}
                onGradientPaste={onGradientText}
                onDone={onDone}
              />
            </label>
            <CopyButton value={formatHex(tick.color)} label={t("target.hex", { n })} />
            <PasteButton onColor={onColor} onGradient={onGradientText} label={t("target.hex", { n })} />
          </>
        )}

        {notation === "rgb" && (
          <>
            <NumericTriple
              parts={[
                { label: "R", ariaLabel: channel("red"), min: 0, max: 255 },
                { label: "G", ariaLabel: channel("green"), min: 0, max: 255 },
                { label: "B", ariaLabel: channel("blue"), min: 0, max: 255 },
              ]}
              values={[rgb.r, rgb.g, rgb.b]}
              onCommit={([r, g, b]) => onColor(rgbToHex({ r, g, b }))}
              onDone={onDone}
            />
            <CopyButton value={formatRgb(tick.color)} label={t("target.rgb", { n })} />
            <PasteButton onColor={onColor} onGradient={onGradientText} label={t("target.rgb", { n })} />
          </>
        )}

        {notation === "hsl" && (
          <>
            <NumericTriple
              parts={[
                { label: "H", ariaLabel: channel("hue"), min: 0, max: 360, suffix: "°" },
                { label: "S", ariaLabel: channel("saturation"), min: 0, max: 100, suffix: "%" },
                { label: "L", ariaLabel: channel("lightness"), min: 0, max: 100, suffix: "%" },
              ]}
              values={[hsl.h, hsl.s, hsl.l]}
              onCommit={commitHsl}
              onDone={onDone}
            />
            <CopyButton value={formatHsl(tick.color)} label={t("target.hsl", { n })} />
            <PasteButton onColor={onColor} onGradient={onGradientText} label={t("target.hsl", { n })} />
          </>
        )}

        {notation === "name" && (
          <>
            <label className="triple-cell">
              <span className="triple-label" aria-hidden="true">
                {t("field.name")}
              </span>
              <ColorTextField
                value={formatNameDisplay(tick.color)}
                parse={parseName}
                onCommit={onColor}
                listId={COLOR_NAME_LIST_ID}
                placeholder="indigo"
                ariaLabel={t("stop.colorName", { n })}
                onGradientPaste={onGradientText}
                onDone={onDone}
              />
            </label>
            <CopyButton
              value={formatNameDisplay(tick.color)}
              copyValue={formatName(tick.color)}
              label={t("target.name", { n })}
            />
            <PasteButton onColor={onColor} onGradient={onGradientText} label={t("target.name", { n })} />
          </>
        )}
      </div>

      {/* ── Complement, closed by default ── */}
      <details className="complement">
        <summary className="disclosure-summary complement-summary">
          <Icon name="chevron" size={14} className="disclosure-chevron" />
          <span className="complement-swatch" style={{ background: complement }} aria-hidden="true" />
          <span className="complement-title">{t("complement.title")}</span>
          <span className="complement-note">OKLCH +180°</span>
        </summary>

        <div className="complement-body">
          <FlashButton
            icon="swap"
            label={t("complement.replace")}
            ariaLabel={t("complement.replaceAria", { n })}
            title={t("complement.replaceTitle", { n })}
            okMessage={t("toast.complementApplied", { n })}
            okLabel={t("complement.replaced")}
            size="sm"
            onRun={() => {
              onComplement(complement);
              return true;
            }}
          />
          <ComplementRow label={t("field.hex")} value={formatHex(complement)} copyLabel={t("target.complementHex", { n })} />
          <ComplementRow label={t("field.rgb")} value={formatRgb(complement)} copyLabel={t("target.complementRgb", { n })} />
          <ComplementRow label={t("field.hsl")} value={formatHsl(complement)} copyLabel={t("target.complementHsl", { n })} />
          <ComplementRow
            label={t("field.name")}
            value={formatNameDisplay(complement)}
            copyValue={formatName(complement)}
            copyLabel={t("target.complementName", { n })}
          />
        </div>
      </details>
    </div>
  );
}
