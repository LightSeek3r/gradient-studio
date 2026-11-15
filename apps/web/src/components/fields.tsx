import { useEffect, useState } from "react";
import { announce } from "../announce";
import { readClipboardText, writeClipboardText } from "../clipboard";
import { parseAnyColor } from "@opal42/gradient";
import { looksLikeGradient } from "../import/parse-linear-gradient";
import { Button, type ButtonSize, type ButtonVariant } from "./ui/Button";
import type { IconName } from "./ui/Icon";

// ── Flash button ──────────────────────────────────────────────────────────────

/**
 * An action button that reports the outcome of an async operation by
 * flashing green or red for a moment - clipboard work fails silently often
 * enough (permissions, unparseable text) that it needs visible feedback.
 * Icon-only unless a `label` is given.
 */
export function FlashButton({
  icon,
  label,
  title,
  className = "",
  onRun,
  ariaLabel,
  variant,
  size,
  collapse,
  okMessage = "Done",
  errMessage = "Failed",
  okLabel = "Done",
  errLabel = "Failed",
}: {
  icon: IconName;
  /** Visible text; without it the button is a square icon button named by `ariaLabel`/`title`. */
  label?: string;
  title: string;
  className?: string;
  /** true / false flash success / failure; null means "handled elsewhere", no flash. */
  onRun: () => Promise<boolean | null> | boolean | null;
  /** Accessible name; for labelled buttons it must start with the visible `label`. */
  ariaLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  collapse?: boolean;
  /** Spoken (via the status region) when the action succeeds / fails. */
  okMessage?: string;
  errMessage?: string;
  /** Visible text while flashing (labelled buttons only). */
  okLabel?: string;
  errLabel?: string;
}) {
  const [flash, setFlash] = useState<"ok" | "err" | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  const shownIcon: IconName = flash === "ok" ? "check" : flash === "err" ? "alert" : icon;
  const textual = label !== undefined;
  const shownLabel = flash === "ok" ? okLabel : flash === "err" ? errLabel : label;

  return (
    <Button
      variant={variant ?? (textual ? "secondary" : "icon")}
      size={size ?? "md"}
      icon={shownIcon}
      collapse={collapse}
      title={title}
      // A labelled button's name is its visible text; while that text swaps, drop the override.
      aria-label={textual ? (flash ? undefined : ariaLabel) : (ariaLabel ?? title)}
      className={`${className}${flash ? ` flash-${flash}` : ""}`}
      onClick={async () => {
        const ok = await onRun();
        if (ok === null) return;
        setFlash(ok ? "ok" : "err");
        announce(ok ? okMessage : errMessage);
      }}
    >
      {textual ? shownLabel : undefined}
    </Button>
  );
}

/** Pastes the clipboard into a color field, accepting any notation. */
export function PasteButton({
  onColor,
  onGradient,
  label,
}: {
  onColor: (hex: string) => void;
  /** Clipboard holds a whole gradient: offer to import it instead of failing. */
  onGradient?: (text: string) => void;
  /** Which field this pastes into, e.g. "stop 2 hex" - makes the name unique. */
  label: string;
}) {
  return (
    <FlashButton
      icon="paste"
      title={`Paste a single color into ${label} (hex, rgb, hsl or name)`}
      ariaLabel={`Paste into ${label}`}
      className="btn-paste"
      okMessage={`Pasted into ${label}`}
      errMessage={`Could not paste into ${label}: clipboard does not hold a single color`}
      onRun={async () => {
        const text = await readClipboardText();
        if (!text) return false;
        const hex = parseAnyColor(text);
        if (!hex) {
          if (onGradient && looksLikeGradient(text)) {
            onGradient(text);
            return null;
          }
          return false;
        }
        onColor(hex);
        return true;
      }}
    />
  );
}

