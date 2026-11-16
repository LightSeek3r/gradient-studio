// Activation smoke test: bundle the extension with esbuild, load the bundle in
// plain Node with a stub `vscode` module, and drive the providers. No real VS
// Code is downloaded or started.

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "../scripts/build.mjs";
import { createVscode, fakeDocument, Range, type FakeDocument, type Loose } from "./vscode-stub";
import { LANGUAGE_IDS } from "../src/analyze";
import { ROUGH, FLAT } from "./helpers";

const require_ = createRequire(import.meta.url);
const Module = require_("node:module") as { _load: (request: string, ...rest: unknown[]) => unknown };

let dir: string;
let bundle: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "opal42-vscode-"));
  bundle = join(dir, "extension.js");
  await build({ outfile: bundle, minify: true });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Loaded {
  ext: { activate(c: unknown): void; deactivate(): void };
  host: ReturnType<typeof createVscode>["host"];
  context: { subscriptions: { dispose(): void }[] };
}

const originalLoad = Module._load;
afterEach(() => {
  Module._load = originalLoad;
  vi.useRealTimers();
});

/** Load a fresh copy of the bundle against a fresh stub. */
function load(): Loaded {
  const { vscode, host } = createVscode();
  Module._load = function (request: string, ...rest: unknown[]) {
    if (request === "vscode") return vscode;
    return originalLoad.call(this, request, ...rest);
  };
  delete require_.cache[bundle];
  const ext = require_(bundle);
  return { ext, host, context: { subscriptions: [] } };
}

const css = (v: string) => `.a { background: ${v}; }`;

function open(l: Loaded, text: string, opts: { languageId?: string; version?: number; uri?: string } = {}): FakeDocument {
  const doc = fakeDocument(text, opts);
  l.host.documents.push(doc);
  l.host.activeDocument = doc;
  return doc;
}

const token = { isCancellationRequested: false };
const cancelled = { isCancellationRequested: true };

