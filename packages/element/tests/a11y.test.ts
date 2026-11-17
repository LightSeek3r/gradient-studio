// @vitest-environment jsdom
// axe structure/name/role checks. jsdom has no layout or CSS, so colour
// contrast, forced colours and focus visibility are NOT covered here: they are
// checked in a real browser by `npm run browser` (docs/element.md).
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { ALPHA, RADIAL, ROUGH, SMOOTH, mount, mountPreview } from "./helpers";

afterEach(() => document.body.replaceChildren());

/** Fragments are not pages (no landmark rule); jsdom has no CSS (no contrast rule). */
const audit = async (el: HTMLElement) =>
  (await axe(el, { rules: { region: { enabled: false }, "color-contrast": { enabled: false } } })).violations.map((v) => `${v.id}: ${v.help}`);

describe("axe: score element", () => {
  it("canary: axe does see inside the shadow root", async () => {
    const el = mount({ css: SMOOTH });
    const bad = document.createElement("button");
    el.shadowRoot!.append(bad);
    expect((await audit(el)).join()).toContain("button-name");
  });
  const cases: [string, Record<string, string>][] = [
    ["scorable", { css: SMOOTH }],
    ["findings open", { css: ROUGH }],
    ["compact", { css: ROUGH, compact: "" }],
    ["issues off", { css: ROUGH, "show-issues": "false" }],
    ["with fix", { css: "linear-gradient(90deg,#ff0000,#0000ff)", "show-fix": "" }],
    ["skipped (radial)", { css: RADIAL }],
    ["skipped (alpha)", { css: ALPHA }],
    ["empty", {}],
    ["invalid", { css: "nothing" }],
    ["out of range", { css: SMOOTH, index: "3" }],
    ["truncated", { css: `${SMOOTH}${" ".repeat(25_000)}` }],
    ["several gradients", { css: `${SMOOTH} ${ROUGH}`, index: "1" }],
    ["custom label", { css: SMOOTH, label: "Hero background" }],
    ["messages override", { css: ROUGH, messages: '{"score.name":"Indice"}' }],
  ];
  for (const [name, attrs] of cases) {
    it(`0 violations: ${name}`, async () => {
      expect(await audit(mount(attrs))).toEqual([]);
    });
  }
  it("0 violations several elements on one page", async () => {
    const a = mount({ css: SMOOTH });
    mount({ css: ROUGH, "show-fix": "" });
    mountPreview({ css: SMOOTH });
    expect(await audit(a.parentElement as HTMLElement)).toEqual([]);
  });
});

describe("axe: preview element", () => {
  for (const [name, attrs] of [
    ["gradient", { css: SMOOTH }],
    ["labelled", { css: SMOOTH, label: "Banner" }],
    ["unpaintable", { css: RADIAL }],
    ["empty", {}],
  ] as [string, Record<string, string>][]) {
    it(`0 violations: ${name}`, async () => {
      expect(await audit(mountPreview(attrs))).toEqual([]);
    });
  }
});

describe("a11y structure", () => {
  it("no tabindex hacks: only native controls are focusable", () => {
    const el = mount({ css: ROUGH, "show-fix": "" });
    expect(el.shadowRoot!.querySelectorAll("[tabindex]").length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll("summary").length).toBe(1);
  });
  it("decorative score bar is hidden from assistive tech", () => {
    const el = mount({ css: SMOOTH });
    expect(el.shadowRoot!.querySelector(".bar")?.getAttribute("aria-hidden")).toBe("true");
  });
  it("only one live region", () => {
    const el = mount({ css: ROUGH });
    expect(el.shadowRoot!.querySelectorAll("[aria-live]").length).toBe(1);
  });
  it("the preview has a single named image", () => {
    const el = mountPreview({ css: SMOOTH });
    const imgs = el.shadowRoot!.querySelectorAll("[role=img]");
    expect(imgs.length).toBe(1);
    expect(imgs[0].getAttribute("aria-label")).toBeTruthy();
  });
});
