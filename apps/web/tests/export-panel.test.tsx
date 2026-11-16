// @vitest-environment jsdom
// Export tabs: pure model + component behaviour (tab switching, keyboard, copy,
// the multi-direction note) and axe structure. jsdom has no layout, so the 320px
// overflow check lives in the browser run of the built app.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { buildMultiGradientStyle, type GradientBlendMode, type GradientDirection, type GradientTick } from "@opal42/gradient";
import { EXPORT_FORMATS, type ExportKey } from "@opal42/gradient/export";
import { tEn } from "../src/i18n/translator";
import { ExportPanel } from "../src/components/ExportPanel";
import { StatusRegion } from "../src/components/StatusRegion";
import {
  EXPORT_TABS,
  baseDocument,
  buildExportViews,
  nextExportKey,
  scopeNote,
} from "../src/export/export-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ticks: GradientTick[] = [
  { id: 1, color: "#101B45", position: 0 },
  { id: 2, color: "#3f1d63", position: 50 },
  { id: 3, color: "#9333ea", position: 100 },
];
const one: GradientDirection[] = [{ id: 1, angle: 135, weight: 100, enabled: true }];
const two: GradientDirection[] = [
  { id: 1, angle: 135, weight: 100, enabled: true },
  { id: 2, angle: 315, weight: 60, enabled: true },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(props: Partial<{ ticks: GradientTick[]; directions: GradientDirection[]; blend: GradientBlendMode; showingSuggested: boolean }> = {}) {
  const t = props.ticks ?? ticks;
  const d = props.directions ?? one;
  const b = props.blend ?? "normal";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <StatusRegion />
        <ExportPanel ticks={t} directions={d} blend={b} style={buildMultiGradientStyle(t, d, b)} showingSuggested={props.showingSuggested ?? false} />
      </>,
    ),
  );
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const tab = (el: HTMLElement, key: ExportKey) => el.querySelector<HTMLButtonElement>(`#export-tab-${key}`)!;
const code = (el: HTMLElement) =>
  [...el.querySelectorAll(".export-code > div")].map((d) => (d.textContent ?? "").replace(/\u00a0/g, "")).join("\n");
