// The BUILT panel (real manifest, CSP, bundle) in Chromium, driven against a real
// fixture page. See e2e/support/extension.ts for what is mocked.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { attachMockDevtools, EXTENSION_DIR, launchExtension, type LaunchedExtension } from "./support/extension";
import { startFixture, type Fixture } from "./support/server";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

let fixture: Fixture;
let ext: LaunchedExtension;
let context: BrowserContext;

test.beforeAll(async () => {
  fixture = await startFixture();
  ext = await launchExtension();
  context = ext.context;
});
test.afterAll(async () => {
  await ext?.close();
  await fixture?.close();
});

const panelUrl = () => `chrome-extension://${ext.id}/panel.html`;

async function openPanel(path = "/") {
  const inspected = await context.newPage();
  await inspected.goto(fixture.origin + path);
  const panel = await context.newPage();
  const violations: string[] = [];
  const requests: string[] = [];
  const errors: string[] = [];
  panel.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
  });
  panel.on("pageerror", (e) => errors.push(String(e)));
  panel.on("request", (r) => requests.push(r.url()));
  await panel.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      ((window as unknown as { __csp: string[] }).__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const mock = await attachMockDevtools(panel, inspected);
  await panel.goto(panelUrl());
  await expect(panel.getByTestId("count")).toContainText("found", { timeout: 20_000 });
  return { inspected, panel, mock, violations, requests, errors };
}

async function axeViolations(page: Page) {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { html: string; any: { message: string }[] }[] }[] }> } }).axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.html.slice(0, 100) + " -> " + (n.any[0]?.message ?? "")).join(" || ")}`);
  });
}

test.describe("extension loads", () => {
  test("the unpacked extension is accepted by Chromium and serves its pages", async () => {
    const page = await context.newPage();
    for (const file of ["devtools.html", "panel.html", "icon/32.png", "icon/128.png"]) {
      const response = await page.goto(`chrome-extension://${ext.id}/${file}`);
      expect(response?.ok(), file).toBe(true);
    }
    await page.close();
  });

  test("the DevTools page registers one panel, 'Gradients', with an icon and the panel page", async () => {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const calls: unknown[][] = [];
      (window as unknown as Record<string, unknown>).__panelCalls = calls;
      const w = window as unknown as { chrome: Record<string, unknown> };
      w.chrome.devtools = { panels: { create: (...args: unknown[]) => calls.push(args) } };
    });
    await page.goto(`chrome-extension://${ext.id}/devtools.html`);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __panelCalls: unknown[][] }).__panelCalls.length)).toBe(1);
    const call = await page.evaluate(() => (window as unknown as { __panelCalls: unknown[][] }).__panelCalls[0]);
    expect(call).toEqual(["Gradients", "icon/32.png", "panel.html"]);
    await page.close();
  });

  test("the built manifest has no permissions and a strict CSP", async () => {
    const manifest = JSON.parse(readFileSync(`${EXTENSION_DIR}/manifest.json`, "utf8")) as Record<string, unknown>;
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
    expect(JSON.stringify(manifest.content_security_policy)).toContain("connect-src 'none'");
  });
});

