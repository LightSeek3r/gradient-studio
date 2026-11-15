import { useRef } from "react";
import { buildGradientCSS, type GradientTick } from "@opal42/gradient";
import { sortTicks } from "../state/document";

/** Bar x-coordinate -> integer position 0..100. */
function positionFromClientX(bar: HTMLElement, clientX: number): number {
  const rect = bar.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100);
}

export interface StopBarProps {
  ticks: GradientTick[];
  selectedId: number | null;
  /** Candidate stops to show as ghost markers (suggestion preview). */
  ghosts?: GradientTick[] | null;
  canAdd: boolean;
  canRemove: boolean;
  onSelect: (id: number) => void;
  /** Absolute move (pointer drag). Continuous: same id => one undo step. */
  onMoveTo: (id: number, position: number) => void;
  /** Relative move (keyboard). */
  onMoveBy: (id: number, delta: number) => void;
  /** Drag / key run finished. */
  onCommit: () => void;
  /** Click on empty bar. Returns the new stop's id, or null at the cap. */
  onAddAt: (position: number) => number | null;
  onRemove: (id: number) => void;
  /** Enter on a handle: move focus to that stop's editor. */
  onOpen: (id: number) => void;
}

/**
 * The stop editor bar. Handles are ARIA sliders driven by pointer events
 * (mouse, pen and touch alike, with pointer capture) and by the keyboard.
 */
export function StopBar({
  ticks,
  selectedId,
  ghosts,
  canAdd,
  canRemove,
  onSelect,
  onMoveTo,
  onMoveBy,
  onCommit,
  onAddAt,
  onRemove,
  onOpen,
}: StopBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const handleRefs = useRef(new Map<number, HTMLDivElement>());
  const dragId = useRef<number | null>(null);
  const sorted = sortTicks(ticks);
  // The stop bar is a stop editor, not a preview - always read left-to-right.
  const barCSS = buildGradientCSS(ticks, 90);

  const focusHandle = (id: number) => {
    requestAnimationFrame(() => handleRefs.current.get(id)?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent, tick: GradientTick, index: number) => {
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        onMoveBy(tick.id, -step);
        break;
      case "ArrowRight":
      case "ArrowUp":
        onMoveBy(tick.id, step);
        break;
      case "PageDown":
        onMoveBy(tick.id, -10);
        break;
      case "PageUp":
        onMoveBy(tick.id, 10);
        break;
      case "Home":
        onMoveBy(tick.id, -tick.position);
        break;
      case "End":
        onMoveBy(tick.id, 100 - tick.position);
        break;
      case "Delete":
      case "Backspace": {
        if (!canRemove) return;
        const neighbour = sorted[index + 1] ?? sorted[index - 1];
        onRemove(tick.id);
        if (neighbour) {
          onSelect(neighbour.id);
          focusHandle(neighbour.id);
        }
        break;
      }
      case "Enter":
        onOpen(tick.id);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={barRef}
      className="tick-bar"
      style={{ background: barCSS }}
      title={canAdd ? "Click to add a stop" : undefined}
      onPointerDown={(e) => {
        // Only the bar itself: handles stop propagation.
        if (e.target !== barRef.current || e.button !== 0 || !canAdd) return;
        e.preventDefault();
        const id = onAddAt(positionFromClientX(barRef.current, e.clientX));
        if (id !== null) {
          onSelect(id);
          focusHandle(id);
        }
      }}
    >
      {ghosts?.map((g) => (
        <span
          key={`ghost-${g.id}`}
          className="tick-ghost"
          aria-hidden="true"
          style={{ left: `${g.position}%`, borderTopColor: g.color }}
        />
      ))}
      {sorted.map((tick, i) => (
        <div
          key={tick.id}
          ref={(el) => {
            if (el) handleRefs.current.set(tick.id, el);
            else handleRefs.current.delete(tick.id);
          }}
          className={`tick-handle${tick.id === selectedId ? " is-selected" : ""}`}
          role="slider"
          tabIndex={0}
          aria-label={`Stop ${i + 1}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={tick.position}
          aria-valuetext={`Stop ${i + 1}, ${tick.position} percent, colour ${tick.color}`}
          data-stop-id={tick.id}
          style={{ left: `${tick.position}%`, "--c": tick.color } as React.CSSProperties}
          onFocus={() => onSelect(tick.id)}
          onKeyDown={(e) => onKeyDown(e, tick, i)}
          onBlur={onCommit}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Synthetic or already-released pointer: drag still works while over the element.
            }
            dragId.current = tick.id;
            onSelect(tick.id);
            e.currentTarget.focus();
          }}
          onPointerMove={(e) => {
            if (dragId.current !== tick.id || !barRef.current) return;
            onMoveTo(tick.id, positionFromClientX(barRef.current, e.clientX));
          }}
          onPointerUp={(e) => {
            if (dragId.current !== tick.id) return;
            dragId.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            onCommit();
          }}
          onPointerCancel={() => {
            dragId.current = null;
            onCommit();
          }}
        />
      ))}
    </div>
  );
}
