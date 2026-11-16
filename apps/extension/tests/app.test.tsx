// @vitest-environment jsdom
// The panel, end to end inside jsdom: App -> scan runner -> the real scanner
// text evaluated in a jsdom page -> analysis -> UI. Only the DevTools API is a fake.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";
import { scanNotices } from "../src/lib/notices";
import { NAVIGATION_DEBOUNCE_MS } from "../src/lib/scan-controller";
import { SETTINGS_KEY } from "../src/lib/settings";
import type { ScanStats } from "../src/lib/scan-runner";
import { fakeDevtools, setPage } from "./helpers/page";
import { byText, click, mount, unmount, waitFor } from "./helpers/mount";

const PAGE_STYLE = `<style>
  .smooth { background-image: linear-gradient(90deg, #1e3a8a, #3b82f6); }
  .rough  { background-image: linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 255, 0) 50%, rgb(0, 0, 255)); }
  .fade   { background-image: linear-gradient(to right, rgba(0, 0, 0, 0), rgb(255, 0, 0)); }
  .glow   { background-image: radial-gradient(rgb(255, 0, 0), rgb(0, 0, 255)); }
</style>`;
const PAGE_BODY = `<div class="smooth" id="s1">1</div><div class="smooth" id="s2">2</div><div class="rough" id="r1">3</div><div class="fade">4</div><div class="glow">5</div>`;

const text = (host: HTMLElement) => host.textContent ?? "";
const status = (host: HTMLElement) => host.querySelector('[data-testid="count"]')!.textContent;
const toast = (host: HTMLElement) => host.querySelector('[data-testid="toast"]')!.textContent?.trim();

let clipboard: string[] = [];
beforeEach(() => {
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => void clipboard.push(t) } });
  try {
    localStorage.clear();
  } catch {
    /* jsdom storage is fine; ignore */
  }
  setPage(PAGE_STYLE, PAGE_BODY);
  document.body.querySelectorAll("[data-opal42-highlight]").forEach((n) => n.remove());
});
afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

async function mountScanned(api = fakeDevtools()) {
  const host = await mount(<App api={api.api} />);
  await waitFor(() => /found/.test(status(host) ?? ""));
  return { host, ...api };
}

describe("panel: scan results", () => {
  it("announces the count in a polite live region", async () => {
    const { host } = await mountScanned();
    const region = host.querySelector('[data-testid="count"]')!;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("4 gradients found, 2 scored, 2 not scored.");
  });

  it("lists scored gradients lowest score first, each with score, swatch and issues", async () => {
    const { host } = await mountScanned();
    const cards = [...host.querySelectorAll('[data-testid="gradient-card"]')];
    expect(cards).toHaveLength(2);
    const scores = cards.map((c) => Number(c.querySelector('[data-testid="score"]')!.textContent));
    expect(scores[0]).toBeLessThan(scores[1]);
    expect(cards[0].textContent).toContain("What lowered the score");
    expect(cards[0].textContent).toContain("lightness reversal");
    expect(cards[0].querySelector(".swatch > span")?.getAttribute("style")).toContain("linear-gradient");
    expect(text(host)).toContain("Smoothness score");
    expect(text(host)).not.toMatch(/\b(excellent|poor|good|bad|pass|fail)\b/i);
  });

  it("lists not-scored gradients with their reason, collapsed by default", async () => {
    const { host } = await mountScanned();
    const details = host.querySelector("section[aria-labelledby=unscored-title] details")!;
    expect(details.hasAttribute("open")).toBe(false);
    const cards = [...host.querySelectorAll('[data-testid="unscored-card"]')];
    expect(cards.map((c) => c.textContent).join(" ")).toMatch(/translucent stops/);
    expect(cards.map((c) => c.textContent).join(" ")).toMatch(/Radial and conic/);
  });

  it("shows where each gradient is used, with the element selector and the rule", async () => {
    const { host } = await mountScanned();
    const smooth = byText(host, '[data-testid="gradient-card"]', "div#s1")!;
    expect(smooth.textContent).toContain("Used by (");
    expect(smooth.textContent).toContain("div#s1.smooth");
    expect(smooth.textContent).toContain(".smooth"); // the rule
    expect(smooth.textContent).toContain("in <style>");
  });

  it("says plainly when the page has no gradients", async () => {
    setPage("", "<p>nothing</p>");
    const { host } = await mountScanned();
    expect(status(host)).toBe("No gradients found on this page.");
    expect(text(host)).toContain("No gradients found.");
  });

  it("re-scans on demand and shows the new result", async () => {
    const { host } = await mountScanned();
    const added = document.createElement("div");
    added.style.backgroundImage = "linear-gradient(90deg, #101010, #f0f0f0)";
    document.body.appendChild(added);
    await click(byText(host, "button", "Re-scan"));
    await waitFor(() => /5 gradients found/.test(status(host) ?? ""));
    expect(status(host)).toBe("5 gradients found, 3 scored, 2 not scored.");
  });

  it("disables Re-scan while scanning", async () => {
    const api = fakeDevtools();
    const host = await mount(<App api={api.api} />);
    const button = byText<HTMLButtonElement>(host, "button", /Scanning|Re-scan/)!;
    await waitFor(() => /found/.test(status(host) ?? ""));
    expect(button.disabled).toBe(false);
  });
});