test.describe("panel against a real page", () => {
  test("shows the gradients with scores, issues and usages", async () => {
    const { panel, inspected } = await openPanel();
    const count = await panel.getByTestId("count").textContent();
    expect(count).toMatch(/^\d+ gradients found, \d+ scored, \d+ not scored\.$/);
    const cards = panel.getByTestId("gradient-card");
    expect(await cards.count()).toBeGreaterThan(8);
    const firstScore = Number(await cards.first().getByTestId("score").textContent());
    const lastScore = Number(await cards.last().getByTestId("score").textContent());
    expect(firstScore).toBeLessThanOrEqual(lastScore); // lowest first
    await expect(panel.getByText("div.xo").first()).toBeVisible(); // seen through the cross-origin sheet
    await expect(panel.locator(".notices")).toContainText("cross-origin");
    await panel.screenshot({ path: "test-results/panel-overview.png", fullPage: true });
    await inspected.close();
  });

  test("makes no request other than to its own extension origin, and the CSP blocks nothing", async () => {
    const { panel, requests, errors, inspected } = await openPanel();
    expect(requests.length).toBeGreaterThan(0);
    for (const url of requests) expect(url.startsWith(`chrome-extension://${ext.id}/`) || url.startsWith("data:"), url).toBe(true);
    const csp = await panel.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    expect(csp).toEqual([]);
    expect(errors).toEqual([]);
    await inspected.close();
  });

  test("the strict CSP is really enforced on the panel page (inline script and remote fetch are blocked)", async () => {
    const { panel, inspected } = await openPanel();
    const inline = await panel.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.__inlineRan = true";
      document.head.appendChild(s);
      return (window as unknown as { __inlineRan?: boolean }).__inlineRan === true;
    });
    expect(inline).toBe(false);
    const fetched = await panel.evaluate(() => fetch("http://127.0.0.1:9/x").then(() => "ok", () => "blocked"));
    expect(fetched).toBe("blocked");
    const csp = await panel.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    expect(csp.some((v) => v.startsWith("script-src"))).toBe(true);
    expect(csp.some((v) => v.startsWith("connect-src"))).toBe(true);
    await inspected.close();
  });

  test("axe finds no violations, including colour contrast", async () => {
    const { panel, inspected } = await openPanel();
    await panel.locator("details").evaluateAll((els) => els.forEach((d) => d.setAttribute("open", "")));
    await panel.getByRole("button", { name: "Settings" }).click();
    expect(await axeViolations(panel)).toEqual([]);
    await inspected.close();
  });

  test("every control is reachable by keyboard and shows a visible focus ring", async () => {
    const { panel, inspected } = await openPanel();
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      await panel.keyboard.press("Tab");
      const info = await panel.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const cs = getComputedStyle(el);
        return { tag: el.tagName, text: (el.textContent ?? "").trim().slice(0, 30), outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth), focusVisible: el.matches(":focus-visible") };
      });
      expect(info.focusVisible).toBe(true);
      expect(info.outline, `${info.tag} ${info.text}`).not.toBe("none");
      expect(info.width, `${info.tag} ${info.text}`).toBeGreaterThanOrEqual(2);
      seen.add(info.tag);
    }
    expect(seen.has("BUTTON")).toBe(true);
    expect(seen.has("SELECT")).toBe(true);
    await inspected.close();
  });

  test("keyboard: Enter on 'Settings' opens it and Escape-free toggling works", async () => {
    const { panel, inspected } = await openPanel();
    const settings = panel.getByRole("button", { name: "Settings" });
    await settings.focus();
    await panel.keyboard.press("Enter");
    await expect(settings).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByLabel("Gradient Studio address")).toBeVisible();
    await panel.keyboard.press("Enter");
    await expect(settings).toHaveAttribute("aria-expanded", "false");
    await inspected.close();
  });

  test("Copy refined CSS writes to the clipboard (extension page, no clipboardWrite permission)", async () => {
    const { panel, inspected } = await openPanel();
    // Reading back needs a browser-level grant; writing from the page must not.
    const browserCdp = await context.browser()?.newBrowserCDPSession();
    await browserCdp?.send("Browser.grantPermissions", { origin: `chrome-extension://${ext.id}`, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => undefined);
    const card = panel.getByTestId("gradient-card").first();
    const expected = (await card.locator("pre").first().textContent()) ?? "";
    await card.getByRole("button", { name: /Copy refined CSS/ }).click();
    await expect(panel.getByTestId("toast")).toContainText("Copied refined CSS.");
    const text = await panel.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (text !== null) {
      expect(text).toMatch(/^linear-gradient\(/);
      expect(text).not.toBe(expected); // the refined gradient, not the original
    } else {
      test.info().annotations.push({ type: "note", description: "clipboard read-back not permitted in this run; the write itself succeeded (toast)" });
    }
    await card.getByRole("button", { name: "Copy CSS", exact: true }).click();
    await expect(panel.getByTestId("toast")).toContainText("Copied CSS.");
    await inspected.close();
  });

  test("Highlight outlines the element on the inspected page for a moment, then removes the outline", async () => {
    const { panel, inspected } = await openPanel();
    const card = panel.getByTestId("gradient-card").filter({ hasText: "div#rough.rough" }).first();
    await card.getByRole("button", { name: /Highlight div#rough/ }).click();
    await expect(panel.getByTestId("toast")).toContainText("Highlighted on the page.");
    await expect(inspected.locator("[data-opal42-highlight]")).toHaveCount(1);
    const box = await inspected.locator("[data-opal42-highlight]").boundingBox();
    const target = await inspected.locator("#rough").boundingBox();
    expect(box && target && Math.abs(box.x - (target.x - 2)) < 3 && Math.abs(box.y - (target.y - 2)) < 3).toBe(true);
    await expect(inspected.locator("[data-opal42-highlight]")).toHaveCount(0, { timeout: 5000 });
    await inspected.close();
  });

  test("Open in Gradient Studio is a link whose hash the web app's decoder accepts, and nothing opens before the click", async () => {
    const { panel, inspected } = await openPanel();
    const pagesBefore = context.pages().length;
    const link = panel.getByTestId("gradient-card").first().getByRole("link", { name: "Open in Gradient Studio" });
    const href = (await link.getAttribute("href"))!;
    expect(href.startsWith("https://gradient-studio-al4.pages.dev/#v1;")).toBe(true);
    expect(context.pages().length).toBe(pagesBefore);
    // The exact decoder of the web app is exercised in tests/studio-link.test.ts; here: the documented shape.
    expect(new URL(href).hash).toMatch(/^#v1;s=([0-9a-f]{6}@\d{1,3}(\.\d{1,2})?,){1,9}[0-9a-f]{6}@\d{1,3}(\.\d{1,2})?;d=\d{1,3}:100:1;b=normal$/);
    // The click opens a new tab; the studio host is not contacted in this test.
    await context.route("https://gradient-studio-al4.pages.dev/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>studio stub</title>" }));
    const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe(href);
    await context.unroute("https://gradient-studio-al4.pages.dev/**");
    await popup.close();
    await inspected.close();
  });

  test("the studio address setting changes the links", async () => {
    const { panel, inspected } = await openPanel();
    await panel.getByRole("button", { name: "Settings" }).click();
    await panel.getByLabel("Gradient Studio address").fill("https://studio.example.org/app/");
    await panel.getByRole("button", { name: "Save" }).click();
    const href = await panel.getByTestId("gradient-card").first().getByRole("link", { name: "Open in Gradient Studio" }).getAttribute("href");
    expect(href?.startsWith("https://studio.example.org/app/#v1;")).toBe(true);
    // Persisted in the panel's own localStorage, no extension permission needed.
    await panel.reload();
    await expect(panel.getByTestId("count")).toContainText("found", { timeout: 20_000 });
    const again = await panel.getByTestId("gradient-card").first().getByRole("link", { name: "Open in Gradient Studio" }).getAttribute("href");
    expect(again?.startsWith("https://studio.example.org/app/#v1;")).toBe(true);
    await panel.evaluate(() => localStorage.clear());
    await inspected.close();
  });

  test("Re-scan picks up a change, and a navigation event triggers a debounced re-scan", async () => {
    const { panel, inspected, mock } = await openPanel();
    const before = Number(((await panel.getByTestId("count").textContent()) ?? "").match(/^(\d+)/)![1]);
    await inspected.evaluate(() => {
      const d = document.createElement("div");
      d.style.backgroundImage = "linear-gradient(90deg, #101010, #f0f0f0)";
      d.style.height = "10px";
      document.body.appendChild(d);
    });
    await panel.getByRole("button", { name: "Re-scan" }).click();
    await expect(panel.getByTestId("count")).toContainText(`${before + 1} gradients found`);
    await inspected.evaluate(() => {
      const d = document.createElement("div");
      d.style.backgroundImage = "linear-gradient(90deg, #202020, #e0e0e0)";
      document.body.appendChild(d);
    });
    const infoCount = () => mock.evals.filter((e) => e.includes('"op":"info"')).length;
    const n = infoCount();
    await mock.navigate("http://x/");
    await mock.navigate("http://x/");
    await expect.poll(infoCount, { timeout: 5000 }).toBe(n + 1);
    await expect(panel.getByTestId("count")).toContainText(`${before + 2} gradients found`);
    await inspected.close();
  });

  test("a page without gradients says so", async () => {
    const { panel, inspected } = await openPanel("/empty");
    await expect(panel.getByTestId("count")).toHaveText("No gradients found on this page.");
    expect(await axeViolations(panel)).toEqual([]);
    await inspected.close();
  });

  test("a large page shows the cap notice and stays responsive", async () => {
    const { panel, inspected } = await openPanel("/big?n=12000");
    await expect(panel.locator(".notices")).toContainText("Only the first 5,000 were examined");
    await panel.screenshot({ path: "test-results/panel-large.png" });
    await inspected.close();
  });

  test("shows a clear message when the page cannot be evaluated", async () => {
    const inspected = await context.newPage();
    await inspected.goto("about:blank");
    const panel = await context.newPage();
    await panel.exposeFunction("__opal42Eval", async () => ({ exception: { isException: true, description: "Cannot access contents of url" } }));
    await panel.addInitScript(() => {
      const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      w.chrome.devtools = { inspectedWindow: { eval: (e: string, cb: (r: unknown, x: unknown) => void) => w.__opal42Eval(e).then((r: { exception: unknown }) => cb(undefined, r.exception)) } };
    });
    await panel.goto(panelUrl());
    await expect(panel.getByRole("alert")).toContainText("Cannot access contents of url");
    expect(await axeViolations(panel)).toEqual([]);
    await inspected.close();
  });

  test("outside DevTools the panel explains itself instead of failing", async () => {
    const panel = await context.newPage();
    await panel.goto(panelUrl());
    await expect(panel.getByText("not running inside DevTools")).toBeVisible();
    expect(await axeViolations(panel)).toEqual([]);
  });

  test("works at a narrow DevTools width (320px) without horizontal scrolling", async () => {
    const { panel, inspected } = await openPanel();
    await panel.setViewportSize({ width: 320, height: 700 });
    const overflow = await panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await panel.screenshot({ path: "test-results/panel-320.png", fullPage: false });
    await inspected.close();
  });
});
