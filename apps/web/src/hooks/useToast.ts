// ── Toast state ───────────────────────────────────────────────────────────────
// One toast at a time. Its text is voiced through the shared role="status"
// region (announce), so the visual toast itself is not a second live region.

import { useCallback, useEffect, useRef, useState } from "react";
import { announce } from "../announce";

export const TOAST_MS = 6000;

export interface ToastData {
  id: number;
  message: string;
  /** Extra lines (import warnings). */
  details?: string[];
  /** Show an Undo button. */
  undo?: boolean;
  tone?: "info" | "error";
}

export function useToast() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const [paused, setPaused] = useState(false);
  const counter = useRef(0);

  const show = useCallback((t: Omit<ToastData, "id">) => {
    counter.current += 1;
    setToast({ ...t, id: counter.current });
    const extra = t.details?.length ? ` ${t.details.join(" ")}` : "";
    const end = /[.!?…]$/.test(t.message) ? "" : ".";
    announce(`${t.message}${end}${extra}${t.undo ? " Press Control Z to undo." : ""}`);
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast || paused) return;
    // Warnings take longer to read.
    const ms = TOAST_MS + (toast.details?.length ?? 0) * 2000;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast, paused]);

  return { toast, show, dismiss, setPaused };
}
