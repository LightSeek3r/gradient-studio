// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCss, isSafeGradient, MAX_INPUT_LENGTH } from "../src/analyze";
import { PREVIEW_CSS, SCORE_CSS } from "../src/styles";
import { SMOOTH, mount, mountPreview, qa, shadow, text } from "./helpers";

afterEach(() => document.body.replaceChildren());

const HOSTILE: [string, string][] = [
  ["style breakout", `linear-gradient(90deg, #ff0000, #0000ff)</style><script>window.__pwn=1</script>`],
  ["url javascript", "linear-gradient(90deg, url(javascript:window.__pwn=1), #0000ff)"],
  ["url data html", "linear-gradient(90deg, url('data:text/html,<script>window.__pwn=1</script>'), #0000ff)"],
  ["import", `@import url(https://evil.example/x.css); ${SMOOTH}`],
  ["expression", "linear-gradient(90deg, expression(window.__pwn=1), #0000ff)"],
  ["html in stops", "linear-gradient(90deg, <img src=x onerror=window.__pwn=1>, #0000ff)"],
  ["quote break", `linear-gradient(90deg, #ff0000" onmouseover="window.__pwn=1, #0000ff)`],
  ["attribute break", `linear-gradient(90deg, "><svg onload=window.__pwn=1>, #0000ff)`],
  ["backslash escapes", "linear-gradient(90deg, \\75rl(x), #0000ff)"],
  ["null bytes", "linear-gradient(90deg, #ff\u0000zz00, #0000ff)"],
  ["closing paren soup", ")))))))))linear-gradient(((((("],
  ["semicolon injection", "linear-gradient(90deg, #ff0000, #0000ff); background: url(//evil.example/x)"],
  ["unicode", "linear-gradient(90deg, ‮#ff0000, #0000ff​) \u{1F308} ́́́"],
  ["rtl and surrogates", "linear-gradient(90deg, \ud800, \udfff)"],
  ["huge number", `linear-gradient(${"9".repeat(500)}deg, #ff0000, #0000ff)`],
  ["many stops", `linear-gradient(90deg, ${Array.from({ length: 500 }, (_, i) => `#${(i * 4099).toString(16).padStart(6, "0").slice(-6)}`).join(", ")})`],
  ["comment bomb", `/*${"*/ /*".repeat(3000)}*/ ${SMOOTH}`],
  ["custom property", "linear-gradient(90deg, var(--x, url(javascript:1)), #0000ff)"],
  ["calc", "linear-gradient(calc(1deg * 9999999999999), #ff0000, #0000ff)"],
  ["env", "linear-gradient(90deg, env(x), #0000ff)"],
];

describe("hostile input never injects or throws", () => {
  for (const [name, css] of HOSTILE) {
    it(`score element: ${name}`, () => {
      const w = window as unknown as { __pwn?: number };
      const el = mount({ css });
      expect(w.__pwn).toBeUndefined();
      expect(shadow(el).querySelectorAll("script, iframe, object, embed, link, img, svg, form, input, a, base, meta").length).toBe(0);
      expect(shadow(el).querySelectorAll("style").length).toBeLessThanOrEqual(1);
      expect(document.querySelectorAll("script").length).toBe(0);
      expect(el.querySelectorAll("*").length).toBe(0);
      for (const n of qa(el, "*")) {
        for (const a of n.getAttributeNames()) expect(a.startsWith("on"), `${n.tagName} ${a}`).toBe(false);
      }
    });
    it(`preview element: ${name}`, () => {
      const el = mountPreview({ css });
      expect(shadow(el).querySelectorAll("script, iframe, img, svg, a").length).toBe(0);
      expect(document.querySelectorAll("script").length).toBe(0);
    });
    it(`as child text: ${name}`, () => {
      const el = mount({}, css);
      expect(shadow(el).querySelectorAll("script").length).toBe(0);
      expect(["ok", "skipped", "invalid", "empty"]).toContain(el.result.status);
    });
    it(`analysis only yields allow-listed swatches: ${name}`, () => {
      const r = analyzeCss(css, { withFix: true });
      for (const s of r.swatch) expect(isSafeGradient(s)).toBe(true);
      if (r.css) expect(isSafeGradient(r.css)).toBe(true);
      if (r.fix) expect(isSafeGradient(r.fix.css)).toBe(true);
    });
  }

  it("input is only ever rendered as text inside a fixed set of elements", () => {
    const allowed = new Set(["DIV", "SPAN", "STRONG", "P", "UL", "LI", "CODE", "DETAILS", "SUMMARY", "SECTION", "STYLE"]);
    for (const [, css] of HOSTILE) {
      const el = mount({ css, "show-fix": "" });
      for (const n of qa(el, "*")) expect(allowed.has(n.tagName), n.tagName).toBe(true);
      expect(el.innerHTML).toBe("");
    }
  });
  it("only hex colours and numbers reach inline styles", () => {
    const el = mount({ css: `${SMOOTH}`, "show-fix": "" });
    for (const n of qa(el, "[style]")) {
      const style = n.getAttribute("style") ?? "";
      expect(style).toMatch(/^(background-image|width): /);
      expect(style).not.toMatch(/url\(|expression|javascript|;\s*[a-z-]+:\s*[^;]*(url|import)/i);
    }
  });
  it("a style value that fails the allow-list is dropped, not applied", () => {
    expect(isSafeGradient("linear-gradient(90deg, #ffffff, #000000); color: red")).toBe(false);
    expect(isSafeGradient("linear-gradient(1e999deg, #ffffff, #000000)")).toBe(false);
  });
  it("the swatch text of the issue list is escaped text, not markup", () => {
    const el = mount({ css: "linear-gradient(90deg, #ff0000, #0000ff)", messages: JSON.stringify({ "score.name": "<img src=x onerror=1>" }) });
    expect(shadow(el).querySelector("img")).toBeNull();
    expect(text(el)).toContain("<img src=x onerror=1>");
  });
  it("hostile label and message overrides stay text", () => {
    const el = mount({ css: SMOOTH, label: `"><script>1</script>` });
    expect(shadow(el).querySelector("script")).toBeNull();
    expect(shadow(el).querySelector(".card")?.getAttribute("aria-label")).toContain("<script>");
  });
  it("a __proto__ messages property does not change prototypes", () => {
    const el = mount({ css: SMOOTH });
    el.messages = JSON.parse('{"__proto__":"x","constructor":"y"}');
    el.flush();
    expect(({} as Record<string, unknown>).constructor).toBe(Object);
  });
});

describe("size cap and resource bounds", () => {
  it("a 1 MB input is cut to 20 KB with a visible notice and does not throw", () => {
    const big = `${SMOOTH}${"x".repeat(1_000_000)}`;
    const t0 = performance.now();
    const el = mount({ css: big });
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(el.result.truncated).toBe(true);
    expect(el.result.status).toBe("ok");
    expect(text(el)).toContain("20 KB");
  });
  it("a 5 MB text child is handled the same way", () => {
    const el = mount({}, `${SMOOTH}${" ".repeat(5_000_000)}`);
    expect(el.result.truncated).toBe(true);
  });
  it("a nested parenthesis bomb is skipped quickly", () => {
    const bomb = `linear-gradient(${"(".repeat(MAX_INPUT_LENGTH)}`;
    const t0 = performance.now();
    const r = analyzeCss(bomb);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.status).toBe("skipped");
  });
  it("deep nesting inside a closed gradient is skipped", () => {
    const deep = `linear-gradient(90deg, ${"calc(".repeat(200)}1${")".repeat(200)}, #0000ff)`;
    const r = analyzeCss(deep);
    expect(r.status).toBe("skipped");
    expect(r.swatch).toEqual([]);
  });
  it("thousands of gradients in one input stay bounded", () => {
    const many = Array.from({ length: 600 }, () => SMOOTH).join(" ");
    const t0 = performance.now();
    const r = analyzeCss(many.slice(0, MAX_INPUT_LENGTH * 2));
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.gradients).toBeGreaterThan(1);
    expect(r.truncated).toBe(true);
  });
  it("rapid mutation bursts coalesce", () => {
    vi.useFakeTimers();
    const el = mount({ css: SMOOTH });
    el.removeAttribute("debounce");
    const spy = vi.spyOn(el, "flush");
    for (let i = 0; i < 200; i++) el.setAttribute("css", `${SMOOTH} /* ${i} */`);
    vi.advanceTimersByTime(100);
    expect(spy.mock.calls.length).toBe(1);
    vi.useRealTimers();
  });
  it("never throws for any of the hostile inputs through the property API", () => {
    const el = mount();
    for (const [, css] of HOSTILE) {
      expect(() => {
        el.css = css;
        el.flush();
        el.refine();
      }).not.toThrow();
    }
  });
  it("never throws for non-string property values", () => {
    const el = mount();
    for (const v of [42, {}, [], true, Symbol.iterator.description]) {
      expect(() => {
        el.css = v as unknown as string;
        el.flush();
      }).not.toThrow();
    }
  });
});

