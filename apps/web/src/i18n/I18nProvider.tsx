import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nContext, type I18nContextValue } from "./context";
import { applyDocumentLocale } from "./document-meta";
import { parseHashLang, type Locale, type LocaleSource } from "./locale";
import { detectLocale, writeStoredLocale } from "./locale-browser";
import { createI18n } from "./translator";

/**
 * Owns the active locale: detects it once (URL `lang=`, stored choice, browser
 * languages), follows `lang=` changes of the address (`hashchange`), keeps
 * `<html lang>` and the page metadata in step, and exposes `setLocale`.
 * `initialLocale` pins the locale (tests, previews) and skips detection.
 */
export function I18nProvider({ initialLocale, children }: { initialLocale?: Locale; children: ReactNode }) {
  const [state, setState] = useState<{ locale: Locale; source: LocaleSource }>(() =>
    initialLocale ? { locale: initialLocale, source: "default" } : detectLocale(),
  );

  const setLocale = useCallback((locale: Locale) => {
    writeStoredLocale(locale);
    setState({ locale, source: "user" });
  }, []);

  useEffect(() => {
    if (initialLocale) return;
    const onHash = () => {
      const fromUrl = parseHashLang(window.location.hash);
      if (fromUrl) setState((prev) => (prev.locale === fromUrl && prev.source === "url" ? prev : { locale: fromUrl, source: "url" }));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [initialLocale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      ...createI18n(state.locale),
      source: state.source,
      linkLang: state.source === "url" || state.source === "user" ? state.locale : null,
      setLocale,
    }),
    [state, setLocale],
  );

  useEffect(() => {
    applyDocumentLocale(value.locale, value.t);
  }, [value.locale, value.t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