export function CopyButton({
  value,
  copyValue,
  label,
}: {
  /** What is shown / named in the tooltip. */
  value: string;
  /** What actually lands on the clipboard, when it differs from `value`. */
  copyValue?: string;
  /** Short name used instead of `value` in the tooltip and announcement. */
  label?: string;
}) {
  return (
    <FlashButton
      icon="copy"
      title={`Copy ${label ?? value}`}
      className="btn-copy"
      okMessage={`Copied ${label ?? value}`}
      errMessage="Copy failed"
      onRun={() => writeClipboardText(copyValue ?? value)}
    />
  );
}

// ── Text field ────────────────────────────────────────────────────────────────

/**
 * A text input over a color notation. It holds the in-progress text only while
 * being edited — `null` means "show the canonical value" — so a half-typed
 * entry is never clobbered by reformatting, and blurring reverts anything that
 * never parsed. Valid text commits as soon as it becomes valid.
 */
export function ColorTextField({
  value,
  parse,
  onCommit,
  listId,
  placeholder,
  ariaLabel,
  id,
  onGradientPaste,
  onDone,
}: {
  value: string;
  parse: (raw: string) => string | null;
  onCommit: (hex: string) => void;
  listId?: string;
  placeholder?: string;
  ariaLabel: string;
  id?: string;
  /** A whole gradient was pasted into the field: offer to import it. */
  onGradientPaste?: (text: string) => void;
  /** Editing ended (blur) - closes the undo coalescing run. */
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const shown = draft ?? value;
  const invalid = shown.trim() !== "" && parse(shown) === null;

  return (
    <input
      type="text"
      className={`field-input${invalid ? " field-invalid" : ""}`}
      value={shown}
      list={listId}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={shown}
      id={id}
      spellCheck={false}
      autoComplete="off"
      onPaste={(e) => {
        const text = e.clipboardData.getData("text/plain");
        if (onGradientPaste && looksLikeGradient(text)) {
          e.preventDefault();
          onGradientPaste(text);
        }
      }}
      onBlur={() => {
        setDraft(null);
        onDone?.();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const hex = parse(e.target.value);
        if (hex) onCommit(hex);
      }}
    />
  );
}

// ── Numeric triple ────────────────────────────────────────────────────────────

export interface TriplePart {
  label: string;
  /** Spoken name, e.g. "red" - combined with the stop to label the input. */
  name: string;
  min: number;
  max: number;
  suffix?: string;
}

/**
 * Three linked numeric inputs (R/G/B or H/S/L). Same draft strategy as
 * `ColorTextField` — `null` shows the canonical values — so emptying a field
 * mid-edit doesn't snap it to 0. Commits once all three read as numbers.
 */
export function NumericTriple({
  parts,
  values,
  onCommit,
  labelPrefix,
  onDone,
}: {
  onDone?: () => void;
  /** Qualifies each input's accessible name, e.g. "Stop 2" -> "Stop 2 red". */
  labelPrefix: string;
  parts: [TriplePart, TriplePart, TriplePart];
  values: [number, number, number];
  onCommit: (values: [number, number, number]) => void;
}) {
  const [drafts, setDrafts] = useState<string[] | null>(null);

  const shown = drafts ?? values.map(String);

  const change = (index: number, raw: string) => {
    const next = shown.map((d, i) => (i === index ? raw : d));
    setDrafts(next);

    const nums = next.map((d, i) => {
      const n = Number(d);
      return d.trim() !== "" && Number.isFinite(n)
        ? Math.min(parts[i].max, Math.max(parts[i].min, n))
        : NaN;
    });
    if (nums.every((n) => Number.isFinite(n))) {
      onCommit([nums[0], nums[1], nums[2]]);
    }
  };

  return (
    <div className="field-triple">
      {parts.map((part, i) => (
        <label key={part.label} className="triple-cell">
          <span className="triple-label" aria-hidden="true">
            {part.label}
            {part.suffix}
          </span>
          <input
            type="number"
            inputMode="numeric"
            className="field-input field-num"
            min={part.min}
            max={part.max}
            value={shown[i] ?? ""}
            aria-label={`${labelPrefix} ${part.name}`}
            onBlur={() => {
              setDrafts(null);
              onDone?.();
            }}
            onChange={(e) => change(i, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