describe("bundle", () => {
  it("is a single CommonJS file that exports activate and deactivate", () => {
    const l = load();
    expect(typeof l.ext.activate).toBe("function");
    expect(typeof l.ext.deactivate).toBe("function");
  });

  it("is self-contained: it only requires vscode", () => {
    const code = readFileSync(bundle, "utf8");
    const required = [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    expect([...new Set(required)]).toEqual(["vscode"]);
    expect(code).not.toContain("@opal42/gradient");
  });

  it("contains no network, process or telemetry APIs", () => {
    const code = readFileSync(bundle, "utf8");
    expect(code).not.toMatch(/\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|createTelemetryLogger|isTelemetryEnabled)\b/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/require\(["'](node:)?(https?|net|tls|dgram|child_process|worker_threads|dns)["']\)/);
  });

  it("stays small", () => {
    expect(statSync(bundle).size).toBeLessThan(200 * 1024);
  });
});

describe("activation", () => {
  it("registers the commands, providers, diagnostics collection and listeners without throwing", () => {
    const l = load();
    expect(() => l.ext.activate(l.context)).not.toThrow();
    expect([...l.host.commands.keys()].sort()).toEqual(["opal42.openInStudio", "opal42.scoreFile", "opal42.showDetails"]);
    expect(l.host.codeLens).toHaveLength(1);
    expect(l.host.hover).toHaveLength(1);
    expect(l.host.actions).toHaveLength(1);
    expect(l.host.collections.map((c) => c.name)).toEqual(["opal42"]);
    expect(l.host.listeners.open).toHaveLength(1);
    expect(l.host.listeners.change).toHaveLength(1);
    expect(l.host.listeners.close).toHaveLength(1);
    expect(l.host.listeners.config).toHaveLength(1);
    expect(l.context.subscriptions.length).toBeGreaterThan(8);
  });

  it("selects exactly the supported language ids, not every file", () => {
    const l = load();
    l.ext.activate(l.context);
    for (const reg of [l.host.codeLens[0], l.host.hover[0], l.host.actions[0]]) {
      expect(reg.selector).toEqual(LANGUAGE_IDS.map((language) => ({ language })));
      expect(JSON.stringify(reg.selector)).not.toContain('"*"');
    }
  });

  it("declares quick fixes as the provided code action kind", () => {
    const l = load();
    l.ext.activate(l.context);
    expect(l.host.actions[0].meta).toEqual({ providedCodeActionKinds: ["quickfix"] });
  });

  it("disposes everything it registered", () => {
    const l = load();
    l.ext.activate(l.context);
    expect(() => l.context.subscriptions.forEach((s) => s.dispose())).not.toThrow();
    expect(l.host.commands.size).toBe(0);
    expect(l.host.codeLens).toHaveLength(0);
    expect(l.host.hover).toHaveLength(0);
    expect(l.host.actions).toHaveLength(0);
    expect(l.host.collections[0].disposed).toBe(true);
    expect(l.host.listeners.open).toHaveLength(0);
    expect(l.host.listeners.change).toHaveLength(0);
    expect(l.host.listeners.close).toHaveLength(0);
    expect(l.host.listeners.config).toHaveLength(0);
  });

  it("can be disposed twice and deactivate is a no-op", () => {
    const l = load();
    l.ext.activate(l.context);
    l.context.subscriptions.forEach((s) => s.dispose());
    expect(() => l.context.subscriptions.forEach((s) => s.dispose())).not.toThrow();
    expect(() => l.ext.deactivate()).not.toThrow();
  });

  it("analyses documents that are already open, after the debounce", () => {
    vi.useFakeTimers();
    const l = load();
    const doc = open(l, css(ROUGH));
    l.ext.activate(l.context);
    expect(l.host.collections[0].map.size).toBe(0);
    vi.advanceTimersByTime(300);
    expect(l.host.collections[0].map.get(doc.uri.toString())).toHaveLength(3);
  });
});

describe("code lens", () => {
  it("shows the score and issue count above the gradient", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, `a {\n  background: ${ROUGH};\n}\n`);
    const lenses = l.host.codeLens[0].provider.provideCodeLenses(doc, token);
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command.title).toBe("Smoothness 58 - 3 issues");
    expect(lenses[0].range.start).toMatchObject({ line: 1, character: 14 });
    expect(lenses[0].command.command).toBe("opal42.showDetails");
  });

  it("puts one lens per gradient, including several on one line", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, `a { background: ${ROUGH}, ${FLAT}; }`);
    const lenses = l.host.codeLens[0].provider.provideCodeLenses(doc, token);
    expect(lenses.map((x: Loose) => x.command.title)).toEqual(["Smoothness 58 - 3 issues", "Smoothness 100 - no issues"]);
    expect(lenses[0].range.start.line).toBe(lenses[1].range.start.line);
  });

  it("gives skipped gradients no lens by default", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css("linear-gradient(var(--a), #fff)"));
    expect(l.host.codeLens[0].provider.provideCodeLenses(doc, token)).toEqual([]);
  });

  it("gives skipped gradients a lens when showSkipped is on", () => {
    const l = load();
    l.ext.activate(l.context);
    l.host.config["opal42.showSkipped"] = true;
    const doc = open(l, css("linear-gradient(var(--a), #fff)"));
    const lenses = l.host.codeLens[0].provider.provideCodeLenses(doc, token);
    expect(lenses.map((x: Loose) => x.command.title)).toEqual(["Not scored - uses var()"]);
  });

  it("returns nothing when the lens setting is off or the request is cancelled", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    expect(l.host.codeLens[0].provider.provideCodeLenses(doc, cancelled)).toEqual([]);
    l.host.config["opal42.codeLens.enabled"] = false;
    expect(l.host.codeLens[0].provider.provideCodeLenses(doc, token)).toEqual([]);
  });

  it("does not analyse a document over the size cap", () => {
    const l = load();
    l.ext.activate(l.context);
    l.host.config["opal42.maxFileSizeKB"] = 10;
    const doc = open(l, css(ROUGH) + " ".repeat(11 * 1024));
    expect(l.host.codeLens[0].provider.provideCodeLenses(doc, token)).toEqual([]);
  });

  it("recomputes only when the document version changes", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    const p = l.host.codeLens[0].provider;
    const spy = vi.spyOn(doc, "getText");
    p.provideCodeLenses(doc, token);
    const after1 = spy.mock.calls.length;
    p.provideCodeLenses(doc, token);
    p.provideCodeLenses(doc, token);
    expect(spy.mock.calls.length).toBe(after1);
    doc.version = 2;
    doc.text = css(FLAT);
    expect(p.provideCodeLenses(doc, token)[0].command.title).toBe("Smoothness 100 - no issues");
  });

  it("refreshes when the minScore setting changes", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    let fired = 0;
    l.host.codeLens[0].provider.onDidChangeCodeLenses(() => fired++);
    l.host.config["opal42.minScore"] = 99;
    l.host.listeners.config[0]({ affectsConfiguration: (s: string) => s === "opal42" });
    expect(fired).toBe(1);
    const sev = l.host.collections[0].map.get(doc.uri.toString())!.map((d) => d.severity);
    expect(new Set(sev)).toEqual(new Set([0]));
  });

  it("ignores unrelated configuration changes", () => {
    const l = load();
    l.ext.activate(l.context);
    let fired = 0;
    l.host.codeLens[0].provider.onDidChangeCodeLenses(() => fired++);
    l.host.listeners.config[0]({ affectsConfiguration: () => false });
    expect(fired).toBe(0);
  });
});

