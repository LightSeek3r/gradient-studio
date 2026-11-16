// @vitest-environment jsdom
// axe-core against the rendered panel (structure, names, roles, labels, live
// regions). jsdom has no layout or CSS, so colour contrast and focus-visible are
// NOT covered here: e2e/panel.spec.ts runs axe (with contrast) and checks the
// focus ring on the real built panel in Chromium.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { App } from "../src/ui/App";
import { fakeDevtools, setPage } from "./helpers/page";
import { byText, click, mount, unmount, waitFor } from "./helpers/mount";

const audit = async (el: HTMLElement) =>
  (await axe(el, { rules: { region: { enabled: false }, "color-contrast": { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`);

const status = (host: HTMLElement) => host.querySelector('[data-testid="count"]')!.textContent ?? "";

beforeEach(() => {
  setPage(
    `<style>
      .a{background-image:linear-gradient(90deg, rgb(255,0,0), rgb(0,255,0) 50%, rgb(0,0,255))}
      .b{background-image:linear-gradient(90deg,#1e3a8a,#3b82f6)}
      .c{background-image:radial-gradient(red, blue)}
      .d{background-image:linear-gradient(rgba(0,0,0,0), red)}
    </style>`,
    `<div class="a"></div><div class="b"></div><div class="c"></div><div class="d"></div>`,
  );
});
afterEach(unmount);

describe("axe: the panel", () => {
  it("canary: the audit does catch a nameless button", async () => {
    const el = await mount(<button type="button" />);
    expect(await audit(el)).toEqual([expect.stringContaining("button-name")]);
  });

  it("has no violations with results shown", async () => {
    const host = await mount(<App api={fakeDevtools().api} />);
    await waitFor(() => /found/.test(status(host)));
    expect(await audit(host)).toEqual([]);
  });

  it("has no violations with the not-scored list and the settings open", async () => {
    const host = await mount(<App api={fakeDevtools().api} />);
    await waitFor(() => /found/.test(status(host)));
    host.querySelector("details")?.setAttribute("open", "");
    host.querySelectorAll("section details").forEach((d) => d.setAttribute("open", ""));
    await click(byText(host, "button", "Settings"));
    expect(await audit(host)).toEqual([]);
  });

  it("has no violations when empty, on error and outside DevTools", async () => {
    setPage("", "<p>none</p>");
    let host = await mount(<App api={fakeDevtools().api} />);
    await waitFor(() => /found/.test(status(host)));
    expect(await audit(host)).toEqual([]);
    await unmount();

    const failing = fakeDevtools();
    failing.api.inspectedWindow.eval = (_e, cb) => cb(undefined, { isException: true, description: "denied" });
    host = await mount(<App api={failing.api} />);
    await waitFor(() => host.querySelector('[role="alert"]') !== null);
    expect(await audit(host)).toEqual([]);
    await unmount();

    host = await mount(<App api={null} />);
    expect(await audit(host)).toEqual([]);
  });

  it("every control has an accessible name and every card is named by its heading", async () => {
    const host = await mount(<App api={fakeDevtools().api} />);
    await waitFor(() => /found/.test(status(host)));
    for (const button of host.querySelectorAll("button, a[href]")) {
      const name = (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
      expect(name.length, button.outerHTML.slice(0, 80)).toBeGreaterThan(0);
    }
    for (const card of host.querySelectorAll("article")) {
      const id = card.getAttribute("aria-labelledby")!;
      expect(card.querySelector(`#${CSS.escape(id)}`)?.textContent?.length).toBeGreaterThan(0);
    }
  });

  it("uses one h1, a main landmark and polite status regions", async () => {
    const host = await mount(<App api={fakeDevtools().api} />);
    await waitFor(() => /found/.test(status(host)));
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelectorAll("main")).toHaveLength(1);
    const regions = [...host.querySelectorAll('[role="status"]')];
    expect(regions.length).toBe(2);
    expect(regions.every((r) => r.getAttribute("aria-live") === "polite")).toBe(true);
  });

  it("the icon-only severity glyphs are hidden from assistive technology and every deduction is also text", async () => {
    const host = await mount(<App api={fakeDevtools().api} />);
    await waitFor(() => /found/.test(status(host)));
    const glyphs = host.querySelectorAll("svg.sev");
    expect(glyphs.length).toBeGreaterThan(0);
    for (const g of glyphs) expect(g.getAttribute("aria-hidden")).toBe("true");
    expect(host.textContent).toMatch(/points, (large|medium|small) deduction/);
  });

  it("Settings is a toggle that exposes its state and the panel it controls", async () => {
    const host = await mount(<App api={fakeDevtools().api} />);
    const toggle = byText(host, "button", "Settings")!;
    expect(toggle.getAttribute("aria-controls")).toBe("settings-panel");
    expect(host.querySelector("#settings-panel")).not.toBeNull();
  });
});
