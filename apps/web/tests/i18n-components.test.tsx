// @vitest-environment jsdom
// The provider, the language switcher and the components under both locales.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { proposeFixes, scoreGradient, type GradientTick } from "@opal42/gradient";
import { ExportPanel } from "../src/components/ExportPanel";
import { ImportDialog } from "../src/components/ImportDialog";
import { MobileTabBar } from "../src/components/MobileTabBar";
import { ScoreLedger } from "../src/components/ScorePanel";
import { StopCard } from "../src/components/StopCard";
import { SuggestionPanel } from "../src/components/SuggestionCompare";
import { Toast } from "../src/components/Toast";
import { buildLedger } from "../src/explain/ledger";
import { fixLabel } from "../src/explain/fix-label";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { LanguageSwitcher } from "../src/i18n/LanguageSwitcher";
import { LOCALE_STORAGE_KEY, type Locale } from "../src/i18n/locale";
import { createI18n } from "../src/i18n/translator";
import { computeSuggestion } from "../src/suggest/compare";
import { buildMultiGradientStyle } from "@opal42/gradient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
  window.location.hash = "";
  document.documentElement.lang = "en";
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

const audit = async (el: HTMLElement, extra: Record<string, { enabled: boolean }> = {}) =>
  (await axe(el, { rules: { region: { enabled: false }, "color-contrast": { enabled: false }, ...extra } })).violations;

const ticks: GradientTick[] = [
  { id: 1, color: "#ff0000", position: 0 },
  { id: 2, color: "#00ff00", position: 50 },
  { id: 3, color: "#0000ff", position: 100 },
];

