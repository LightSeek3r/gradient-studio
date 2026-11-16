// ── Browser side of locale detection: localStorage, location, navigator ──────
// Kept apart from ./locale so the pure modules (and the VS Code extension that
// reuses explain.ts) never reference `window`.

import { LOCALE_STORAGE_KEY, isLocale, resolveLocale, type Locale, type LocaleSource } from "./locale";

export function readStoredLocale(): Locale | null {
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage unavailable: the choice then lasts for the session only.
  }
}

/** Detect from the real environment. Never throws. */
export function detectLocale(): { locale: Locale; source: LocaleSource } {
  let hash: string | null = null;
  let languages: readonly string[] | null = null;
  try {
    hash = window.location.hash;
  } catch {
    // Sandboxed frame.
  }
  try {
    languages = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : null;
  } catch {
    // No navigator.
  }
  return resolveLocale({ hash, stored: readStoredLocale(), languages });
}
