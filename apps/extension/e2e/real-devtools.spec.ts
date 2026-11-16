// The REAL DevTools: headed Chromium (needs a display; locally `xvfb-run`),
// DevTools auto-opened on a fixture tab, the extension's own "Gradients" panel
// shown through DevTools' internal view manager, and the panel page driven over
// the DevTools protocol. No mock: chrome.devtools.inspectedWindow.eval, the
// panel registration, CSP and the extension URL scheme are all real.
//
// It relies on DevTools front-end internals (InspectorView) to switch tabs, which
// can change between Chromium versions, so it is skipped without a display and
// kept apart from the rest of the suite's assertions.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { chromePath } from "../playwright.config";
import { EXTENSION_DIR, extensionIdFor } from "./support/extension";
import { startFixture } from "./support/server";

test.skip(!process.env.DISPLAY, "needs a display: run under xvfb-run (headed Chromium opens real DevTools)");
test.setTimeout(120_000);

interface Cdp {
  send(method: string, params?: object, sessionId?: string): Promise<{ result?: any; error?: { message: string } }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close(): void;
}

async function connect(port: number): Promise<Cdp> {
  const ver = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let n = 0;
  const pending = new Map<number, (v: any) => void>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) pending.get(d.id)!(d);
  };
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((resolve) => {
        const id = ++n;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      }),
    close: () => ws.close(),
  };
}

test("the Gradients panel works inside the real DevTools", async () => {
  const fixture = await startFixture();
  const userDataDir = mkdtempSync(join(tmpdir(), "opal42-real-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath(),
    headless: false,
    args: ["--no-sandbox", `--remote-debugging-port=${port}`, `--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, "--auto-open-devtools-for-tabs"],
  });
  let cdp: Cdp | undefined;
  try {
    const id = extensionIdFor(EXTENSION_DIR);
    const page = await context.newPage();
    await page.goto(fixture.origin + "/");
    cdp = await connect(port);
    const targets = async () => ((await cdp!.send("Target.getTargets")).result.targetInfos as { type: string; url: string; targetId: string }[]);

    // 1. DevTools opened, and our devtools_page was loaded by it.
    await expect.poll(async () => (await targets()).some((t) => t.url === `chrome-extension://${id}/devtools.html`), { timeout: 20_000 }).toBe(true);
    const devtoolsUi = (await targets()).find((t) => t.url.startsWith("devtools://") && t.type === "page")!;
    const ui = (await cdp.send("Target.attachToTarget", { targetId: devtoolsUi.targetId, flatten: true })).result.sessionId as string;
    const inUi = async (expression: string) => (await cdp!.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, ui)).result?.result?.value;

    // 2. The panel is registered under the name "Gradients" and can be shown.
    const tabs = (await inUi(`(async()=>{ const m = await import('./ui/legacy/legacy.js'); return m.InspectorView.InspectorView.instance().tabbedPane.tabIds().join('|'); })()`)) as string;
    expect(tabs).toContain(`chrome-extension://${id}Gradients`);
    await inUi(`(async()=>{ const m = await import('./ui/legacy/legacy.js'); await m.InspectorView.InspectorView.instance().showPanel('chrome-extension://${id}Gradients'); })()`);
    await expect.poll(async () => (await targets()).some((t) => t.url === `chrome-extension://${id}/panel.html`), { timeout: 20_000 }).toBe(true);
    const panelTarget = (await targets()).find((t) => t.url === `chrome-extension://${id}/panel.html`)!;
    const sid = (await cdp.send("Target.attachToTarget", { targetId: panelTarget.targetId, flatten: true })).result.sessionId as string;
    const inPanel = async (expression: string, userGesture = false) => {
      const r = (await cdp!.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture }, sid)).result;
      if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r?.result?.value;
    };

    // 3. The real chrome.devtools.inspectedWindow.eval ran the scanner on the inspected page.
    await expect
      .poll(() => inPanel(`document.querySelector('[data-testid=count]')?.textContent`), { timeout: 20_000 })
      .toMatch(/^\d+ gradients found, \d+ scored, \d+ not scored\.$/);
    expect(await inPanel(`document.querySelectorAll('[data-testid=gradient-card]').length`)).toBeGreaterThan(8);
    expect(await inPanel(`document.body.textContent.includes('not running inside DevTools')`)).toBe(false);
    expect(await inPanel(`document.body.textContent.includes('cross-origin')`)).toBe(true);

    // 4. Highlight (real eval on the inspected page).
    await inPanel(`[...document.querySelectorAll('[data-testid=gradient-card]')].find(c => c.textContent.includes('div#rough.rough')).querySelector('button[aria-label^="Highlight div#rough"]').click()`, true);
    await expect.poll(() => page.locator("[data-opal42-highlight]").count()).toBe(1);
    await expect.poll(() => page.locator("[data-opal42-highlight]").count(), { timeout: 5000 }).toBe(0);

    // 5. "Elements" calls the real inspect(): DevTools switches to the Elements panel and selects the node.
    await inPanel(`[...document.querySelectorAll('[data-testid=gradient-card]')].find(c => c.textContent.includes('div#rough.rough')).querySelector('button[aria-label^="Show div#rough"]').click()`, true);
    await expect.poll(() => inUi(`(async()=>{ const m = await import('./ui/legacy/legacy.js'); return m.InspectorView.InspectorView.instance().tabbedPane.selectedTabId; })()`), { timeout: 10_000 }).toBe("elements");

    // 6. Copy through the real panel frame (a user gesture is supplied by the protocol).
    await inUi(`(async()=>{ const m = await import('./ui/legacy/legacy.js'); await m.InspectorView.InspectorView.instance().showPanel('chrome-extension://${id}Gradients'); })()`);
    await inPanel(`document.querySelector('[data-testid=gradient-card] button.btn-primary').click()`, true);
    await expect.poll(() => inPanel(`document.querySelector('[data-testid=toast]').textContent`), { timeout: 10_000 }).toMatch(/Copied refined CSS|Copying was blocked/);
    console.log("real DevTools copy result:", await inPanel(`document.querySelector('[data-testid=toast]').textContent`));

    // 6b. "Open in Gradient Studio": a target=_blank link opens a new tab with the hash (host stubbed, never contacted).
    await context.route("https://gradient-studio-al4.pages.dev/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>studio stub</title>" }));
    const popup = context.waitForEvent("page", { timeout: 15_000 });
    await inPanel(`document.querySelector('[data-testid=gradient-card] a[href^="https://gradient-studio-al4.pages.dev/#v1;"]').click()`, true);
    const opened = await popup;
    await opened.waitForLoadState();
    expect(opened.url()).toMatch(/^https:\/\/gradient-studio-al4\.pages\.dev\/#v1;s=/);
    await opened.close();

    // 7. A navigation of the inspected page re-scans (the real devtools.network.onNavigated).
    await page.goto(fixture.origin + "/empty");
    await expect.poll(() => inPanel(`document.querySelector('[data-testid=count]')?.textContent`), { timeout: 20_000 }).toBe("No gradients found on this page.");
  } finally {
    cdp?.close();
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    await fixture.close();
  }
});