describe("diagnostics", () => {
  it("publishes one diagnostic per finding with code, source and severity", () => {
    vi.useFakeTimers();
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    l.host.listeners.open[0](doc);
    vi.advanceTimersByTime(300);
    const list = l.host.collections[0].map.get(doc.uri.toString())!;
    expect(list.map((d) => d.code)).toEqual(["lightness/reversal", "hue/wide-arc", "chroma/muddy-midpoint"]);
    for (const d of list) {
      expect(d.source).toBe("opal42");
      expect(d.severity).toBe(1);
    }
    const reversal = list[0];
    expect(doc.getText().slice(doc.offsetAt(reversal.range.start), doc.offsetAt(reversal.range.end))).toBe("#00ff00 50%");
  });

  it("debounces a burst of edits into one analysis", () => {
    vi.useFakeTimers();
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    const spy = vi.spyOn(doc, "getText");
    for (let v = 2; v < 12; v++) {
      doc.version = v;
      l.host.listeners.change[0]({ document: doc, contentChanges: [{}] });
      vi.advanceTimersByTime(100);
    }
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ignores change events without content changes and documents of other languages", () => {
    vi.useFakeTimers();
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    l.host.listeners.change[0]({ document: doc, contentChanges: [] });
    const py = open(l, "x = 1", { languageId: "python", uri: "file:///work/a.py" });
    l.host.listeners.open[0](py);
    vi.advanceTimersByTime(1000);
    expect(l.host.collections[0].map.size).toBe(0);
  });

  it("clears diagnostics, cache and timers when a document closes", () => {
    vi.useFakeTimers();
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    l.host.listeners.open[0](doc);
    vi.advanceTimersByTime(300);
    expect(l.host.collections[0].map.size).toBe(1);
    l.host.listeners.change[0]({ document: doc, contentChanges: [{}] });
    l.host.listeners.close[0](doc);
    vi.advanceTimersByTime(1000);
    expect(l.host.collections[0].map.size).toBe(0);
  });

  it("cancels pending timers on dispose", () => {
    vi.useFakeTimers();
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    l.host.listeners.open[0](doc);
    l.context.subscriptions.forEach((s) => s.dispose());
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes nothing when diagnostics are turned off", () => {
    vi.useFakeTimers();
    const l = load();
    l.ext.activate(l.context);
    l.host.config["opal42.diagnostics.enabled"] = false;
    const doc = open(l, css(ROUGH));
    l.host.listeners.open[0](doc);
    vi.advanceTimersByTime(300);
    expect(l.host.collections[0].map.size).toBe(0);
  });
});

