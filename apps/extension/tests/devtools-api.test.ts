import { describe, expect, it } from "vitest";
import { getDevtools, makeEvalFn, type DevtoolsApi } from "../src/lib/devtools-api";

const api = (impl: DevtoolsApi["inspectedWindow"]["eval"]): DevtoolsApi => ({ inspectedWindow: { eval: impl } });

describe("getDevtools", () => {
  it("returns chrome.devtools when it can evaluate in the page", () => {
    const d = api(() => undefined);
    expect(getDevtools({ chrome: { devtools: d } })).toBe(d);
  });

  it("returns null outside DevTools", () => {
    expect(getDevtools({})).toBeNull();
    expect(getDevtools({ chrome: {} })).toBeNull();
    expect(getDevtools({ chrome: { devtools: {} } })).toBeNull();
    expect(getDevtools({ chrome: { devtools: { inspectedWindow: {} } } })).toBeNull();
  });
});

describe("makeEvalFn", () => {
  it("resolves with the evaluation result", async () => {
    const fn = makeEvalFn(api((expr, cb) => cb(`ran:${expr}`)));
    await expect(fn("1+1")).resolves.toBe("ran:1+1");
  });

  it("rejects with the page's exception description", async () => {
    const fn = makeEvalFn(api((_e, cb) => cb(undefined, { isException: true, description: "ReferenceError: x is not defined" })));
    await expect(fn("x")).rejects.toThrow("ReferenceError: x is not defined");
  });

  it("rejects on a DevTools-side error (isError) using code or value as the message", async () => {
    await expect(makeEvalFn(api((_e, cb) => cb(undefined, { isError: true, code: "E_NOTFOUND" })))("x")).rejects.toThrow("E_NOTFOUND");
    await expect(makeEvalFn(api((_e, cb) => cb(undefined, { isException: true, value: "thrown value" })))("x")).rejects.toThrow("thrown value");
  });

  it("bounds the message length", async () => {
    const fn = makeEvalFn(api((_e, cb) => cb(undefined, { isException: true, description: "x".repeat(5000) })));
    await expect(fn("x")).rejects.toSatisfy((e: Error) => e.message.length === 300);
  });

  it("rejects when eval itself throws", async () => {
    const fn = makeEvalFn(
      api(() => {
        throw new Error("no inspected window");
      }),
    );
    await expect(fn("x")).rejects.toThrow("no inspected window");
  });

  it("an exception object without the flags is not an error", async () => {
    const fn = makeEvalFn(api((_e, cb) => cb(5, {})));
    await expect(fn("x")).resolves.toBe(5);
  });
});
