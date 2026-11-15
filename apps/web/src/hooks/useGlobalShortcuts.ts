// ── Global keyboard shortcuts and paste-anywhere ──────────────────────────────

import { useEffect, useRef } from "react";

/**
 * Text-entry controls keep their own native undo and paste, so app-level
 * Ctrl/Cmd+Z and paste-to-import stand aside while one has focus. Range
 * sliders, colour pickers, selects, checkboxes and buttons have no text undo
 * of their own, so the app shortcuts work there.
 */
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return ["text", "number", "search", "url", "email", "tel", "password", ""].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

export function useGlobalShortcuts({
  undo,
  redo,
  onPaste,
  enabled = true,
}: {
  undo: () => void;
  redo: () => void;
  /** Text pasted while focus is outside any text field. */
  onPaste: (text: string) => void;
  /** False while a modal dialog is open. */
  enabled?: boolean;
}) {
  // Latest callbacks without re-subscribing on every render.
  const latest = useRef({ undo, redo, onPaste, enabled });
  useEffect(() => {
    latest.current = { undo, redo, onPaste, enabled };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!latest.current.enabled || e.defaultPrevented || e.altKey) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (isTextEntry(document.activeElement)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        latest.current.undo();
      } else if ((key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey)) {
        e.preventDefault();
        latest.current.redo();
      }
    };
    const onPasteEvent = (e: ClipboardEvent) => {
      if (!latest.current.enabled) return;
      if (isTextEntry(document.activeElement)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text.trim()) return;
      e.preventDefault();
      latest.current.onPaste(text);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPasteEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("paste", onPasteEvent);
    };
  }, []);
}
