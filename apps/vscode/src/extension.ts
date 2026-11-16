// Thin VS Code adapter. All logic lives in the pure modules next to this file
// (analyze, hover, preview, studio, report); this file only turns their plain
// results into VS Code objects and wires events, with debouncing and a cache
// keyed by document version.
//
// Local only: no network access, no telemetry API (see docs/vscode.md). The
// single outward action is `env.openExternal` in "Open in Gradient Studio",
// and only when the user runs that command.

import * as vscode from "vscode";
import {
  analyze,
  computeFixes,
  gradientAt,
  gradientsIn,
  LANGUAGE_IDS,
  normalizeSettings,
  type Analysis,
  type AnalyzedGradient,
  type FixAction,
  type Settings,
} from "./analyze";
import { hoverMarkdown } from "./hover";
import { formatReport } from "./report";
import { studioHash, studioUrl } from "./studio";

const DEBOUNCE_MS = 300;
/** Longest time one analysis may take before it returns what it has (the host stays responsive). */
const BUDGET_MS = 250;

const LANGUAGES: ReadonlySet<string> = new Set(LANGUAGE_IDS);
const SELECTOR: vscode.DocumentSelector = LANGUAGE_IDS.map((language) => ({ language }));

interface Entry {
  version: number;
  languageId: string;
  settingsKey: string;
  analysis: Analysis;
  fixes: Map<number, FixAction[]>;
}

function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration("opal42");
  return normalizeSettings({
    minScore: c.get("minScore"),
    showSkipped: c.get("showSkipped"),
    maxFileSizeKB: c.get("maxFileSizeKB"),
    budgetMs: BUDGET_MS,
  });
}

const flag = (key: string, fallback: boolean): boolean => vscode.workspace.getConfiguration("opal42").get<boolean>(key, fallback);

/** Results by document, valid for one document version and one set of settings. */
class Store {
  private readonly entries = new Map<string, Entry>();

  eligible(doc: vscode.TextDocument): boolean {
    return LANGUAGES.has(doc.languageId);
  }

  get(doc: vscode.TextDocument): Entry {
    const key = doc.uri.toString();
    const settings = readSettings();
    const settingsKey = JSON.stringify(settings);
    const hit = this.entries.get(key);
    if (hit && hit.version === doc.version && hit.languageId === doc.languageId && hit.settingsKey === settingsKey) return hit;
    const entry: Entry = {
      version: doc.version,
      languageId: doc.languageId,
      settingsKey,
      analysis: analyze(doc.getText(), doc.languageId, settings),
      fixes: new Map(),
    };
    this.entries.set(key, entry);
    return entry;
  }

  fixes(doc: vscode.TextDocument, entry: Entry, item: AnalyzedGradient): FixAction[] {
    let fixes = entry.fixes.get(item.index);
    if (!fixes) {
      fixes = computeFixes(doc.getText(), item);
      entry.fixes.set(item.index, fixes);
    }
    return fixes;
  }

  delete(doc: vscode.TextDocument): void {
    this.entries.delete(doc.uri.toString());
  }

  clear(): void {
    this.entries.clear();
  }
}

const SEVERITY: Record<"info" | "warning" | "error", vscode.DiagnosticSeverity> = {
  info: vscode.DiagnosticSeverity.Information,
  warning: vscode.DiagnosticSeverity.Warning,
  error: vscode.DiagnosticSeverity.Error,
};

const toRange = (doc: vscode.TextDocument, r: { start: number; end: number }) => new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end));

