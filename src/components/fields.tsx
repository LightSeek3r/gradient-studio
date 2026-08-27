import { useEffect, useState } from "react";
import { readClipboardText, writeClipboardText } from "../clipboard";
import { parseAnyColor } from "../color-formats";

// ── Flash button ──────────────────────────────────────────────────────────────

/**
 * A tiny action button that reports the outcome of an async operation by
 * flashing green or red for a moment — clipboard work fails silently often
 * enough (permissions, unparseable text) that it needs visible feedback.
 */
export function FlashButton({
  glyph,
  title,
  className = "",
  onRun,
}: {
  glyph: string;
  title: string;
  className?: string;
  onRun: () => Promise<boolean> | boolean;
}) {
  const [flash, setFlash] = useState<"ok" | "err" | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`btn field-btn ${className} ${flash ? `flash-${flash}` : ""}`}
      onClick={async () => setFlash((await onRun()) ? "ok" : "err")}
    >
      {flash === "ok" ? "✓" : flash === "err" ? "✕" : glyph}
    </button>
  );
}

/** Pastes the clipboard into a color field, accepting any notation. */
export function PasteButton({ onColor }: { onColor: (hex: string) => void }) {
  return (
    <FlashButton
      glyph="⎘"
      title="Paste a color from the clipboard (hex, rgb, hsl or name)"
      className="btn-paste"
      onRun={async () => {
        const text = await readClipboardText();
        if (!text) return false;
        const hex = parseAnyColor(text);
        if (!hex) return false;
        onColor(hex);
        return true;
      }}
    />
  );
}

export function CopyButton({ value }: { value: string }) {
  return (
    <FlashButton
      glyph="⧉"
      title={`Copy ${value}`}
      className="btn-copy"
      onRun={() => writeClipboardText(value)}
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
}: {
  value: string;
  parse: (raw: string) => string | null;
  onCommit: (hex: string) => void;
  listId?: string;
  placeholder?: string;
  ariaLabel: string;
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
      spellCheck={false}
      autoComplete="off"
      onBlur={() => setDraft(null)}
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
}: {
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
          <span className="triple-label">{part.label}</span>
          <input
            type="number"
            className="field-input field-num"
            min={part.min}
            max={part.max}
            value={shown[i] ?? ""}
            aria-label={part.label}
            onBlur={() => setDrafts(null)}
            onChange={(e) => change(i, e.target.value)}
          />
          {part.suffix && <span className="triple-suffix">{part.suffix}</span>}
        </label>
      ))}
    </div>
  );
}
