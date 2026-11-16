// Loads the BUILT Chrome extension (.output/chrome-mv3) into Chromium and gives
// its pages a mocked `chrome.devtools`: headless Chromium cannot open the real
// DevTools UI, so the panel page is opened as a normal tab of the extension
// origin (real manifest, real CSP, real bundle, real extension URL scheme) and
// `inspectedWindow.eval` is bridged to another tab through the DevTools protocol
// (`Runtime.evaluate` with the command-line API, which is what the real API uses).
// What this does NOT cover is listed in docs/extension.md.

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { chromePath } from "../../playwright.config";

export const EXTENSION_DIR = resolve(fileURLToPath(new URL("../../.output/chrome-mv3", import.meta.url)));

/** Chrome derives an unpacked extension's id from its absolute path: sha256, first 16 bytes, hex digits mapped to a-p. */
export function extensionIdFor(dir: string): string {
  const hash = createHash("sha256").update(realpathSync(dir)).digest("hex").slice(0, 32);
  return [...hash].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
}

export interface LaunchedExtension {
  context: BrowserContext;
  id: string;
  close(): Promise<void>;
}

export async function launchExtension(): Promise<LaunchedExtension> {
  if (!existsSync(join(EXTENSION_DIR, "manifest.json"))) {
    throw new Error(`Build the extension first: npm run build:chrome -w @opal42/extension (missing ${EXTENSION_DIR})`);
  }
  const userDataDir = mkdtempSync(join(tmpdir(), "opal42-profile-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath(),
    // Playwright's default headless shell cannot load extensions; the "chromium" channel is new headless.
    channel: chromePath() ? undefined : "chromium",
    headless: true,
    args: ["--no-sandbox", `--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  return {
    context,
    id: extensionIdFor(EXTENSION_DIR),
    close: async () => {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** Installs a fake `chrome.devtools` in `panel` whose eval runs in `inspected`. Returns helpers. */
export async function attachMockDevtools(panel: Page, inspected: Page) {
  const cdp = await inspected.context().newCDPSession(inspected);
  const evals: string[] = [];

  await panel.exposeFunction("__opal42Eval", async (expression: string) => {
    evals.push(expression);
    const r = (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, includeCommandLineAPI: true })) as {
      result: { value?: unknown };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    };
    if (r.exceptionDetails) {
      return { exception: { isException: true, description: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } };
    }
    return { result: r.result.value };
  });

  await panel.addInitScript(() => {
    const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const listeners = new Set<(url: string) => void>();
    w.chrome = w.chrome ?? {};
    w.chrome.devtools = {
      inspectedWindow: {
        eval(expression: string, callback: (result: unknown, exception?: unknown) => void) {
          w.__opal42Eval(expression).then(
            (r: { result?: unknown; exception?: unknown }) => callback(r.result, r.exception),
            (e: unknown) => callback(undefined, { isException: true, description: String(e) }),
          );
        },
      },
      network: {
        onNavigated: {
          addListener: (fn: (url: string) => void) => listeners.add(fn),
          removeListener: (fn: (url: string) => void) => listeners.delete(fn),
        },
      },
      panels: { themeName: "dark" },
    };
    w.__opal42Navigate = (url: string) => listeners.forEach((fn) => fn(url));
  });

  return { evals, navigate: (url: string) => panel.evaluate((u) => (window as unknown as { __opal42Navigate(u: string): void }).__opal42Navigate(u), url) };
}
