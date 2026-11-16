// ── Translator: catalogue + locale -> `t()` and number/list formatting ────────
// Framework-free so the pure modules (explain, import adapter, export model, …)
// can take an `I18n` argument and stay testable without React.

import { en, type MessageKey } from "./en";
import { fr } from "./fr";
import { formatMessage, type FormatContext, type MessageParams } from "./icu";
import type { Locale } from "./locale";

export type { MessageKey } from "./en";
export type { MessageParams } from "./icu";

export const CATALOGUES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { en, fr };

export type Translate = (key: MessageKey, params?: MessageParams) => string;

export interface I18n {
  locale: Locale;
  t: Translate;
  /** A number with exactly `digits` decimals, in the locale's notation (`0.12` / `0,12`). */
  number(value: number, digits?: number): string;
  /** `value` percent (not a fraction), up to 2 decimals: `33%` / `33 %`. */
  percent(value: number): string;
  /** "1, 2 and 3" / "1, 2 et 3". */
  list(items: readonly (string | number)[]): string;
}

/** Whether `key` names a message (for keys built at run time, e.g. `rule.${code}.name`). */
export function hasMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

const cache = new Map<Locale, I18n>();

export function createI18n(locale: Locale): I18n {
  const cached = cache.get(locale);
  if (cached) return cached;
  const catalogue = CATALOGUES[locale];
  // English list style keeps the app's wording ("1, 2 and 3"); other locales use their own.
  const listTag = locale === "en" ? "en-GB" : locale;
  const ctx: FormatContext = {
    locale,
    plurals: new Intl.PluralRules(locale),
    numbers: new Intl.NumberFormat(locale),
  };
  const percentFormat = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 });
  const listFormat = new Intl.ListFormat(listTag, { style: "long", type: "conjunction" });
  const digitsFormat = new Map<number, Intl.NumberFormat>();

  const i18n: I18n = {
    locale,
    t: (key, params) => formatMessage(catalogue[key] ?? en[key] ?? key, params, ctx),
    number(value, digits = 2) {
      let f = digitsFormat.get(digits);
      if (!f) {
        f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        digitsFormat.set(digits, f);
      }
      return f.format(value);
    },
    percent: (value) => percentFormat.format(value / 100),
    list: (items) => listFormat.format(items.map(String)),
  };
  cache.set(locale, i18n);
  return i18n;
}

/** English, for tests and for code that runs outside the provider. */
export const i18nEn = createI18n("en");
export const tEn: Translate = i18nEn.t;
