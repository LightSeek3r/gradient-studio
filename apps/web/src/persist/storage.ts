// ── Persistence: URL hash + localStorage ──────────────────────────────────────
// Nothing here talks to a network. Every storage access is wrapped: private
// windows, blocked site data and quota errors must never break the editor.

import { exampleDocument, findExample } from "../examples";
import { defaultDocument, sameDocument, type GradientDocument } from "../state/document";
import { parseIssueHash } from "./issue-link";
import { decodeDocument, encodeDocument } from "./url-codec";

export const STORAGE_KEY = "gradient-studio:document";

export function readStoredDocument(): GradientDocument | null {
  try {
    return decodeDocument(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredDocument(doc: GradientDocument): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeDocument(doc));
  } catch {
    // Storage unavailable or full - autosave is best-effort.
  }
}

export function readHashDocument(): GradientDocument | null {
  try {
    return decodeDocument(window.location.hash);
  } catch {
    return null;
  }
}

/** The rule code when the address is an issue permalink (`#issue=<code>`) for a known rule. */
export function readHashIssue(): string | null {
  try {
    return parseIssueHash(window.location.hash);
  } catch {
    return null;
  }
}

export type DocumentSource = "link" | "example" | "autosave" | "default";

/**
 * Restore priority: URL hash > localStorage > default. An issue permalink
 * loads that rule's example gradient and reports the rule as `issue`.
 */
export function loadInitialDocument(): { document: GradientDocument; source: DocumentSource; issue?: string } {
  const issue = readHashIssue();
  const example = issue ? findExample(issue) : null;
  if (issue && example) return { document: exampleDocument(example), source: "example", issue };
  const fromHash = readHashDocument();
  if (fromHash) return { document: fromHash, source: "link" };
  const stored = readStoredDocument();
  if (stored) return { document: stored, source: "autosave" };
  return { document: defaultDocument(), source: "default" };
}

/** Put the document in the address bar without adding a browser history entry. */
export function writeHash(doc: GradientDocument): void {
  try {
    const hash = `#${encodeDocument(doc)}`;
    if (window.location.hash === hash) return;
    // An issue permalink stays in the address bar for as long as the document
    // is still that rule's untouched example.
    const example = findExample(parseIssueHash(window.location.hash));
    if (example && sameDocument(exampleDocument(example), doc)) return;
    window.history.replaceState(window.history.state, "", hash);
  } catch {
    // Sandboxed frames can refuse replaceState; the link button still works.
  }
}

/** The shareable link for a document. */
export function documentLink(doc: GradientDocument): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#${encodeDocument(doc)}`;
}
