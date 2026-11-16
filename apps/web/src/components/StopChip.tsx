import { formatHex, type GradientTick } from "@opal42/gradient";
import { useT } from "../i18n/context";
import { Button } from "./ui/Button";

/**
 * A stop that isn't selected: one compact row (swatch, hex, position, remove).
 * The row's main button selects the stop - click, Enter or Space - and the
 * remove button is its own control.
 */
export function StopChip({
  tick,
  n,
  canRemove,
  onSelect,
  onRemove,
}: {
  tick: GradientTick;
  /** 1-based stop number in position order. */
  n: number;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const hex = formatHex(tick.color);
  return (
    <div className="stop-chip" data-stop-id={tick.id}>
      <button type="button" className="stop-chip-main" title={t("chip.editTitle", { n })} onClick={onSelect}>
        <span className="stop-swatch" style={{ background: tick.color }} aria-hidden="true" />
        <span className="stop-chip-name">{t("chip.name", { n })}</span>
        <span className="stop-chip-hex mono">{hex}</span>
        <span className="stop-chip-pos mono">{tick.position}%</span>
        <span className="sr-only">{t("chip.selectHint")}</span>
      </button>
      {canRemove && (
        <Button
          variant="icon"
          icon="x"
          className="stop-chip-remove"
          title={t("stop.removeTitle")}
          aria-label={t("stop.remove", { n })}
          onClick={onRemove}
        />
      )}
    </div>
  );
}