describe("hover and quick fixes", () => {
  it("hovers over a gradient with the score, explanation, swatches and fix preview", () => {
    const l = load();
    l.ext.activate(l.context);
    const text = css(ROUGH);
    const doc = open(l, text);
    const pos = doc.positionAt(text.indexOf("#00ff00"));
    const hover = l.host.hover[0].provider.provideHover(doc, pos, token);
    expect(hover.contents.value).toContain("**Smoothness score 58/100**");
    expect(hover.contents.value).toContain("**lightness reversal**");
    expect(hover.contents.value.match(/data:image\/svg\+xml;base64,/g)).toHaveLength(2);
    expect(doc.getText().slice(doc.offsetAt(hover.range.start), doc.offsetAt(hover.range.end))).toBe(ROUGH);
  });

  it("trusts only the Studio command in the hover", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    const hover = l.host.hover[0].provider.provideHover(doc, doc.positionAt(20), token);
    expect(hover.contents.isTrusted).toEqual({ enabledCommands: ["opal42.openInStudio"] });
    expect(hover.contents.supportHtml).toBe(false);
  });

  it("has no hover outside a gradient, or for a skipped one by default", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css("linear-gradient(var(--a), #fff)"));
    expect(l.host.hover[0].provider.provideHover(doc, doc.positionAt(0), token)).toBeUndefined();
    expect(l.host.hover[0].provider.provideHover(doc, doc.positionAt(22), token)).toBeUndefined();
    const doc2 = open(l, css(ROUGH));
    expect(l.host.hover[0].provider.provideHover(doc2, doc2.positionAt(0), token)).toBeUndefined();
  });

  it("explains a skipped gradient when showSkipped is on", () => {
    const l = load();
    l.ext.activate(l.context);
    l.host.config["opal42.showSkipped"] = true;
    const doc = open(l, css("linear-gradient(var(--a), #fff)"));
    const hover = l.host.hover[0].provider.provideHover(doc, doc.positionAt(22), token);
    expect(hover.contents.value).toContain("not scored");
    expect(hover.contents.isTrusted).toBe(false);
  });

  it("offers a quick fix per finding plus a refinement as standard workspace edits", () => {
    const l = load();
    l.ext.activate(l.context);
    const text = css(ROUGH);
    const doc = open(l, text);
    const at = doc.positionAt(text.indexOf("#00ff00"));
    const actions = l.host.actions[0].provider.provideCodeActions(doc, new Range(at, at), { diagnostics: [] }, token);
    expect(actions.map((a: Loose) => a.title)).toEqual([
      "Apply fix: Make stop 2 darker (+12)",
      "Apply fix: Bring the hues of stops 1 and 3 closer (+20)",
      "Apply fix: Shift the hue of stop 2 (+17)",
      "Refine whole gradient (+32)",
    ]);
    for (const a of actions) expect(a.kind).toBe("quickfix");
    const first = actions[0].edit.replacements;
    expect(first).toHaveLength(1);
    expect(first[0].text).toBe("#00a400 50%");
    expect(first[0].meta).toEqual({ label: "Apply fix: Make stop 2 darker (+12)", needsConfirmation: false });
  });

  it("offers nothing when the cursor is outside any gradient", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    const at = doc.positionAt(1);
    expect(l.host.actions[0].provider.provideCodeActions(doc, new Range(at, at), { diagnostics: [] }, token)).toEqual([]);
  });

  it("offers nothing for a gradient that cannot be rewritten", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css("linear-gradient(red 50%, blue 50%)"));
    const at = doc.positionAt(20);
    expect(l.host.actions[0].provider.provideCodeActions(doc, new Range(at, at), { diagnostics: [] }, token)).toEqual([]);
  });

  it("attaches only the matching opal42 diagnostic to a fix", () => {
    const l = load();
    l.ext.activate(l.context);
    const text = css(ROUGH);
    const doc = open(l, text);
    const at = doc.positionAt(text.indexOf("#00ff00"));
    const mine = { source: "opal42", code: "lightness/reversal", range: new Range(at, at) };
    const other = { source: "eslint", code: "lightness/reversal", range: new Range(at, at) };
    const actions = l.host.actions[0].provider.provideCodeActions(doc, new Range(at, at), { diagnostics: [mine, other] }, token);
    expect(actions[0].diagnostics).toEqual([mine]);
    expect(actions[3].diagnostics).toBeUndefined();
  });

  it("returns nothing when cancelled", () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    const at = doc.positionAt(20);
    expect(l.host.actions[0].provider.provideCodeActions(doc, new Range(at, at), { diagnostics: [] }, cancelled)).toEqual([]);
    expect(l.host.hover[0].provider.provideHover(doc, at, cancelled)).toBeUndefined();
  });
});