describe("panel: actions", () => {
  it("Copy refined CSS puts the refined gradient on the clipboard and announces it", async () => {
    const { host } = await mountScanned();
    const card = host.querySelector('[data-testid="gradient-card"]')!;
    const button = byText(card, "button", "Copy refined CSS")!;
    expect(button.textContent).toMatch(/\(\+\d+\)/);
    await click(button);
    await waitFor(() => clipboard.length > 0);
    expect(clipboard[0]).toMatch(/^linear-gradient\(/);
    await waitFor(() => toast(host) === "Copied refined CSS.");
  });

  it("Copy CSS copies the normalised gradient", async () => {
    const { host } = await mountScanned();
    const card = host.querySelector('[data-testid="gradient-card"]')!;
    await click(byText(card, "button", "Copy CSS"));
    await waitFor(() => clipboard.length > 0);
    expect(clipboard[0]).toBe(card.querySelector("pre")!.textContent);
  });

  it("offers 'Copy fix <label> (+N)' for each targeted fix", async () => {
    const { host } = await mountScanned();
    const card = host.querySelector('[data-testid="gradient-card"]')!;
    const fixes = [...card.querySelectorAll("button")].filter((b) => /^Copy fix: /.test(b.textContent ?? ""));
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0].textContent).toMatch(/^Copy fix: .+ \(\+\d+\)$/);
    await click(fixes[0]);
    await waitFor(() => clipboard.length > 0);
    expect(clipboard[0]).toMatch(/^linear-gradient\(/);
    await waitFor(() => /^Copied fix "/.test(toast(host) ?? ""));
  });

  it("falls back to execCommand when the clipboard API is blocked, and says so when that fails too", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("blocked")) } });
    document.execCommand = vi.fn(() => false);
    const { host } = await mountScanned();
    await click(byText(host, "button", "Copy CSS"));
    await waitFor(() => /Copying was blocked/.test(toast(host) ?? ""));
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("Highlight sends the element's selector through inspectedWindow.eval and announces the result", async () => {
    const seen: string[] = [];
    const { host } = await mountScanned(fakeDevtools({ onEval: (e) => seen.push(e) }));
    const el = document.getElementById("r1")!;
    el.scrollIntoView = vi.fn();
    const card = byText(host, '[data-testid="gradient-card"]', "div#r1")!;
    await click(byText(card, "button", "Highlight"));
    await waitFor(() => toast(host) === "Highlighted on the page.");
    const expr = seen.find((e) => e.includes("data-opal42-highlight"))!;
    expect(expr).toContain(JSON.stringify("#r1"));
    expect(el.scrollIntoView).toHaveBeenCalled();
  });

  it("says so when the highlighted element is gone", async () => {
    const { host } = await mountScanned();
    const card = byText(host, '[data-testid="gradient-card"]', "div#r1")!;
    document.getElementById("r1")!.remove();
    await click(byText(card, "button", "Highlight"));
    await waitFor(() => toast(host) === "That element is no longer on the page.");
  });

  it("'Elements' selects the element in the Elements panel", async () => {
    const inspect = vi.fn();
    (globalThis as unknown as { inspect: unknown }).inspect = inspect;
    const { host } = await mountScanned();
    const card = byText(host, '[data-testid="gradient-card"]', "div#r1")!;
    await click(byText(card, "button", "Elements"));
    await waitFor(() => toast(host) === "Selected in the Elements panel.");
    expect(inspect).toHaveBeenCalledWith(document.getElementById("r1"));
    delete (globalThis as unknown as { inspect?: unknown }).inspect;
  });

  it("'Open in Gradient Studio' is a plain link with the document in the hash, opened only by the user's click", async () => {
    const open = vi.spyOn(window, "open");
    const { host } = await mountScanned();
    const card = byText(host, '[data-testid="gradient-card"]', "div#s1")!;
    const link = byText<HTMLAnchorElement>(card, "a", "Open in Gradient Studio")!;
    expect(link.getAttribute("href")).toBe("https://gradient-studio-al4.pages.dev/#v1;s=1e3a8a@0,3b82f6@100;d=90:100:1;b=normal");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(open).not.toHaveBeenCalled();
  });

  it("disables the studio link, with a reason, when the gradient does not fit the format", async () => {
    const stops = Array.from({ length: 11 }, (_, i) => `#${(i * 20).toString(16).padStart(2, "0")}40${(255 - i * 20).toString(16).padStart(2, "0")}`).join(", ");
    setPage(`<style>.many{background-image:linear-gradient(90deg, ${stops})}</style>`, `<div class="many"></div>`);
    const { host } = await mountScanned();
    const button = byText(host, "button", "Open in Gradient Studio")!;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.tagName).toBe("BUTTON");
    const description = host.querySelector(`#${CSS.escape(button.getAttribute("aria-describedby")!)}`);
    expect(description?.textContent).toMatch(/at most 10 stops/);
  });
});

