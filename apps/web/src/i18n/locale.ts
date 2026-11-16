// ── Locales and how the active one is chosen ──────────────────────────────────
// Order (docs/i18n.md): `lang=` in the URL fragment, then the stored choice,
// then the browser's language list, then English. Pure helpers plus thin
// wrappers around `window`; every storage access is guarded.

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Where the active locale came from. Only `url` and `user` are written back to the fragment. */
export type LocaleSource = "url" | "user" | "stored" | "browser" | "default";

/** Names shown in the language switcher: each in its own language, with the BCP 47 tag for `lang=`. */
export const LOCALE_LABELS: Readonly<Record<Locale, { short: string; name: string }>> = {
  en: { short: "EN", name: "English" },
  fr: { short: "FR", name: "Français" },
};

export const LOCALE_STORAGE_KEY = "gradient-studio:lang";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The first browser language we have a catalogue for: `fr`, `fr-CA`, `FR_ch` -> fr; everything else -> null. */
export function matchLanguages(languages: readonly string[] | undefined | null): Locale | null {
  for (const raw of languages ?? []) {
    const primary = String(raw).toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

/**
 * The `lang=` value of a URL fragment (`#v1;s=…;lang=fr`, `#issue=…;lang=fr`,
 * or a bare `#lang=fr`), or null when absent or not a supported locale.
 */
export function parseHashLang(hash: unknown): Locale | null {
  if (typeof hash !== "string" || hash.length > 1100) return null;
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const seg of text.split(";")) {
    if (seg.startsWith("lang=")) {
      const value = seg.slice(5).toLowerCase();
      return isLocale(value) ? value : null;
    }
  }
  return null;
}

export interface LocaleInputs {
  hash?: string | null;
  stored?: string | null;
  languages?: readonly string[] | null;
}

/** Pure resolution of the detection order. */
export function resolveLocale({ hash, stored, languages }: LocaleInputs): { locale: Locale; source: LocaleSource } {
  const fromHash = parseHashLang(hash ?? "");
  if (fromHash) return { locale: fromHash, source: "url" };
  if (isLocale(stored)) return { locale: stored, source: "stored" };
  const fromBrowser = matchLanguages(languages);
  if (fromBrowser) return { locale: fromBrowser, source: "browser" };
  return { locale: DEFAULT_LOCALE, source: "default" };
}
