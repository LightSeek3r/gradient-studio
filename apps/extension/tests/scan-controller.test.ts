// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { INITIAL_STATE, LOADING_RETRY_MS, MAX_LOADING_RETRIES, NAVIGATION_DEBOUNCE_MS, ScanController } from "../src/lib/scan-controller";
import type { DevtoolsApi } from "../src/lib/devtools-api";
import { fakeDevtools, setPage } from "./helpers/page";

const GRADIENT_PAGE = `<style>.a{background-image:linear-gradient(90deg,#1e3a8a,#3b82f6)}</style>`;

async function until(predicate: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let controller: ScanController | null = null;
afterEach(() => {
  controller?.stop();
  controller = null;
  vi.useRealTimers();
});

describe("ScanController", () => {
  it("starts idle", () => {
    const c = new ScanController(fakeDevtools().api);
    expect(c.getState()).toBe(INITIAL_STATE);
  });

  it("scans on start, publishes the result and notifies subscribers", async () => {
    setPage(GRADIENT_PAGE, `<div class="a"></div>`);
    controller = new ScanController(fakeDevtools().api);
    const seen: string[] = [];
    controller.subscribe(() => seen.push(controller!.getState().phase));
    controller.start();
    await until(() => controller!.getState().phase === "done");
    const s = controller.getState();
    expect(s.entries).toHaveLength(1);
    expect(s.summary).toMatchObject({ total: 1, scored: 1 });
    expect(s.announcement).toBe("1 gradient found, 1 scored.");
    expect(s.scanId).toBe(1);
    expect(seen).toContain("scanning");
    expect(seen.at(-1)).toBe("done");
  });

  it("start is idempotent (one listener, one scan)", async () => {
    setPage(GRADIENT_PAGE, `<div class="a"></div>`);
    const dev = fakeDevtools();
    controller = new ScanController(dev.api);
    controller.start();
    controller.start();
    await until(() => controller!.getState().phase === "done");
    expect(dev.listenerCount()).toBe(1);
    expect(controller.getState().scanId).toBe(1);
  });

  it("a newer rescan supersedes a scan in progress: only the newest result is published", async () => {
    setPage(GRADIENT_PAGE, `<div class="a"></div>`);
    controller = new ScanController(fakeDevtools().api);
    controller.start();
    controller.rescan();
    controller.rescan();
    await until(() => controller!.getState().phase === "done");
    await new Promise((r) => setTimeout(r, 100));
    expect(controller.getState().scanId).toBe(1);
  });

  it("stop cancels the scan in progress and removes the navigation listener", async () => {
    setPage(GRADIENT_PAGE, `<div class="a"></div>`);
    const dev = fakeDevtools();
    controller = new ScanController(dev.api);
    controller.start();
    controller.stop();
    await new Promise((r) => setTimeout(r, 100));
    expect(controller.getState().phase).not.toBe("done");
    expect(dev.listenerCount()).toBe(0);
  });

  it("re-scans once, after the debounce, for a burst of navigations", async () => {
    setPage(GRADIENT_PAGE, `<div class="a"></div>`);
    const evals: string[] = [];
    const dev = fakeDevtools({ onEval: (e) => evals.push(e) });
    controller = new ScanController(dev.api);
    controller.start();
    await until(() => controller!.getState().phase === "done");
    const before = evals.filter((e) => e.includes('"op":"info"')).length;
    for (let i = 0; i < 5; i++) dev.navigate();
    await new Promise((r) => setTimeout(r, NAVIGATION_DEBOUNCE_MS - 200));
    expect(evals.filter((e) => e.includes('"op":"info"')).length).toBe(before);
    await until(() => evals.filter((e) => e.includes('"op":"info"')).length === before + 1, NAVIGATION_DEBOUNCE_MS + 1500);
    await until(() => controller!.getState().scanId === 2);
  });

  it("scans again while the page still says it is loading, at most twice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let infos = 0;
    const api: DevtoolsApi = {
      inspectedWindow: {
        eval(expression, cb) {
          const request = JSON.parse(expression.slice(expression.lastIndexOf(")({") + 2, -1)) as { op: string };
          if (request.op === "info") {
            infos++;
            cb({ op: "info", elements: 1, sheets: 0, readyState: "loading" });
          } else {
            cb({ op: "elements", start: 0, next: 1, total: 1, hits: [], hitCapReached: false });
          }
        },
      },
    };
    controller = new ScanController(api);
    controller.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(infos).toBe(1);
    await vi.advanceTimersByTimeAsync(LOADING_RETRY_MS + 50);
    expect(infos).toBe(2);
    await vi.advanceTimersByTimeAsync(LOADING_RETRY_MS + 50);
    expect(infos).toBe(1 + MAX_LOADING_RETRIES);
    await vi.advanceTimersByTimeAsync(LOADING_RETRY_MS * 3);
    expect(infos).toBe(1 + MAX_LOADING_RETRIES);
  });

  it("reports a page failure as an error state with a short announcement", async () => {
    const api: DevtoolsApi = { inspectedWindow: { eval: (_e, cb) => cb(undefined, { isException: true, description: "Cannot access a chrome:// URL" }) } };
    controller = new ScanController(api);
    controller.start();
    await until(() => controller!.getState().phase === "error");
    expect(controller.getState()).toMatchObject({ error: "Cannot access a chrome:// URL", announcement: "The scan failed." });
  });

  it("recovers from an error on the next scan", async () => {
    let fail = true;
    const dev = fakeDevtools();
    const real = dev.api.inspectedWindow.eval;
    dev.api.inspectedWindow.eval = (e, cb) => (fail ? cb(undefined, { isException: true, description: "boom" }) : real(e, cb));
    setPage(GRADIENT_PAGE, `<div class="a"></div>`);
    controller = new ScanController(dev.api);
    controller.start();
    await until(() => controller!.getState().phase === "error");
    fail = false;
    controller.rescan();
    await until(() => controller!.getState().phase === "done");
    expect(controller.getState().error).toBeNull();
  });

  it("works with a DevTools API that has no navigation events", async () => {
    setPage(GRADIENT_PAGE, `<div class="a"></div>`);
    const api: DevtoolsApi = { inspectedWindow: fakeDevtools().api.inspectedWindow };
    controller = new ScanController(api);
    controller.start();
    await until(() => controller!.getState().phase === "done");
    expect(() => controller!.stop()).not.toThrow();
  });
});