const click = async (node: Element) => act(async () => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const press = async (node: Element, key: string) =>
  act(async () => node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const audit = async (el: HTMLElement) =>
  (await axe(el, { rules: { region: { enabled: false }, "color-contrast": { enabled: false } } })).violations;

describe("export model", () => {
  it("the tabs are the core formats, CSS first, with unique labels", () => {
    expect(EXPORT_TABS.map((t) => t.key)).toEqual(EXPORT_FORMATS.map((t) => t.key));
    expect(EXPORT_TABS[0].key).toBe("css");
    expect(new Set(EXPORT_TABS.map((t) => t.label)).size).toBe(EXPORT_TABS.length);
  });
  it("the base document is the sorted stops at the first enabled direction", () => {
    const doc = baseDocument([ticks[2], ticks[0]], [{ id: 1, angle: 10, weight: 5, enabled: false }, ...two]);
    expect(doc.angle).toBe(135);
    expect(doc.stops).toEqual([
      { color: "#101b45", position: 0 },
      { color: "#9333ea", position: 1 },
    ]);
  });
  it("no enabled direction falls back to 180 and the scope note says so", () => {
    const none: GradientDirection[] = [{ id: 1, angle: 40, weight: 100, enabled: false }];
    expect(baseDocument(ticks, none).angle).toBe(180);
    expect(scopeNote(none, "normal", tEn)).toMatch(/flat colour/);
  });
  it("the scope note appears only for more than one direction and names the blend", () => {
    expect(scopeNote(one, "multiply", tEn)).toBeNull();
    expect(scopeNote(two, "normal", tEn)).toMatch(/layers 2 directions\. Only the CSS tab/);
    expect(scopeNote(two, "overlay", tEn)).toMatch(/overlay blend mode/);
  });
  it("every tab has code for an ordinary gradient; CSS equals the app's own lines", () => {
    const style = buildMultiGradientStyle(ticks, two, "normal");
    const views = buildExportViews(ticks, two, "normal", style, tEn);
    for (const t of EXPORT_TABS) {
      expect(views[t.key].unsupported, t.key).toBeNull();
      expect(views[t.key].lines.length).toBeGreaterThan(0);
    }
    expect(views.css.lines.join("\n")).toContain("linear-gradient(315deg,");
    expect(views.css.scope).toBeNull();
    expect(views.tailwind.scope).toMatch(/layers 2 directions/);
    expect(views.tailwind.lines.join("\n")).toContain("135deg");
    expect(views.tailwind.lines.join("\n")).not.toContain("315deg");
  });
  it("an unsupported export says why and has no lines", () => {
    const bad: GradientTick[] = [{ id: 1, color: "not-a-colour", position: 0 }, { id: 2, color: "#000000", position: 100 }];
    const views = buildExportViews(bad, one, "normal", { background: "#ccc", backgroundBlendMode: "normal" }, tEn);
    expect(views.swiftui.unsupported).toMatch(/invalid colour/);
    expect(views.swiftui.lines).toEqual([]);
  });
  it("nextExportKey wraps, jumps, and ignores other keys", () => {
    expect(nextExportKey("css", "ArrowRight")).toBe("css-oklab");
    expect(nextExportKey("css", "ArrowLeft")).toBe(EXPORT_TABS[EXPORT_TABS.length - 1].key);
    expect(nextExportKey("scss", "Home")).toBe("css");
    expect(nextExportKey("scss", "End")).toBe(EXPORT_TABS[EXPORT_TABS.length - 1].key);
    expect(nextExportKey("scss", "a")).toBeNull();
  });
});

describe("<ExportPanel>", () => {
  it("is a labelled tablist with one tab per format and the CSS tab selected", async () => {
    const el = await mount();
    const list = el.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Export format");
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(EXPORT_TABS.length);
    expect(tab(el, "css").getAttribute("aria-selected")).toBe("true");
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
    const panel = el.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe("export-tab-css");
    expect(code(el)).toContain("linear-gradient(135deg,");
    expect(code(el)).toContain("#101b45");
  });
  it("clicking a tab switches the code, the language label and the panel's name", async () => {
    const el = await mount();
    await click(tab(el, "tailwind"));
    expect(tab(el, "tailwind").getAttribute("aria-selected")).toBe("true");
    expect(tab(el, "css").getAttribute("aria-selected")).toBe("false");
    expect(code(el)).toContain("bg-[linear-gradient(135deg,#101b45_0%,#3f1d63_50%,#9333ea_100%)]");
    expect(el.querySelector(".export-lang")!.textContent).toBe("Tailwind CSS");
    expect(el.querySelector('[role="tabpanel"]')!.getAttribute("aria-labelledby")).toBe("export-tab-tailwind");
    await click(tab(el, "svg"));
    expect(code(el)).toContain("<linearGradient");
    await click(tab(el, "dtcg"));
    expect(code(el)).toContain('"$type": "gradient"');
  });
  it("the CSS (OKLAB) tab gives two declarations and says browsers need the in clause", async () => {
    const el = await mount();
    await click(tab(el, "css-oklab"));
    expect(code(el).match(/background:/g)).toHaveLength(2);
    expect(code(el)).toContain("135deg in oklab");
    expect(el.textContent).toMatch(/interpolates in OKLAB only when it supports the in clause/);
  });
  it("arrow keys, Home and End move between tabs, select and focus them", async () => {
    const el = await mount();
    tab(el, "css").focus();
    await press(tab(el, "css"), "ArrowRight");
    expect(tab(el, "css-oklab").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab(el, "css-oklab"));
    expect(tab(el, "css-oklab").getAttribute("tabindex")).toBe("0");
    expect(tab(el, "css").getAttribute("tabindex")).toBe("-1");
    await press(tab(el, "css-oklab"), "End");
    expect(document.activeElement).toBe(tab(el, "figma"));
    await press(tab(el, "figma"), "ArrowRight");
    expect(document.activeElement).toBe(tab(el, "css"));
    await press(tab(el, "css"), "ArrowLeft");
    expect(document.activeElement).toBe(tab(el, "figma"));
    await press(tab(el, "figma"), "Home");
    expect(document.activeElement).toBe(tab(el, "css"));
  });
  it("native tabs carry the 'Untested on device' badge; web tabs do not", async () => {
    const el = await mount();
    expect(el.querySelector(".export-badge")).toBeNull();
    for (const k of ["swiftui", "compose", "flutter", "godot", "android", "figma"] as const) {
      await click(tab(el, k));
      expect(el.querySelector(".export-badge")?.textContent, k).toBe("Untested on device");
    }
    await click(tab(el, "scss"));
    expect(el.querySelector(".export-badge")).toBeNull();
  });
  it("the Figma and DTCG tabs say what is unverified", async () => {
    const el = await mount();
    await click(tab(el, "dtcg"));
    expect(el.textContent).toMatch(/Unverified against the normative DTCG text/);
    await click(tab(el, "figma"));
    expect(el.textContent).toMatch(/not verified against Figma/);
  });
  it("copy writes the visible code and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const el = await mount();
    await click(tab(el, "scss"));
    const btn = [...el.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Copy SCSS"))!;
    expect(btn).toBeTruthy();
    await click(btn);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe(code(el));
    expect(writeText.mock.calls[0][0]).toContain("$gradient: linear-gradient(");
    expect(el.querySelector('[role="status"]')!.textContent).toContain("SCSS copied to clipboard");
    expect(btn.textContent).toContain("Copied");
  });
  it("the default CSS copy keeps its announcement", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const el = await mount();
    const btn = [...el.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Copy CSS"))!;
    await click(btn);
    expect(writeText.mock.calls[0][0]).toMatch(/^background: linear-gradient\(135deg,/);
    expect(el.querySelector('[role="status"]')!.textContent).toContain("CSS copied to clipboard");
  });
  it("a failed copy reports failure", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    const el = await mount();
    const btn = [...el.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Copy CSS"))!;
    await click(btn);
    expect(el.querySelector('[role="status"]')!.textContent).toContain("Copy failed");
  });
  it("with several directions only the non-CSS tabs show the note, and the CSS tab keeps every layer", async () => {
    const el = await mount({ directions: two });
    expect(el.querySelector(".export-scope")).toBeNull();
    expect((code(el).match(/linear-gradient\(/g) ?? []).length).toBe(2);
    await click(tab(el, "flutter"));
    const note = el.querySelector(".export-scope")!;
    expect(note.getAttribute("role")).toBe("note");
    expect(note.textContent).toMatch(/Only the CSS tab can express that/);
    expect(note.textContent).toMatch(/135°/);
    expect(code(el)).toContain("LinearGradient(");
  });
  it("a single direction shows no note on any tab", async () => {
    const el = await mount();
    for (const t of EXPORT_TABS) {
      await click(tab(el, t.key));
      expect(el.querySelector(".export-scope"), t.key).toBeNull();
    }
  });
  it("the suggested view is labelled on the title, the tabs' code and the note", async () => {
    const el = await mount({ showingSuggested: true });
    expect(el.querySelector("#export-h")!.textContent).toBe("Suggested export");
    expect(el.querySelector(".export-code")!.getAttribute("aria-label")).toBe("Suggested CSS export");
    expect(el.textContent).toMatch(/suggested gradient shown in the preview, not yet applied/);
    const plain = await (async () => {
      await act(async () => root?.unmount());
      host?.remove();
      return mount();
    })();
    expect(plain.querySelector("#export-h")!.textContent).toBe("Export");
  });
  it("exports exactly the stops it is given (the preview's list)", async () => {
    const swapped: GradientTick[] = [{ id: 1, color: "#ff0000", position: 0 }, { id: 2, color: "#00ff00", position: 100 }];
    const el = await mount({ ticks: swapped });
    expect(code(el)).toContain("#ff0000");
    expect(code(el)).not.toContain("#101b45");
    await click(tab(el, "swiftui"));
    expect(code(el)).toContain("red: 255 / 255");
  });
  it("shows why when a tab cannot export", async () => {
    const bad: GradientTick[] = [{ id: 1, color: "nope", position: 0 }, { id: 2, color: "#000000", position: 100 }];
    const el = await mount({ ticks: bad });
    await click(tab(el, "compose"));
    expect(el.querySelector(".export-code")).toBeNull();
    expect(el.textContent).toMatch(/This format cannot export the current gradient/);
  });
});

describe("axe: export panel", () => {
  it("has no violations on the CSS tab, a native tab and a multi-direction tab", async () => {
    const el = await mount({ directions: two });
    expect(await audit(el)).toEqual([]);
    await click(tab(el, "swiftui"));
    expect(await audit(el)).toEqual([]);
    await click(tab(el, "dtcg"));
    expect(await audit(el)).toEqual([]);
  });
  it("has no violations in the suggested view or with an unsupported tab", async () => {
    const bad: GradientTick[] = [{ id: 1, color: "nope", position: 0 }, { id: 2, color: "#000000", position: 100 }];
    const el = await mount({ ticks: bad, showingSuggested: true });
    await click(tab(el, "svg"));
    expect(await audit(el)).toEqual([]);
  });
});
