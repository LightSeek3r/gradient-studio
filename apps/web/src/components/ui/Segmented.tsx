import type { KeyboardEvent, ReactNode } from "react";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name when the visible label is terse (e.g. "1"). */
  ariaLabel?: string;
  title?: string;
}

/**
 * A row of mutually exclusive choices.
 *
 * `radio` (default) is a real radio group: one tab stop, arrow keys move and
 * select. `buttons` is a row of independent `aria-pressed` toggles (each its
 * own tab stop) for choices whose selection has side effects that shouldn't
 * fire on every arrow press.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  mode = "radio",
  size = "md",
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  mode?: "radio" | "buttons";
  size?: "sm" | "md";
  className?: string;
}) {
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabbable = selectedIndex === -1 ? 0 : selectedIndex;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "radio") return;
    let next: number;
    const from = selectedIndex === -1 ? 0 : selectedIndex;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (from + 1) % options.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (from - 1 + options.length) % options.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = options.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(options[next].value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
    buttons[next]?.focus();
  };

  return (
    <div
      className={`segmented segmented--${size}${className ? ` ${className}` : ""}`}
      role={mode === "radio" ? "radiogroup" : "group"}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className={`segmented-item${active ? " is-active" : ""}`}
            role={mode === "radio" ? "radio" : undefined}
            aria-checked={mode === "radio" ? active : undefined}
            aria-pressed={mode === "buttons" ? active : undefined}
            aria-label={o.ariaLabel}
            title={o.title}
            tabIndex={mode === "radio" ? (i === tabbable ? 0 : -1) : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