describe("commands", () => {
  it("scores the current file into the output channel", () => {
    const l = load();
    l.ext.activate(l.context);
    open(l, `a {\n  background: ${ROUGH};\n}\n`);
    l.host.commands.get("opal42.scoreFile")!();
    const out = l.host.output.join("\n");
    expect(out).toContain("/work/a.css");
    expect(out).toContain("2:15  smoothness 58/100, 3 issues");
    expect(out).toContain("lightness/reversal");
    expect(l.host.outputChannels).toBe(1);
    l.host.commands.get("opal42.scoreFile")!();
    expect(l.host.outputChannels).toBe(1);
  });

  it("tells the user to open a file when there is none", () => {
    const l = load();
    l.ext.activate(l.context);
    l.host.commands.get("opal42.scoreFile")!();
    expect(l.host.infos[0]).toMatch(/open a file/i);
  });

  it("opens the gradient under the cursor in Gradient Studio, and only then", async () => {
    const l = load();
    l.ext.activate(l.context);
    const text = css(ROUGH);
    const doc = open(l, text);
    expect(l.host.opened).toEqual([]);
    l.host.activeSelection = doc.positionAt(text.indexOf("#00ff00"));
    await l.host.commands.get("opal42.openInStudio")!();
    expect(l.host.opened).toEqual(["https://gradient-studio-al4.pages.dev/#v1;s=ff0000@0,00ff00@50,0000ff@100;d=90:100:1;b=normal"]);
  });

  it("uses the configured studio address", async () => {
    const l = load();
    l.ext.activate(l.context);
    l.host.config["opal42.studioUrl"] = "http://localhost:5173/";
    open(l, css(ROUGH));
    await l.host.commands.get("opal42.openInStudio")!();
    expect(l.host.opened[0].startsWith("http://localhost:5173/#v1;")).toBe(true);
  });

  it("falls back to the default address when the setting is not http(s)", async () => {
    const l = load();
    l.ext.activate(l.context);
    l.host.config["opal42.studioUrl"] = "javascript:alert(1)";
    open(l, css(ROUGH));
    await l.host.commands.get("opal42.openInStudio")!();
    expect(l.host.opened[0].startsWith("https://gradient-studio-al4.pages.dev/")).toBe(true);
  });

  it("takes the document and offset from the hover link's arguments", async () => {
    const l = load();
    l.ext.activate(l.context);
    const text = css(ROUGH) + "\n" + css(FLAT);
    const doc = open(l, text);
    l.host.activeSelection = doc.positionAt(0);
    await l.host.commands.get("opal42.openInStudio")!({ uri: doc.uri.toString(), offset: text.lastIndexOf("linear-gradient") });
    expect(l.host.opened[0]).toContain("s=000000@0,ffffff@100");
  });

  it("asks which gradient when the cursor is on none of several", async () => {
    const l = load();
    l.ext.activate(l.context);
    open(l, css(ROUGH) + "\n" + css(FLAT));
    l.host.quickPick = (items) => items[1];
    await l.host.commands.get("opal42.openInStudio")!();
    expect(l.host.opened[0]).toContain("s=000000@0,ffffff@100");
  });

  it("opens nothing when the pick is cancelled", async () => {
    const l = load();
    l.ext.activate(l.context);
    open(l, css(ROUGH) + "\n" + css(FLAT));
    await l.host.commands.get("opal42.openInStudio")!();
    expect(l.host.opened).toEqual([]);
  });

  it("opens the only gradient without asking", async () => {
    const l = load();
    l.ext.activate(l.context);
    open(l, css(ROUGH));
    await l.host.commands.get("opal42.openInStudio")!();
    expect(l.host.opened).toHaveLength(1);
  });

  it("warns instead of opening when the gradient has too many stops for a link", async () => {
    const l = load();
    l.ext.activate(l.context);
    const stops = Array.from({ length: 12 }, (_, i) => `#${(i * 20).toString(16).padStart(2, "0")}0000`).join(", ");
    open(l, css(`linear-gradient(${stops})`));
    await l.host.commands.get("opal42.openInStudio")!();
    expect(l.host.opened).toEqual([]);
    expect(l.host.warnings[0]).toMatch(/at most 10 stops/);
  });

  it("says so when there is no gradient", async () => {
    const l = load();
    l.ext.activate(l.context);
    open(l, "a { color: red }");
    await l.host.commands.get("opal42.openInStudio")!();
    expect(l.host.infos[0]).toMatch(/no gradient/i);
    expect(l.host.opened).toEqual([]);
  });

  it("never opens an external URL from the passive features", () => {
    vi.useFakeTimers();
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    l.host.listeners.open[0](doc);
    vi.advanceTimersByTime(500);
    l.host.codeLens[0].provider.provideCodeLenses(doc, token);
    l.host.hover[0].provider.provideHover(doc, doc.positionAt(20), token);
    expect(l.host.opened).toEqual([]);
  });

  it("moves the cursor and shows the hover for a lens click", async () => {
    const l = load();
    l.ext.activate(l.context);
    const doc = open(l, css(ROUGH));
    await l.host.commands.get("opal42.showDetails")!(doc.uri.toString(), 14);
    expect(l.host.executed).toEqual(["editor.action.showHover"]);
  });
});
