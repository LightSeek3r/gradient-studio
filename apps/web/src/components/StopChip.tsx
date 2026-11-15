import { formatHex, type GradientTick } from "@opal42/gradient";
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
  const hex = formatHex(tick.color);
  return (
    <div className="stop-chip" data-stop-id={tick.id}>
      <button type="button" className="stop-chip-main" title={`Edit stop ${n}`} onClick={onSelect}>
        <span className="stop-swatch" style={{ background: tick.color }} aria-hidden="true" />
        <span className="stop-chip-name">Stop {n}</span>
        <span className="stop-chip-hex mono">{hex}</span>
        <span className="stop-chip-pos mono">{tick.position}%</span>
        <span className="sr-only">, select to edit</span>
      </button>
      {canRemove && (
        <Button
          variant="icon"
          icon="x"
          className="stop-chip-remove"
          title="Remove this stop"
          aria-label={`Remove stop ${n}`}
          onClick={onRemove}
        />
      )}
    </div>
  );
}
