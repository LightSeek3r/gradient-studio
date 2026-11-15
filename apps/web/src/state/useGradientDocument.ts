// ── React binding for the document + history ──────────────────────────────────

import { useCallback, useMemo, useReducer } from "react";
import type { GradientDocument } from "./document";
import { createHistory, createHistoryReducer, type History } from "./history";
import { documentReducer, type DocumentAction } from "./reducer";

const historyReducer = createHistoryReducer(documentReducer);

export interface DocumentStore {
  doc: GradientDocument;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Apply an edit. Pass a `key` for continuous edits (drag, typing, slider):
   * consecutive same-key edits within 800 ms become ONE undo step.
   */
  dispatch: (action: DocumentAction, key?: string) => void;
  undo: () => void;
  redo: () => void;
  /** End a coalescing run (pointer up / blur) so the next edit is its own step. */
  commit: () => void;
}

export function useGradientDocument(initial: () => GradientDocument): DocumentStore {
  const [history, send] = useReducer(
    historyReducer,
    undefined,
    (): History<GradientDocument> => createHistory(initial()),
  );

  const dispatch = useCallback(
    (action: DocumentAction, key?: string) => send({ type: "do", action, key, time: Date.now() }),
    [],
  );
  const undo = useCallback(() => send({ type: "undo" }), []);
  const redo = useCallback(() => send({ type: "redo" }), []);
  const commit = useCallback(() => send({ type: "commit" }), []);

  return useMemo(
    () => ({
      doc: history.present,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      dispatch,
      undo,
      redo,
      commit,
    }),
    [history, dispatch, undo, redo, commit],
  );
}
