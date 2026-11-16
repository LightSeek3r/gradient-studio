// @vitest-environment jsdom
// Component-level axe regression tests (structure, names, roles, labels).
// jsdom has no layout or CSS, so colour contrast and focus-visibility are NOT
// covered here: those are checked against the built app in a real browser.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { proposeFixes, scoreGradient, type GradientTick } from "@opal42/gradient";
import { ImportDialog } from "../src/components/ImportDialog";
import { ScoreLedger } from "../src/components/ScorePanel";
import { StopChip } from "../src/components/StopChip";
import { buildLedger } from "../src/explain/ledger";

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
});

beforeAll(() => {
  // jsdom implements <dialog> without showModal()/close().
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

/** Fragments are not pages (no landmark rule); jsdom has no CSS (no contrast rule). */
const audit = async (el: HTMLElement) => (await axe(el, { rules: { region: { enabled: false }, "color-contrast": { enabled: false } } })).violations;

const ticks: GradientTick[] = [
  { id: 1, color: "#ff0000", position: 0 },
  { id: 2, color: "#00ff00", position: 50 },
  { id: 3, color: "#0000ff", position: 100 },
];

describe("axe: component structure", () => {
  it("canary: the audit does catch a nameless button", async () => {
    const el = await mount(<button type="button" />);
    expect((await audit(el)).map((v) => v.id)).toContain("button-name");
  });

  it("stop chip (select button + remove button) has no violations", async () => {
    const el = await mount(
      <StopChip tick={ticks[0]} n={1} canRemove onSelect={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(await audit(el)).toEqual([]);
  });

  it("score ledger rows (start, findings, floor, total) have no violations", async () => {
    const scored = scoreGradient(ticks);
    const ledger = buildLedger(scored.findings, scored.score);
    expect(ledger.rows.length).toBeGreaterThan(0); // the test would pass vacuously on an empty ledger
    const fixes = new Map(proposeFixes(ticks).map((f) => [f.code, { gain: f.gain, label: f.label }]));
    const el = await mount(
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
    );
    expect(el.querySelectorAll(".ledger-row").length).toBeGreaterThanOrEqual(ledger.rows.length);
    expect(await audit(el)).toEqual([]);
  });

  it("import dialog with a valid paste, warnings and preview has no violations", async () => {
    const el = await mount(
      <ImportDialog
        open
        initialText="linear-gradient(in oklch, red, 30%, blue)"
        intro="This looks like a full gradient - import it?"
        onImport={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(el.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(el.querySelector(".import-warnings")).not.toBeNull();
    expect(await audit(el)).toEqual([]);
  });

  it("import dialog showing an error has no violations", async () => {
    const el = await mount(
      <ImportDialog open initialText="repeating-linear-gradient(red, blue 20%)" onImport={vi.fn()} onClose={vi.fn()} />,
    );
    expect(el.querySelector(".import-error")).not.toBeNull();
    expect(await audit(el)).toEqual([]);
  });
});