describe("I18nProvider and LanguageSwitcher", () => {
  it("starts in the pinned locale and sets <html lang>, <title> and the meta tags", async () => {
    document.head.innerHTML = `<meta name="description" content="x"><meta property="og:title" content="x"><meta property="og:locale" content="en_US">`;
    await mount(
      <I18nProvider initialLocale="fr">
        <LanguageSwitcher />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe("fr");
    expect(document.title).toMatch(/Éditeur de dégradés/);
    expect(document.head.querySelector('meta[name="description"]')!.getAttribute("content")).toMatch(/dégradés CSS/);
    expect(document.head.querySelector('meta[property="og:locale"]')!.getAttribute("content")).toBe("fr_FR");
  });

  it("is an accessible EN | FR radio group that switches, remembers and updates the document", async () => {
    const el = await mount(
      <I18nProvider initialLocale="en">
        <LanguageSwitcher />
      </I18nProvider>,
    );
    const group = el.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Language");
    const radios = [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(["EN", "FR"]);
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["English", "Français"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1]);
    expect(await audit(el)).toEqual([]);

    await act(async () => radios[1].click());
    expect(document.documentElement.lang).toBe("fr");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");
    expect(el.querySelector('[role="radiogroup"]')!.getAttribute("aria-label")).toBe("Langue");
    expect(el.querySelectorAll<HTMLButtonElement>('[role="radio"]')[1].getAttribute("aria-checked")).toBe("true");

    // Arrow keys move and select, as in any radio group.
    const fr = el.querySelectorAll<HTMLButtonElement>('[role="radio"]')[1];
    await act(async () => {
      fr.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    });
    expect(document.documentElement.lang).toBe("en");
  });

  it("follows lang= in the address on hashchange", async () => {
    await mount(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe("en");
    await act(async () => {
      window.location.hash = "#v1;s=101b45@0,9333ea@100;lang=fr";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(document.documentElement.lang).toBe("fr");
  });

  it("survives unavailable storage", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const el = await mount(
      <I18nProvider initialLocale="en">
        <LanguageSwitcher />
      </I18nProvider>,
    );
    await act(async () => el.querySelectorAll<HTMLButtonElement>('[role="radio"]')[1].click());
    expect(document.documentElement.lang).toBe("fr");
    spy.mockRestore();
  });
});

describe.each<Locale>(["en", "fr"])("components in %s: no axe violations and translated text", (locale) => {
  const i18n = createI18n(locale);
  const wrap = (node: React.ReactElement) => <I18nProvider initialLocale={locale}>{node}</I18nProvider>;

  it("stop card", async () => {
    const el = await mount(
      wrap(
        <StopCard
          tick={ticks[0]}
          index={0}
          canRemove
          notation="hsl"
          onNotation={vi.fn()}
          onColor={vi.fn()}
          onPosition={vi.fn()}
          onRemove={vi.fn()}
          onComplement={vi.fn()}
        />,
      ),
    );
    expect(await audit(el)).toEqual([]);
    expect(el.querySelector('[role="group"]')!.getAttribute("aria-label")).toBe(i18n.t("stop.group", { n: 1 }));
    expect(el.querySelector('input[aria-label*="clarté"], input[aria-label*="lightness"]')).not.toBeNull();
  });

  it("score ledger with a fix", async () => {
    const scored = scoreGradient(ticks);
    const ledger = buildLedger(scored.findings, scored.score, i18n.t);
    const fixes = new Map(proposeFixes(ticks).map((f) => [f.code, { gain: f.gain, label: fixLabel(f, ticks, i18n) }]));
    const el = await mount(
      wrap(
        <ScoreLedger
          ledger={ledger}
          fixes={fixes}
          isOpen={(code) => code === ledger.rows[0].code}
          onToggle={vi.fn()}
          active={null}
          onActive={vi.fn()}
          preview={null}
          onPreview={vi.fn()}
          onApplyFix={vi.fn()}
        />,
      ),
    );
    expect(await audit(el)).toEqual([]);
    expect(el.querySelector(".ledger-start")!.textContent).toBe(`${i18n.t("ledger.start")}100`);
    expect(el.querySelector(".ledger-message")!.textContent).toBe(ledger.rows[0].message);
  });

  it("import dialog with a warning and with an error", async () => {
    const el = await mount(
      wrap(
        <ImportDialog open initialText="linear-gradient(in oklch, red, 30%, blue)" intro={i18n.t("import.intro")} onImport={vi.fn()} onClose={vi.fn()} />,
      ),
    );
    expect(await audit(el)).toEqual([]);
    expect(el.querySelector(".import-warnings")!.textContent).toContain(locale === "fr" ? "interpolation" : "interpolation");
    expect(el.querySelector("h2")!.textContent).toBe(i18n.t("import.title"));
    expect(el.querySelector("label code")!.textContent).toBe("linear-gradient(…)");
  });

  it("export panel, mobile tab bar, toast and suggestion panel", async () => {
    const style = buildMultiGradientStyle(ticks, [{ id: 1, angle: 90, weight: 100, enabled: true }], "normal");
    const el = await mount(
      wrap(
        <>
          <ExportPanel ticks={ticks} directions={[{ id: 1, angle: 90, weight: 100, enabled: true }]} blend="normal" style={style} showingSuggested={false} />
          <MobileTabBar active="stops" onChange={vi.fn()} issueCount={3} badgeColor="red" />
          <Toast toast={{ id: 1, message: "m", undo: true, details: ["d"] }} onUndo={vi.fn()} onDismiss={vi.fn()} onPause={vi.fn()} />
          <SuggestionPanel suggestion={computeSuggestion(ticks)} selected={new Set([1, 2, 3])} selectedScore={90} onSuggest={vi.fn()} onToggle={vi.fn()} onApplySelected={vi.fn()} onApplyAll={vi.fn()} />
        </>,
      ),
    );
    // The tab bar's panels live in App, not in this fragment.
    expect(await audit(el, { "aria-valid-attr-value": { enabled: false } })).toEqual([]);
    expect(el.querySelector('[role="tablist"][aria-label]')!.getAttribute("aria-label")).toBeTruthy();
    expect([...el.querySelectorAll(".tabbar-label")].map((n) => n.textContent)).toEqual(
      ["stops", "score", "directions", "export"].map((k) => i18n.t(`tabs.${k as "stops"}`)),
    );
    expect(el.querySelector(".tabbar .sr-only")!.textContent).toBe(i18n.t("tabs.issues", { count: 3 }));
  });
});