describe("privacy: zero network", () => {
  it("the element source contains no network or storage API", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(import.meta.dirname, "../src");
    const banned = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.clipboard|importScripts|innerHTML|insertAdjacentHTML|outerHTML|eval|new Function|document\.write)\b|@import|url\(/;
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, f).not.toMatch(banned);
    }
  });
  it("rendering and refining make no requests", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const open = vi.spyOn(XMLHttpRequest.prototype, "open");
    const el = mount({ css: "linear-gradient(90deg,#ff0000,#0000ff)", "show-fix": "" });
    el.refine();
    expect(f).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("the stylesheets load nothing", () => {
    for (const css of [SCORE_CSS, PREVIEW_CSS]) {
      expect(css).not.toMatch(/url\(|@import|@font-face/);
    }
  });
});

describe("stylesheet contract", () => {
  it("is theme, forced-colors and reduced-motion aware", () => {
    expect(SCORE_CSS).toContain("prefers-color-scheme: dark");
    expect(SCORE_CSS).toContain("forced-colors: active");
    expect(SCORE_CSS).toContain("prefers-reduced-motion: no-preference");
    expect(PREVIEW_CSS).toContain("prefers-color-scheme: dark");
  });
  it("exposes the four documented custom properties", () => {
    for (const v of ["--opal42-bg", "--opal42-fg", "--opal42-accent", "--opal42-radius"]) expect(SCORE_CSS).toContain(v);
  });
  it("only animates inside the reduced-motion guard", () => {
    const outside = SCORE_CSS.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*\{[^}]*\}\s*\}/, "");
    expect(outside).not.toMatch(/transition|animation/);
  });
});
