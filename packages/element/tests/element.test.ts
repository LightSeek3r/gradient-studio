// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineElements, Opal42GradientPreviewElement, Opal42GradientScoreElement } from "../src/index";
import { ALPHA, RADIAL, ROUGH, SMOOTH, mount, mountPreview, q, qa, shadow, text, tick } from "./helpers";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("rendering states", () => {
  it("renders a scorable gradient with swatch, score and findings", () => {
    const el = mount({ css: ROUGH });
    expect(q(el, ".score-value strong")?.textContent).toBe(String(el.result.score));
    expect(q(el, ".swatch")).not.toBeNull();
    expect(qa(el, ".issue").length).toBe(el.result.findings.length);
    expect(text(el)).toContain("Smoothness score");
  });
  it("shows plain-language names and sentences, not only codes", () => {
    const el = mount({ css: ROUGH });
    for (const li of qa(el, ".issue")) {
      expect(li.querySelector(".issue-name")?.textContent).toBeTruthy();
      expect(li.querySelector(".issue-text")?.textContent?.length).toBeGreaterThan(20);
      expect(li.querySelector(".issue-code")?.textContent).toBe(li.dataset.code);
    }
  });
  it("labels severities with neutral words", () => {
    const el = mount({ css: ROUGH });
    const badges = qa(el, ".badge").map((b) => b.textContent);
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b).toMatch(/deduction$/);
  });
  it("shows the score bar width as the score", () => {
    const el = mount({ css: SMOOTH });
    expect(q(el, ".fill")?.style.width).toBe(`${el.result.score}%`);
  });
  it("renders a skipped gradient with its reason and no score", () => {
    const el = mount({ css: RADIAL });
    expect(q(el, ".skipped")).not.toBeNull();
    expect(text(el)).toContain("unsupported-kind");
    expect(q(el, ".score-value strong")).toBeNull();
    expect(q(el, ".score-value .none")?.textContent).toBe("Not scored");
    expect(q(el, "details")).toBeNull();
  });
  it("still paints a translucent gradient that is not scored", () => {
    const el = mount({ css: ALPHA });
    expect(q(el, ".skipped")).not.toBeNull();
    expect(q(el, ".swatch")).not.toBeNull();
  });
  it("renders the empty state", () => {
    const el = mount();
    expect(q(el, ".empty")?.textContent).toBe("No gradient to score.");
    expect(q(el, ".swatch")).toBeNull();
    expect(el.result.status).toBe("empty");
  });
  it("renders the invalid state for text without a gradient", () => {
    const el = mount({ css: "just words" });
    expect(q(el, ".empty")?.textContent).toContain("No linear-gradient()");
    expect(el.result.status).toBe("invalid");
  });
  it("renders the invalid state for an index out of range", () => {
    const el = mount({ css: SMOOTH, index: "4" });
    expect(q(el, ".empty")?.textContent).toContain("no gradient number 4");
  });
  it("notes when several gradients were found and shows the first scorable", () => {
    const el = mount({ css: `${RADIAL} ${SMOOTH} ${ROUGH}` });
    expect(el.result.index).toBe(1);
    expect(text(el)).toContain("Showing gradient 2 of 3");
  });
  it("picks a gradient with the index attribute", () => {
    const el = mount({ css: `${SMOOTH} ${ROUGH}`, index: "1" });
    expect(el.result.index).toBe(1);
    expect(el.result.score).not.toBe(mount({ css: SMOOTH }).result.score);
  });
  it("says so when there are no findings", () => {
    const el = mount({ css: "linear-gradient(90deg, #ffffff, #000000)" });
    if (el.result.findings.length === 0) expect(text(el)).toContain("No findings");
    expect(el.result.status).toBe("ok");
  });
  it("shows a visible notice when the input was cut at 20 KB", () => {
    const el = mount({ css: `${SMOOTH}${" ".repeat(21_000)}` });
    expect(q(el, ".notice")?.textContent).toContain("20 KB");
    expect(el.result.truncated).toBe(true);
  });
});

