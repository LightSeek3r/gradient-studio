import { createContext, useContext } from "react";
import { createI18n, type I18n } from "./translator";
import type { Locale, LocaleSource } from "./locale";

export interface I18nContextValue extends I18n {
  source: LocaleSource;
  /** The language to carry in shared links and the address bar: set only when it was asked for (link or switcher). */
  linkLang: Locale | null;
  /** Switch language: remembered in localStorage and written to the URL fragment (`lang=`). */
  setLocale: (locale: Locale) => void;
}

/**
 * Outside an <I18nProvider> (a bare component in a test) everything is
 * English and switching does nothing; the app itself always mounts the provider.
 */
export const I18nContext = createContext<I18nContextValue>({
  ...createI18n("en"),
  source: "default",
  linkLang: null,
  setLocale: () => {},
});

/** Locale, translator and formatters. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/** The translator for the active locale. */
export function useT() {
  return useContext(I18nContext).t;
}
