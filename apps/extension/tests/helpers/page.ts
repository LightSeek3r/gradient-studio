// Test helpers: run the scanner's expression text in the current (jsdom) page,
// exactly as `inspectedWindow.eval` would, and drive full scans against it.

import { runScan, type EvalFn, type RunOptions } from "../../src/lib/scan-runner";

/** Evaluates an expression in the page scope (the jsdom globals), like inspectedWindow.eval. */
export const evalInPage: EvalFn = (expression) => Promise.resolve().then(() => new Function(`return ${expression}`)());

export function setPage(head: string, body: string): void {
  document.head.innerHTML = head;
  document.body.innerHTML = body;
}

export function scanPageNow(options: RunOptions = {}) {
  return runScan(evalInPage, options);
}

/** A fake DevTools API whose eval runs in the current jsdom page. */
export function fakeDevtools(overrides: { onEval?: (expr: string) => void } = {}) {
  const listeners = new Set<(url: string) => void>();
  const api = {
    inspectedWindow: {
      eval(expression: string, callback: (result: unknown, exception?: { isException?: boolean; description?: string }) => void) {
        overrides.onEval?.(expression);
        try {
          callback(new Function(`return ${expression}`)());
        } catch (e) {
          callback(undefined, { isException: true, description: String(e) });
        }
      },
    },
    network: {
      onNavigated: {
        addListener: (fn: (url: string) => void) => listeners.add(fn),
        removeListener: (fn: (url: string) => void) => listeners.delete(fn),
      },
    },
  };
  return { api, navigate: (url = "https://example.test/") => listeners.forEach((fn) => fn(url)), listenerCount: () => listeners.size };
}