describe("options", () => {
  it("hides the findings with show-issues=false", () => {
    const el = mount({ css: ROUGH, "show-issues": "false" });
    expect(q(el, "details")).toBeNull();
    expect(el.showIssues).toBe(false);
  });
  it("shows the findings by default and for a bare show-issues", () => {
    expect(mount({ css: ROUGH }).showIssues).toBe(true);
    expect(mount({ css: ROUGH, "show-issues": "" }).showIssues).toBe(true);
    expect(q(mount({ css: ROUGH, "show-issues": "" }), "details")).not.toBeNull();
  });
  it("treats 0, off and no as false", () => {
    for (const v of ["0", "off", "no", "FALSE"]) expect(mount({ "show-issues": v }).showIssues).toBe(false);
  });
  it("hides the suggested fix by default", () => {
    const el = mount({ css: "linear-gradient(90deg,#ff0000,#0000ff)" });
    expect(q(el, ".fix")).toBeNull();
    expect(el.result.fix).toBeNull();
  });
  it("shows a suggested fix with a preview swatch and gain", () => {
    const el = mount({ css: "linear-gradient(90deg,#ff0000,#0000ff)", "show-fix": "" });
    expect(q(el, ".fix-title")?.textContent).toBe("Suggested fix");
    expect(q(el, ".fix-gain")?.textContent).toMatch(/^\+\d+ points \(\d+ to \d+\)$/);
    expect(q(el, ".fix .swatch")).not.toBeNull();
    expect(q(el, ".fix-css")?.textContent).toMatch(/^linear-gradient\(/);
    expect(text(el)).toContain("Nothing is changed");
  });
  it("does not change the shown gradient when a fix is previewed", () => {
    const el = mount({ css: "linear-gradient(90deg,#ff0000,#0000ff)", "show-fix": "" });
    expect(el.result.css).toBe("linear-gradient(90deg, #ff0000, #0000ff)");
    expect(el.getAttribute("css")).toBe("linear-gradient(90deg,#ff0000,#0000ff)");
  });
  it("compact drops the sentences and the code", () => {
    const el = mount({ css: ROUGH, compact: "" });
    expect(q(el, ".card")?.classList.contains("compact")).toBe(true);
    expect(qa(el, ".issue").length).toBeGreaterThan(0);
    expect(q(el, ".issue-text")).toBeNull();
    expect(q(el, "details")?.hasAttribute("open")).toBe(false);
  });
  it("opens the findings by default when not compact", () => {
    expect(q(mount({ css: ROUGH }), "details")?.hasAttribute("open")).toBe(true);
  });
  it("uses the label attribute in the group name", () => {
    const el = mount({ css: SMOOTH, label: "Hero" });
    expect(q(el, ".card")?.getAttribute("aria-label")).toBe(`Hero: smoothness score ${el.result.score} out of 100`);
  });
  it("applies message overrides from the property", () => {
    const el = mount({ css: ROUGH });
    el.messages = { "score.name": "Indice de douceur", "severity.warning": "déduction moyenne" };
    el.flush();
    expect(q(el, ".score-label")?.textContent).toBe("Indice de douceur");
  });
  it("applies message overrides from the attribute", () => {
    const el = mount({ css: ROUGH, messages: '{"score.name":"Wert"}' });
    expect(q(el, ".score-label")?.textContent).toBe("Wert");
  });
  it("lets a host rewrite a rule sentence", () => {
    const el = mount({ css: ROUGH });
    const code = el.result.findings[0].code;
    el.messages = { [`rule.${code}.measures`]: "custom sentence" };
    el.flush();
    expect(text(el)).toContain("custom sentence");
  });
  it("ignores a broken messages attribute", () => {
    expect(q(mount({ css: SMOOTH, messages: "{nope" }), ".score-label")?.textContent).toBe("Smoothness score");
  });
});

describe("source text", () => {
  it("reads child text content", () => {
    const el = mount({}, SMOOTH);
    expect(el.result.status).toBe("ok");
    expect(el.css).toBe(SMOOTH);
  });
  it("reads a <script type=text/plain> child", () => {
    const el = mount();
    const s = document.createElement("script");
    s.type = "text/plain";
    s.textContent = ROUGH;
    el.append(s);
    el.flush();
    expect(el.result.status).toBe("ok");
    expect(q(el, ".score-value strong")?.textContent).toBe(String(el.result.score));
  });
  it("the css attribute wins over child text", () => {
    const el = mount({ css: ROUGH }, SMOOTH);
    expect(el.result.score).toBe(mount({ css: ROUGH }).result.score);
  });
  it("the css property reflects to the attribute", () => {
    const el = mount();
    el.css = SMOOTH;
    expect(el.getAttribute("css")).toBe(SMOOTH);
    el.css = null;
    expect(el.hasAttribute("css")).toBe(false);
  });
  it("index and flags are properties", () => {
    const el = mount({ css: `${SMOOTH} ${ROUGH}` });
    el.index = 1;
    expect(el.getAttribute("index")).toBe("1");
    expect(el.index).toBe(1);
    el.index = null;
    expect(el.hasAttribute("index")).toBe(false);
    el.compact = true;
    expect(el.hasAttribute("compact")).toBe(true);
    el.compact = false;
    expect(el.hasAttribute("compact")).toBe(false);
    el.showFix = true;
    expect(el.showFix).toBe(true);
    el.showIssues = false;
    expect(el.getAttribute("show-issues")).toBe("false");
  });
  it("a non-numeric index is invalid, not a crash", () => {
    const el = mount({ css: SMOOTH, index: "abc" });
    expect(el.result.status).toBe("invalid");
  });
  it("result is frozen and a snapshot", () => {
    const el = mount({ css: SMOOTH });
    expect(Object.isFrozen(el.result)).toBe(true);
    expect(() => {
      (el.result as { score: number }).score = 1;
    }).toThrow();
  });
  it("refine() returns refined CSS and leaves the element alone", () => {
    const el = mount({ css: ROUGH });
    const before = el.getAttribute("css");
    const out = el.refine();
    expect(out).toMatch(/^linear-gradient\(/);
    expect(el.getAttribute("css")).toBe(before);
  });
  it("refine() is null when nothing is scorable", () => {
    expect(mount({ css: RADIAL }).refine()).toBeNull();
    expect(mount().refine()).toBeNull();
  });
});

describe("updates", () => {
  it("re-renders when the css attribute changes", () => {
    const el = mount({ css: SMOOTH });
    const first = q(el, ".score-value strong")?.textContent;
    el.setAttribute("css", ROUGH);
    expect(q(el, ".score-value strong")?.textContent).not.toBe(first);
  });
  it("re-renders on index, compact and show-issues changes", () => {
    const el = mount({ css: `${SMOOTH} ${ROUGH}` });
    el.setAttribute("index", "1");
    expect(el.result.index).toBe(1);
    el.setAttribute("compact", "");
    expect(q(el, ".card")?.classList.contains("compact")).toBe(true);
    el.setAttribute("show-issues", "false");
    expect(q(el, "details")).toBeNull();
  });
  it("re-renders when the child text changes (MutationObserver)", async () => {
    const el = mount({}, SMOOTH);
    const first = el.result.score;
    el.textContent = ROUGH;
    await tick();
    expect(el.result.score).not.toBe(first);
    expect(q(el, ".score-value strong")?.textContent).toBe(String(el.result.score));
  });
  it("re-renders when a text node is edited in place", async () => {
    const el = mount({}, SMOOTH);
    (el.firstChild as Text).data = ROUGH;
    await tick();
    expect(el.result.status).toBe("ok");
    expect(el.result.findings.length).toBeGreaterThan(0);
  });
  it("debounces bursts of changes into one render", () => {
    vi.useFakeTimers();
    const el = document.createElement("opal42-gradient-score") as Opal42GradientScoreElement;
    defineElements();
    document.body.append(el);
    const spy = vi.spyOn(el, "flush");
    for (let i = 0; i < 5; i++) el.setAttribute("css", i % 2 ? SMOOTH : ROUGH);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("debounce=0 renders immediately", () => {
    const el = mount({ css: SMOOTH });
    const spy = vi.spyOn(el, "flush");
    el.setAttribute("css", ROUGH);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("stops observing and rendering once removed", async () => {
    const el = mount({}, SMOOTH);
    el.remove();
    const spy = vi.spyOn(el, "flush");
    el.textContent = ROUGH;
    await tick();
    expect(spy).not.toHaveBeenCalled();
  });
  it("renders again after being reconnected", async () => {
    const el = mount({}, SMOOTH);
    el.remove();
    el.textContent = ROUGH;
    document.body.append(el);
    expect(q(el, ".score-value strong")?.textContent).toBe(String(el.result.score));
    el.textContent = SMOOTH;
    await tick();
    expect(q(el, ".score-value strong")?.textContent).toBe(String(el.result.score));
  });
  it("a pending debounce is cancelled on removal", () => {
    vi.useFakeTimers();
    defineElements();
    const el = document.createElement("opal42-gradient-score") as Opal42GradientScoreElement;
    document.body.append(el);
    const spy = vi.spyOn(el, "flush");
    el.setAttribute("css", SMOOTH);
    el.remove();
    vi.advanceTimersByTime(500);
    expect(spy).not.toHaveBeenCalled();
  });
  it("keeps the user's open/closed choice of the findings across updates", () => {
    const el = mount({ css: ROUGH });
    const d = q(el, "details") as HTMLDetailsElement;
    d.open = false;
    d.dispatchEvent(new Event("toggle"));
    el.setAttribute("css", `${ROUGH} `);
    expect((q(el, "details") as HTMLDetailsElement).open).toBe(false);
  });
  it("keeps keyboard focus on the summary across updates", () => {
    const el = mount({ css: ROUGH });
    (q(el, "summary") as HTMLElement).focus();
    expect(shadow(el).activeElement?.tagName).toBe("SUMMARY");
    el.setAttribute("css", `${ROUGH} `);
    expect(shadow(el).activeElement?.tagName).toBe("SUMMARY");
  });
});

describe("events", () => {
  it("emits opal42-score with score, status and findings, composed", async () => {
    defineElements();
    const el = document.createElement("opal42-gradient-score");
    el.setAttribute("debounce", "0");
    el.setAttribute("css", ROUGH);
    const seen: CustomEvent[] = [];
    document.addEventListener("opal42-score", (e) => seen.push(e as CustomEvent), { once: true });
    document.body.append(el);
    await tick();
    expect(seen).toHaveLength(1);
    expect(seen[0].composed).toBe(true);
    expect(seen[0].bubbles).toBe(true);
    const d = seen[0].detail;
    expect(d.status).toBe("ok");
    expect(d.score).toBe((el as Opal42GradientScoreElement).result.score);
    expect(Array.isArray(d.findings)).toBe(true);
    expect(d.findings[0]).toHaveProperty("code");
  });
  it("a listener added right after creation still hears the first event", async () => {
    defineElements();
    const el = document.createElement("opal42-gradient-score");
    el.setAttribute("css", SMOOTH);
    document.body.append(el);
    const fn = vi.fn();
    el.addEventListener("opal42-score", fn);
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("emits again only when the result changes", async () => {
    const el = mount({ css: SMOOTH });
    const fn = vi.fn();
    el.addEventListener("opal42-score", fn);
    await tick();
    fn.mockClear();
    el.setAttribute("css", ` ${SMOOTH}`);
    expect(fn).not.toHaveBeenCalled();
    el.setAttribute("css", ROUGH);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].detail.score).toBe(el.result.score);
  });
  it("reports skipped and empty states with score null", async () => {
    const el = mount({ css: RADIAL });
    const seen: CustomEvent[] = [];
    el.addEventListener("opal42-score", (e) => seen.push(e as CustomEvent));
    el.setAttribute("css", "");
    await tick();
    expect(seen.at(-1)?.detail).toMatchObject({ status: "empty", score: null, findings: [] });
  });
  it("event findings are copies", async () => {
    const el = mount({ css: ROUGH });
    let detail: { findings: { code: string }[] } | undefined;
    el.addEventListener("opal42-score", (e) => (detail = (e as CustomEvent).detail));
    el.setAttribute("css", SMOOTH);
    detail?.findings.push({ code: "x" });
    expect(el.result.findings.some((f) => f.code === "x")).toBe(false);
  });
  it("emits opal42-error for text without a gradient", async () => {
    defineElements();
    const el = document.createElement("opal42-gradient-score");
    el.setAttribute("css", "nothing here");
    const fn = vi.fn();
    el.addEventListener("opal42-error", fn);
    document.body.append(el);
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].detail).toMatchObject({ code: "no-gradient" });
    expect(fn.mock.calls[0][0].composed).toBe(true);
  });
  it("emits opal42-error for an index out of range and for oversized input", async () => {
    defineElements();
    const el = document.createElement("opal42-gradient-score");
    el.setAttribute("debounce", "0");
    el.setAttribute("css", SMOOTH);
    el.setAttribute("index", "9");
    const codes: string[] = [];
    el.addEventListener("opal42-error", (e) => codes.push((e as CustomEvent).detail.code));
    document.body.append(el);
    await tick();
    el.setAttribute("index", "0");
    el.setAttribute("css", `${SMOOTH}${" ".repeat(25_000)}`);
    await tick();
    expect(codes).toEqual(["index-out-of-range", "too-large"]);
  });
  it("no error event for empty input or skipped gradients", async () => {
    defineElements();
    const fn = vi.fn();
    for (const css of ["", RADIAL]) {
      const el = document.createElement("opal42-gradient-score");
      el.setAttribute("css", css);
      el.addEventListener("opal42-error", fn);
      document.body.append(el);
    }
    await tick();
    expect(fn).not.toHaveBeenCalled();
  });
  it("does not repeat an identical error", async () => {
    const el = mount({ css: "nothing" });
    const fn = vi.fn();
    el.addEventListener("opal42-error", fn);
    await tick();
    el.setAttribute("css", "still nothing");
    await tick();
    expect(fn.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("live region and names", () => {
  it("has role=group with an aria-label and a polite status region", () => {
    const el = mount({ css: SMOOTH });
    const g = q(el, "[role=group]");
    expect(g?.getAttribute("aria-label")).toMatch(/smoothness score \d+ out of 100/);
    const live = q(el, "[role=status]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.getAttribute("aria-atomic")).toBe("true");
    expect(live?.textContent).toContain(`Smoothness score ${el.result.score} out of 100`);
  });
  it("announces a changed score in the same live region node", () => {
    const el = mount({ css: SMOOTH });
    const live = q(el, "[role=status]");
    const first = live?.textContent;
    el.setAttribute("css", ROUGH);
    expect(q(el, "[role=status]")).toBe(live);
    expect(live?.textContent).not.toBe(first);
    expect(live?.textContent).toContain(String(el.result.score));
  });
  it("announces counts with the right plural", () => {
    const el = mount({ css: ROUGH });
    expect(q(el, "[role=status]")?.textContent).toMatch(/\d+ findings?\./);
  });
  it("names the group for every state", () => {
    expect(q(mount(), "[role=group]")?.getAttribute("aria-label")).toBe("Gradient: no gradient");
    expect(q(mount({ css: RADIAL }), "[role=group]")?.getAttribute("aria-label")).toBe("Gradient: found, not scored");
    expect(q(mount({ css: "zzz" }), "[role=group]")?.getAttribute("aria-label")).toBe("Gradient: no gradient found");
  });
  it("the swatch is an image with colours in its name", () => {
    const el = mount({ css: "linear-gradient(90deg,#ff0000,#0000ff)" });
    expect(q(el, ".swatch")?.getAttribute("role")).toBe("img");
    expect(q(el, ".swatch")?.getAttribute("aria-label")).toBe("Gradient swatch from #ff0000 to #0000ff, 2 colour stops");
  });
  it("the findings summary is a native focusable control", () => {
    const el = mount({ css: ROUGH });
    expect(q(el, "details > summary")).not.toBeNull();
  });
});

describe("define", () => {
  it("defines both default tags", () => {
    defineElements();
    expect(customElements.get("opal42-gradient-score")).toBe(Opal42GradientScoreElement);
    expect(customElements.get("opal42-gradient-preview")).toBe(Opal42GradientPreviewElement);
  });
  it("is idempotent", () => {
    const a = defineElements();
    const b = defineElements();
    expect(b).toEqual(a);
    expect(customElements.get("opal42-gradient-score")).toBe(Opal42GradientScoreElement);
  });
  it("reports the tags and that it defined them", () => {
    expect(defineElements()).toEqual({ scoreTag: "opal42-gradient-score", previewTag: "opal42-gradient-preview", defined: true });
  });
  it("supports a tag-name override, repeatedly", () => {
    const r = defineElements({ scoreTag: "x-smooth", previewTag: "x-swatch" });
    expect(r.scoreTag).toBe("x-smooth");
    const again = defineElements({ scoreTag: "x-smooth", previewTag: "x-swatch" });
    expect(again.defined).toBe(true);
    const el = document.createElement("x-smooth") as Opal42GradientScoreElement;
    el.setAttribute("css", SMOOTH);
    el.setAttribute("debounce", "0");
    document.body.append(el);
    expect(el).toBeInstanceOf(Opal42GradientScoreElement);
    expect(q(el, ".score-value strong")?.textContent).toBe(String(el.result.score));
  });
  it("throws a clear error when the tag belongs to something else", () => {
    customElements.define("x-taken", class extends HTMLElement {});
    expect(() => defineElements({ scoreTag: "x-taken" })).toThrow(/already defined/);
  });
  it("the auto-defining entry registers the default tags", async () => {
    await import("../src/define");
    expect(customElements.get("opal42-gradient-score")).toBeDefined();
  });
  it("upgrades elements that were in the page before the define", () => {
    const el = document.createElement("x-late");
    el.setAttribute("css", SMOOTH);
    el.setAttribute("debounce", "0");
    document.body.append(el);
    expect(el.shadowRoot).toBeNull();
    defineElements({ scoreTag: "x-late", previewTag: "x-late-preview" });
    expect(el.shadowRoot).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".score-value strong")).not.toBeNull();
  });
});

describe("shadow DOM", () => {
  it("is an open shadow root", () => {
    expect(shadow(mount({ css: SMOOTH })).mode).toBe("open");
  });
  it("keeps content out of the light DOM", () => {
    const el = mount({ css: SMOOTH });
    expect(el.querySelector(".card")).toBeNull();
    expect(el.children.length).toBe(0);
  });
  it("host page CSS and selectors do not reach into the shadow tree", () => {
    const style = document.createElement("style");
    style.textContent = ".swatch, .card, strong { display: none !important; color: red; }";
    document.head.append(style);
    const el = mount({ css: SMOOTH });
    expect(document.querySelector(".card")).toBeNull();
    expect(document.querySelectorAll(".swatch").length).toBe(0);
    expect(getComputedStyle(q(el, ".card") as Element).display).not.toBe("none");
    style.remove();
  });
  it("adopts a stylesheet or falls back to one <style>, never both", () => {
    const el = mount({ css: SMOOTH });
    const styles = shadow(el).querySelectorAll("style").length;
    const adopted = (shadow(el) as ShadowRoot & { adoptedStyleSheets?: unknown[] }).adoptedStyleSheets?.length ?? 0;
    expect(styles + adopted).toBe(1);
  });
  it("two instances do not share DOM", () => {
    const a = mount({ css: SMOOTH });
    const b = mount({ css: ROUGH });
    expect(shadow(a)).not.toBe(shadow(b));
    expect(text(a)).not.toBe(text(b));
  });
});

describe("preview element", () => {
  it("renders only a swatch", () => {
    const el = mountPreview({ css: SMOOTH });
    expect(qa(el, ".swatch")).toHaveLength(1);
    expect(shadow(el).textContent).toBe("");
    expect(q(el, ".swatch")?.getAttribute("role")).toBe("img");
  });
  it("names the swatch with validated colours", () => {
    const el = mountPreview({ css: "linear-gradient(90deg,#ff0000,#0000ff)" });
    expect(q(el, ".swatch")?.getAttribute("aria-label")).toBe("Gradient preview from #ff0000 to #0000ff");
  });
  it("uses a label or aria-label attribute as the name", () => {
    expect(q(mountPreview({ css: SMOOTH, label: "Hero background" }), ".swatch")?.getAttribute("aria-label")).toBe("Hero background");
    expect(q(mountPreview({ css: SMOOTH, "aria-label": "Banner" }), ".swatch")?.getAttribute("aria-label")).toBe("Banner");
  });
  it("shows an unavailable name for unpaintable input", () => {
    expect(q(mountPreview({ css: RADIAL }), ".swatch")?.getAttribute("aria-label")).toBe("Gradient preview unavailable");
    expect(q(mountPreview(), ".swatch")?.getAttribute("aria-label")).toBe("Gradient preview unavailable");
  });
  it("re-renders on css change and keeps one swatch", () => {
    const el = mountPreview({ css: SMOOTH });
    el.setAttribute("css", "linear-gradient(0deg,#000000,#ffffff)");
    expect(qa(el, ".swatch")).toHaveLength(1);
    expect(q(el, ".swatch")?.getAttribute("aria-label")).toContain("#000000");
  });
  it("paints the skipped-but-parseable gradients too", () => {
    expect(mountPreview({ css: ALPHA }).result.swatch.length).toBeGreaterThan(0);
  });
  it("picks a gradient with index", () => {
    const el = mountPreview({ css: `${SMOOTH} linear-gradient(0deg,#123456,#abcdef)`, index: "1" });
    expect(q(el, ".swatch")?.getAttribute("aria-label")).toContain("#123456");
  });
  it("reads child text", () => {
    const el = mountPreview();
    el.textContent = SMOOTH;
    el.flush();
    expect(q(el, ".swatch")?.getAttribute("aria-label")).toContain("#1e3a8a");
  });
});
