// ── Keep the URL hash and autosave in step with the document ─────────────────

import { useEffect, useRef } from "react";
import { sameDocument, type GradientDocument } from "../state/document";
import { readHashDocument, readHashIssue, writeHash, writeStoredDocument } from "../persist/storage";

export const PERSIST_DEBOUNCE_MS = 300;

/**
 * Debounced `history.replaceState` + localStorage write on every change, and
 * a `hashchange` listener so pasting a different link into the address bar
 * of an open tab loads it (via `onLink`, as an undoable import). An issue
 * permalink (`#issue=<code>`) is handed to `onIssue` instead.
 */
export function usePersistence(
  doc: GradientDocument,
  onLink: (doc: GradientDocument) => void,
  onIssue?: (code: string) => void,
) {
  const latestDoc = useRef(doc);
  const latestOnLink = useRef(onLink);
  const latestOnIssue = useRef(onIssue);
  useEffect(() => {
    latestDoc.current = doc;
    latestOnLink.current = onLink;
    latestOnIssue.current = onIssue;
  });

  useEffect(() => {
    const t = setTimeout(() => {
      writeHash(doc);
      writeStoredDocument(doc);
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [doc]);

  useEffect(() => {
    const onHash = () => {
      const issue = readHashIssue();
      if (issue) {
        latestOnIssue.current?.(issue);
        return;
      }
      const next = readHashDocument();
      if (next && !sameDocument(next, latestDoc.current)) latestOnLink.current(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
}