describe("panel: settings", () => {
  it("changes the studio address used by the links and remembers it", async () => {
    const { host } = await mountScanned();
    await click(byText(host, "button", "Settings"));
    const input = host.querySelector<HTMLInputElement>('input[type="url"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "https://studio.example.org/app/");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(byText(host, "button", "Save"));
    const link = host.querySelector<HTMLAnchorElement>('a[href*="#v1;"]')!;
    expect(link.href.startsWith("https://studio.example.org/app/#v1;")).toBe(true);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toEqual({ studioUrl: "https://studio.example.org/app/" });
    await waitFor(() => toast(host) === "Settings saved.");
  });

  it("refuses an unsafe address with an alert and keeps the old one", async () => {
    const { host } = await mountScanned();
    await click(byText(host, "button", "Settings"));
    const input = host.querySelector<HTMLInputElement>('input[type="url"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "javascript:alert(1)");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(byText(host, "button", "Save"));
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/https:\/\//);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(host.querySelector<HTMLAnchorElement>('a[href*="#v1;"]')!.href.startsWith("https://gradient-studio-al4.pages.dev/")).toBe(true);
  });

  it("reads a stored address on start", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ studioUrl: "https://stored.example.net/" }));
    const { host } = await mountScanned();
    expect(host.querySelector<HTMLAnchorElement>('a[href*="#v1;"]')!.href.startsWith("https://stored.example.net/#v1;")).toBe(true);
  });

  it("Settings toggles with aria-expanded", async () => {
    const { host } = await mountScanned();
    const button = byText(host, "button", "Settings")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("form[aria-label=Settings]")).not.toBeNull();
  });
});

