// ── Live score delta during an edit gesture ───────────────────────────────────
// While a stop is dragged, nudged or recoloured, the UI shows how far the
// score has moved since the gesture began ("+3" / "−7"). When the gesture ends
// (pointer up, blur, or a pause) the final change is announced once, politely.

import { useCallback, useEffect, useRef, useState } from "react";
import { announce } from "../announce";
import { useT } from "../i18n/context";
import { deltaSentence } from "../score-band";

/** A gesture with no explicit end is closed after this pause. */
export const DELTA_IDLE_MS = 1600;
/** The badge stays this long after the gesture ends. */
export const DELTA_LINGER_MS = 1400;

interface Gesture {
  /** The score when the gesture began. */
  base: number;
  /** The stop being edited (the badge follows its handle). */
  stopId: number | null;
}

export function useScoreDelta(score: number) {
  const t = useT();
  const tRef = useRef(t);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const live = useRef<{ base: number } | null>(null);
  const latest = useRef(score);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const linger = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speak = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    latest.current = score;
    tRef.current = t;
  });

  useEffect(
    () => () => {
      clearTimeout(idle.current);
      clearTimeout(linger.current);
      clearTimeout(speak.current);
    },
    [],
  );

  /** The gesture is over: announce the change once and let the badge fade. */
  const end = useCallback(() => {
    clearTimeout(idle.current);
    const g = live.current;
    if (!g) return;
    live.current = null;
    // Read the score after the last edit of the gesture has rendered.
    speak.current = setTimeout(() => {
      const sentence = deltaSentence(g.base, latest.current, tRef.current);
      if (sentence) announce(sentence);
    }, 80);
    linger.current = setTimeout(() => setGesture(null), DELTA_LINGER_MS);
  }, []);

  /** Call just before each edit of a continuous gesture. */
  const begin = useCallback(
    (stopId: number | null) => {
      clearTimeout(linger.current);
      clearTimeout(idle.current);
      if (!live.current) live.current = { base: latest.current };
      const base = live.current.base;
      setGesture((prev) => (prev && prev.base === base && prev.stopId === stopId ? prev : { base, stopId }));
      idle.current = setTimeout(end, DELTA_IDLE_MS);
    },
    [end],
  );

  return {
    /** Score change since the gesture began; null when no gesture is shown. */
    delta: gesture ? score - gesture.base : null,
    stopId: gesture?.stopId ?? null,
    begin,
    end,
  };
}
