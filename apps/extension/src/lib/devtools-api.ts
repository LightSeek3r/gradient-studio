// The slice of the DevTools extension API the panel uses, typed by hand, and
// the adapters over it. Chrome and Firefox both expose `chrome.devtools.*` with
// callbacks, so the panel uses the `chrome` namespace on both; there is no
// dependency on `browser`/`chrome` typings and tests pass a plain fake.

export interface ExceptionInfo {
  isError?: boolean;
  isException?: boolean;
  code?: string;
  description?: string;
  details?: unknown[];
  value?: string;
}

export interface DevtoolsApi {
  inspectedWindow: {
    eval(expression: string, callback: (result: unknown, exception?: ExceptionInfo) => void): void;
  };
  network?: {
    onNavigated?: {
      addListener(listener: (url: string) => void): void;
      removeListener(listener: (url: string) => void): void;
    };
  };
  panels?: { themeName?: string };
}

/** `chrome.devtools` when this page is a DevTools extension page, else null. */
export function getDevtools(root: unknown = globalThis): DevtoolsApi | null {
  const chromeApi = (root as { chrome?: { devtools?: DevtoolsApi } }).chrome;
  const api = chromeApi?.devtools;
  return api && typeof api.inspectedWindow?.eval === "function" ? api : null;
}

function describeException(info: ExceptionInfo): string {
  const text = info.description || info.value || info.code || "The page raised an error";
  return String(text).slice(0, 300);
}

/** Promise wrapper over `inspectedWindow.eval`; rejects on a page exception or a DevTools-side error. */
export function makeEvalFn(api: DevtoolsApi): (expression: string) => Promise<unknown> {
  return (expression) =>
    new Promise((resolve, reject) => {
      try {
        api.inspectedWindow.eval(expression, (result, exception) => {
          if (exception && (exception.isError || exception.isException)) reject(new Error(describeException(exception)));
          else resolve(result);
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
}
