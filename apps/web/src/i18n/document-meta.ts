// ── <html lang>, <title> and the description / Open Graph / Twitter tags ──────
// index.html is static and English (what crawlers and link previews that do
// not run scripts see). At runtime the active locale rewrites the same tags.

import type { Translate } from "./translator";
import type { Locale } from "./locale";

const TEXT_TAGS: readonly { selector: string; key: Parameters<Translate>[0] }[] = [
  { selector: 'meta[name="description"]', key: "meta.description" },
  { selector: 'meta[property="og:title"]', key: "meta.title" },
  { selector: 'meta[property="og:description"]', key: "meta.ogDescription" },
  { selector: 'meta[property="og:image:alt"]', key: "meta.ogImageAlt" },
  { selector: 'meta[property="og:locale"]', key: "meta.ogLocale" },
  { selector: 'meta[name="twitter:title"]', key: "meta.title" },
  { selector: 'meta[name="twitter:description"]', key: "meta.twitterDescription" },
];

export function applyDocumentLocale(locale: Locale, t: Translate, doc: Document = document): void {
  doc.documentElement.lang = locale;
  doc.title = t("meta.title");
  for (const { selector, key } of TEXT_TAGS) {
    doc.head.querySelector(selector)?.setAttribute("content", t(key));
  }
}
