// ── Issue permalinks: `#issue=<code>` ─────────────────────────────────────────
// A link to one rule of the score. Loading it opens the rule's example
// gradient (src/examples.ts) with that rule's ledger row expanded. Specified
// in docs/URL-FORMAT.md. It cannot be confused with a document link: those
// start with a version tag (`#v1;…`). Unknown codes are ignored.

import { findExample } from "../examples";
import type { Locale } from "../i18n/locale";

export const ISSUE_PREFIX = "issue=";
/** Longest fragment looked at (codes are ~30 characters). */
const MAX_LENGTH = 128;

/** The rule code of an issue link, or null when `hash` is not one for a known rule. Never throws. */
export function parseIssueHash(hash: unknown): string | null {
  if (typeof hash !== "string" || hash.length > MAX_LENGTH) return null;
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!text.startsWith(ISSUE_PREFIX)) return null;
  // `#issue=<code>;lang=fr`: the language of the link is read by i18n/locale.
  const [head, ...extra] = text.slice(ISSUE_PREFIX.length).split(";");
  if (extra.length > 1 || (extra.length === 1 && !extra[0].startsWith("lang="))) return null;
  let code = head;
  try {
    code = decodeURIComponent(code);
  } catch {
    return null;
  }
  return findExample(code)?.code ?? null;
}

/** `#issue=lightness/reversal`, or `#issue=lightness/reversal;lang=fr` with a language. */
export function issueHash(code: string, lang?: Locale | null): string {
  return `#${ISSUE_PREFIX}${code}${lang ? `;lang=${lang}` : ""}`;
}

/** The shareable link to a rule. */
export function issueLink(
  code: string,
  location: Pick<Location, "origin" | "pathname" | "search"> = window.location,
  lang?: Locale | null,
): string {
  return `${location.origin}${location.pathname}${location.search}${issueHash(code, lang)}`;
}