export function activate(context: vscode.ExtensionContext): void {
  const store = new Store();
  const diagnostics = vscode.languages.createDiagnosticCollection("opal42");
  const lensChanged = new vscode.EventEmitter<void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let output: vscode.OutputChannel | undefined;

  const publish = (doc: vscode.TextDocument): void => {
    if (!store.eligible(doc)) return;
    if (!flag("diagnostics.enabled", true)) {
      diagnostics.delete(doc.uri);
      return;
    }
    const { analysis } = store.get(doc);
    const list: vscode.Diagnostic[] = [];
    for (const item of analysis.items) {
      for (const f of item.diagnostics) {
        const d = new vscode.Diagnostic(toRange(doc, f.range), f.message, SEVERITY[f.severity]);
        d.code = f.code;
        d.source = "opal42";
        list.push(d);
      }
    }
    diagnostics.set(doc.uri, list);
  };

  const schedule = (doc: vscode.TextDocument): void => {
    if (!store.eligible(doc)) return;
    const key = doc.uri.toString();
    const pending = timers.get(key);
    if (pending !== undefined) clearTimeout(pending);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        publish(doc);
        lensChanged.fire();
      }, DEBOUNCE_MS),
    );
  };

  const refreshAll = (): void => {
    store.clear();
    for (const doc of vscode.workspace.textDocuments) publish(doc);
    lensChanged.fire();
  };

  const showDetails = async (uri?: vscode.Uri | string, offset?: number): Promise<void> => {
    const target = typeof uri === "string" ? uri : uri?.toString();
    let editor = vscode.window.activeTextEditor;
    if (target && editor?.document.uri.toString() !== target) {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target);
      if (doc) editor = await vscode.window.showTextDocument(doc);
    }
    if (!editor || typeof offset !== "number") return;
    const at = editor.document.positionAt(offset);
    editor.selection = new vscode.Selection(at, at);
    editor.revealRange(new vscode.Range(at, at));
    await vscode.commands.executeCommand("editor.action.showHover");
  };

  const scoreFile = (): void => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage("Opal42: open a file first.");
      return;
    }
    const doc = editor.document;
    output ??= vscode.window.createOutputChannel("Opal42");
    const analysis = analyze(doc.getText(), doc.languageId, readSettings());
    output.appendLine(formatReport(doc.uri.scheme === "file" ? doc.fileName : doc.uri.toString(), doc.getText(), analysis));
    output.show(true);
  };

  const openInStudio = async (arg?: { uri?: string; offset?: number }): Promise<void> => {
    let doc = vscode.window.activeTextEditor?.document;
    let offset = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.offsetAt(vscode.window.activeTextEditor.selection.active) : 0;
    if (arg && typeof arg.uri === "string" && typeof arg.offset === "number") {
      doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === arg.uri) ?? doc;
      offset = arg.offset;
    }
    if (!doc) {
      void vscode.window.showInformationMessage("Opal42: open a file with a gradient first.");
      return;
    }
    const analysis = store.eligible(doc) ? store.get(doc).analysis : analyze(doc.getText(), doc.languageId, readSettings());
    const openable = analysis.items.filter((g) => g.parsed.document !== null);
    let item = gradientAt(openable, offset);
    if (!item) {
      if (openable.length === 0) {
        void vscode.window.showInformationMessage("Opal42: no gradient found in this file.");
        return;
      }
      if (openable.length === 1) {
        item = openable[0];
      } else {
        const text = doc.getText();
        const pick = await vscode.window.showQuickPick(
          openable.map((g) => ({
            label: `Line ${doc.positionAt(g.range.start).line + 1}`,
            description: g.status === "scored" ? `Smoothness ${g.score}` : "not scored",
            detail: text.slice(g.range.start, Math.min(g.range.end, g.range.start + 120)),
            item: g,
          })),
          { placeHolder: "Which gradient to open in Gradient Studio?" },
        );
        item = pick?.item;
      }
    }
    if (!item) return;
    const link = studioUrl(vscode.workspace.getConfiguration("opal42").get("studioUrl"), item.parsed.document);
    if (!link.ok) {
      void vscode.window.showWarningMessage(`Opal42: ${link.reason}`);
      return;
    }
    // The only outward action of this extension, and only on this explicit command.
    await vscode.env.openExternal(vscode.Uri.parse(link.url));
  };

  const lensProvider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: lensChanged.event,
    provideCodeLenses(doc, token) {
      if (!flag("codeLens.enabled", true) || token.isCancellationRequested) return [];
      const { analysis } = store.get(doc);
      const lenses: vscode.CodeLens[] = [];
      for (const item of analysis.items) {
        if (!item.lens) continue;
        const at = doc.positionAt(item.lens.range.start);
        lenses.push(
          new vscode.CodeLens(new vscode.Range(at, at), {
            title: item.lens.title,
            command: "opal42.showDetails",
            arguments: [doc.uri.toString(), item.range.start],
            tooltip: "Show the findings for this gradient",
          }),
        );
      }
      return lenses;
    },
  };

  const hoverProvider: vscode.HoverProvider = {
    provideHover(doc, position, token) {
      if (token.isCancellationRequested) return undefined;
      const entry = store.get(doc);
      const item = gradientAt(entry.analysis.items, doc.offsetAt(position));
      if (!item) return undefined;
      if (item.status === "skipped" && !readSettings().showSkipped) return undefined;
      const fixes = item.status === "scored" ? store.fixes(doc, entry, item) : [];
      const canOpen = item.parsed.document !== null && studioHash(item.parsed.document).ok;
      const studioArgs = canOpen ? encodeURIComponent(JSON.stringify([{ uri: doc.uri.toString(), offset: item.range.start }])) : undefined;
      const md = new vscode.MarkdownString(hoverMarkdown(item, { fixes, studioArgs }));
      md.isTrusted = canOpen ? { enabledCommands: ["opal42.openInStudio"] } : false;
      return new vscode.Hover(md, toRange(doc, item.range));
    },
  };

  const actionProvider: vscode.CodeActionProvider = {
    provideCodeActions(doc, range, ctx, token) {
      if (token.isCancellationRequested) return [];
      const entry = store.get(doc);
      const items = gradientsIn(entry.analysis.items, doc.offsetAt(range.start), doc.offsetAt(range.end)).filter((g) => g.status === "scored");
      const actions: vscode.CodeAction[] = [];
      for (const item of items) {
        for (const fix of store.fixes(doc, entry, item)) {
          const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
          const edit = new vscode.WorkspaceEdit();
          // Standard WorkspaceEdit: the editor can show it as a diff ("Show preview") before applying.
          for (const e of fix.edits) edit.replace(doc.uri, toRange(doc, e), e.newText, { label: fix.title, needsConfirmation: false });
          action.edit = edit;
          if (fix.code) {
            action.diagnostics = ctx.diagnostics.filter((d) => d.source === "opal42" && d.code === fix.code && d.range.intersection(toRange(doc, item.range)));
          }
          actions.push(action);
        }
      }
      return actions;
    },
  };

  context.subscriptions.push(
    diagnostics,
    lensChanged,
    { dispose: () => { for (const t of timers.values()) clearTimeout(t); timers.clear(); store.clear(); output?.dispose(); } },
    vscode.languages.registerCodeLensProvider(SELECTOR, lensProvider),
    vscode.languages.registerHoverProvider(SELECTOR, hoverProvider),
    vscode.languages.registerCodeActionsProvider(SELECTOR, actionProvider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.commands.registerCommand("opal42.scoreFile", scoreFile),
    vscode.commands.registerCommand("opal42.openInStudio", openInStudio),
    vscode.commands.registerCommand("opal42.showDetails", showDetails),
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length > 0) schedule(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const t = timers.get(key);
      if (t !== undefined) clearTimeout(t);
      timers.delete(key);
      store.delete(doc);
      diagnostics.delete(doc.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("opal42")) refreshAll();
    }),
  );

  for (const doc of vscode.workspace.textDocuments) schedule(doc);
}

export function deactivate(): void {
  // Everything registered in activate() is disposed through context.subscriptions.
}