describe("panel: navigation and failures", () => {
  it("re-scans once after a burst of navigation events (debounced)", async () => {
    const seen: string[] = [];
    const api = fakeDevtools({ onEval: (e) => seen.push(e) });
    const { host } = await mountScanned(api);
    const infoCalls = () => seen.filter((e) => e.includes('"op":"info"')).length;
    expect(infoCalls()).toBe(1);
    api.navigate();
    api.navigate();
    api.navigate();
    expect(infoCalls()).toBe(1);
    await waitFor(() => infoCalls() === 2, NAVIGATION_DEBOUNCE_MS + 2000);
    await waitFor(() => /found/.test(status(host) ?? ""));
    await new Promise((r) => setTimeout(r, 200));
    expect(infoCalls()).toBe(2);
  });

  it("stops listening when unmounted", async () => {
    const api = fakeDevtools();
    await mountScanned(api);
    expect(api.listenerCount()).toBe(1);
    await unmount();
    expect(api.listenerCount()).toBe(0);
  });

  it("shows an error, in an alert, when the page cannot be scanned", async () => {
    const api = fakeDevtools();
    api.api.inspectedWindow.eval = (_e, cb) => cb(undefined, { isException: true, description: "Cannot access contents of url" });
    const host = await mount(<App api={api.api} />);
    await waitFor(() => host.querySelector('[role="alert"]') !== null);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Cannot access contents of url");
    expect(status(host)).toBe("The scan failed.");
  });

  it("explains itself when it is not running inside DevTools", async () => {
    const host = await mount(<App api={null} />);
    expect(host.textContent).toContain("not running inside DevTools");
    expect(byText<HTMLButtonElement>(host, "button", "Re-scan")!.disabled).toBe(true);
  });
});

describe("scanNotices", () => {
  const stats = (over: Partial<ScanStats> = {}): ScanStats => ({
    elementsTotal: 100,
    elementsScanned: 100,
    elementCapReached: false,
    sheetsTotal: 1,
    sheetsScanned: 1,
    sheetCapReached: false,
    sheetsSkipped: [],
    sheetsCapped: 0,
    rulesScanned: 10,
    truncatedValues: 0,
    hitCapReached: false,
    readyState: "complete",
    calls: 4,
    ...over,
  });

  it("is empty for a complete scan", () => {
    expect(scanNotices(stats(), 0)).toEqual([]);
    expect(scanNotices(null, 0)).toEqual([]);
  });

  it("states the element cap with both numbers", () => {
    const n = scanNotices(stats({ elementCapReached: true, elementsTotal: 12034, elementsScanned: 5000 }), 0);
    expect(n).toHaveLength(1);
    expect(n[0]).toContain("12,034");
    expect(n[0]).toContain("5,000");
  });

  it("names cross-origin sheets and says their gradients still show through elements", () => {
    const n = scanNotices(stats({ sheetsSkipped: [{ label: "https://cdn.example/a.css", reason: "cross-origin" }] }), 0);
    expect(n[0]).toContain("cross-origin");
    expect(n[0]).toContain("https://cdn.example/a.css");
    expect(n[0]).toContain("still appear");
  });

  it("covers every other limit", () => {
    const n = scanNotices(
      stats({ sheetsSkipped: [{ label: "x", reason: "error" }], sheetCapReached: true, sheetsCapped: 2, hitCapReached: true, truncatedValues: 3, readyState: "loading" }),
      7,
    );
    expect(n.join("\n")).toMatch(/could not be read/);
    expect(n.join("\n")).toMatch(/more stylesheets than/);
    expect(n.join("\n")).toMatch(/only its first rules|only its first rules were read/);
    expect(n.join("\n")).toMatch(/very large number/);
    expect(n.join("\n")).toMatch(/cut short/);
    expect(n.join("\n")).toMatch(/7 further distinct/);
    expect(n.join("\n")).toMatch(/still loading/);
  });
});
