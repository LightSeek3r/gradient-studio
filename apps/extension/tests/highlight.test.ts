// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { highlightExpression, inspectExpression } from "../src/lib/highlight";

const run = (expr: string | null): unknown => new Function(`return ${expr}`)();

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.querySelectorAll("[data-opal42-highlight]").forEach((n) => n.remove());
});

describe("highlightExpression", () => {
  it("draws a temporary overlay over the element and removes it again", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="t">target</div>`;
    const el = document.getElementById("t")!;
    el.scrollIntoView = vi.fn();
    const styleBefore = el.getAttribute("style");
    expect(run(highlightExpression("#t"))).toBe("ok");
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "center" });
    expect(document.querySelectorAll("[data-opal42-highlight]")).toHaveLength(1);
    expect(el.getAttribute("style")).toBe(styleBefore); // the element itself is not touched
    vi.advanceTimersByTime(2000);
    expect(document.querySelectorAll("[data-opal42-highlight]")).toHaveLength(0);
  });

  it("the overlay does not capture the pointer and sits above the page", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="t"></div>`;
    document.getElementById("t")!.scrollIntoView = vi.fn();
    run(highlightExpression("#t"));
    const box = document.querySelector<HTMLElement>("[data-opal42-highlight]")!;
    expect(box.style.pointerEvents).toBe("none");
    expect(box.style.position).toBe("fixed");
    expect(box.style.zIndex).toBe("2147483647");
  });

  it("repeated clicks stack harmlessly and each overlay cleans itself up", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="t"></div>`;
    document.getElementById("t")!.scrollIntoView = vi.fn();
    run(highlightExpression("#t"));
    run(highlightExpression("#t"));
    expect(document.querySelectorAll("[data-opal42-highlight]")).toHaveLength(2);
    vi.advanceTimersByTime(2000);
    expect(document.querySelectorAll("[data-opal42-highlight]")).toHaveLength(0);
  });

  it("answers 'missing' when the element is gone", () => {
    expect(run(highlightExpression("#nope"))).toBe("missing");
  });

  it("answers 'error' instead of throwing for an invalid selector", () => {
    expect(run(highlightExpression("###"))).toBe("error");
  });

  it("treats the selector as data: a selector that looks like code does not run", () => {
    const g = globalThis as unknown as { __pwned?: boolean };
    g.__pwned = false;
    const evil = `"); (globalThis.__pwned = true); ("`;
    run(highlightExpression(evil));
    run(highlightExpression(`a\u2028b'); globalThis.__pwned = true; ('`));
    expect(g.__pwned).toBe(false);
    delete g.__pwned;
  });

  it("returns null for an empty or oversized selector", () => {
    expect(highlightExpression("")).toBeNull();
    expect(highlightExpression("a".repeat(801))).toBeNull();
    expect(inspectExpression("")).toBeNull();
    expect(inspectExpression("a".repeat(801))).toBeNull();
  });

  it("clamps the duration", () => {
    expect(highlightExpression("#t", 1)).toContain(", 200)");
    expect(highlightExpression("#t", 10 ** 9)).toContain(", 10000)");
  });
});

describe("inspectExpression", () => {
  it("calls the DevTools inspect() command with the element", () => {
    document.body.innerHTML = `<div id="t"></div>`;
    const inspect = vi.fn();
    (globalThis as unknown as { inspect: unknown }).inspect = inspect;
    expect(run(inspectExpression("#t"))).toBe("ok");
    expect(inspect).toHaveBeenCalledWith(document.getElementById("t"));
    delete (globalThis as unknown as { inspect?: unknown }).inspect;
  });

  it("answers 'missing' and 'error'", () => {
    expect(run(inspectExpression("#nope"))).toBe("missing");
    document.body.innerHTML = `<div id="t"></div>`;
    expect(run(inspectExpression("#t"))).toBe("error"); // no inspect() outside DevTools
  });
});
