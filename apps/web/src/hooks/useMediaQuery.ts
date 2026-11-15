import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query; `false` where matchMedia is unavailable. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** The widest viewport that uses the one-panel-at-a-time mobile layout. */
export const MOBILE_QUERY = "(max-width: 720px)";
