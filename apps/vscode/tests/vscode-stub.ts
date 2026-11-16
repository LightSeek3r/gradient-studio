// A minimal in-memory `vscode` module: just enough surface for the extension's
// activate() to register everything and for the registered providers and
// listeners to be called with fake documents. No real VS Code is involved.

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export class Range {
  start: Position;
  end: Position;
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    if (typeof a === "number") {
      this.start = new Position(a, b as number);
      this.end = new Position(c as number, d as number);
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
  intersection(o: Range): Range | undefined {
    const lt = (p: Position, q: Position) => p.line < q.line || (p.line === q.line && p.character < q.character);
    const start = lt(this.start, o.start) ? o.start : this.start;
    const end = lt(this.end, o.end) ? this.end : o.end;
    return lt(end, start) ? undefined : new Range(start, end);
  }
}

export class Selection extends Range {
  constructor(
    public anchor: Position,
    public active: Position,
  ) {
    super(anchor, active);
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  code?: string | number;
  source?: string;
  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity,
  ) {}
}

export class CodeLens {
  constructor(
    public range: Range,
    public command?: { title: string; command: string; arguments?: unknown[]; tooltip?: string },
  ) {}
}

export const CodeActionKind = { QuickFix: "quickfix" };

export class CodeAction {
  edit?: WorkspaceEdit;
  diagnostics?: Diagnostic[];
  constructor(
    public title: string,
    public kind?: string,
  ) {}
}

export class WorkspaceEdit {
  replacements: { uri: unknown; range: Range; text: string; meta?: unknown }[] = [];
  replace(uri: unknown, range: Range, text: string, meta?: unknown): void {
    this.replacements.push({ uri, range, text, meta });
  }
}

export class MarkdownString {
  isTrusted?: boolean | { enabledCommands: string[] };
  supportHtml = false;
  constructor(public value: string) {}
}

export class Hover {
  constructor(
    public contents: MarkdownString,
    public range?: Range,
  ) {}
}

export class EventEmitter<T> {
  private handlers: ((e: T) => void)[] = [];
  disposed = false;
  event = (h: (e: T) => void) => {
    this.handlers.push(h);
    return { dispose: () => (this.handlers = this.handlers.filter((x) => x !== h)) };
  };
  fire(e?: T): void {
    for (const h of [...this.handlers]) h(e as T);
  }
  dispose(): void {
    this.disposed = true;
    this.handlers = [];
  }
}

export interface StubUri {
  scheme: string;
  path: string;
  toString(): string;
}

export const Uri = {
  parse(s: string): StubUri {
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
    return { scheme: m ? m[1] : "file", path: s, toString: () => s };
  },
  file(p: string): StubUri {
    return { scheme: "file", path: p, toString: () => `file://${p}` };
  },
};

/** VS Code's line model: a line ends at \r\n, \n or \r; characters are UTF-16 units. */
export function fakeDocument(text: string, opts: { languageId?: string; uri?: string; version?: number } = {}) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r" && text[i + 1] === "\n") {
      i++;
      lineStarts.push(i + 1);
    } else if (text[i] === "\n" || text[i] === "\r") {
      lineStarts.push(i + 1);
    }
  }
  const doc = {
    uri: Uri.parse(opts.uri ?? "file:///work/a.css"),
    languageId: opts.languageId ?? "css",
    version: opts.version ?? 1,
    fileName: "/work/a.css",
    text,
    getText: () => doc.text,
    positionAt(offset: number): Position {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new Position(line, offset - lineStarts[line]);
    },
    offsetAt(p: Position): number {
      return lineStarts[p.line] + p.character;
    },
  };
  return doc;
}
export type FakeDocument = ReturnType<typeof fakeDocument>;

/** Test doubles are driven with whatever shape the extension passes; typing them precisely adds nothing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;

type Handler<T> = (e: T) => void;

export function createVscode() {
  const host = {
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    codeLens: [] as { selector: unknown; provider: Loose }[],
    hover: [] as { selector: unknown; provider: Loose }[],
    actions: [] as { selector: unknown; provider: Loose; meta: unknown }[],
    collections: [] as { name: string; map: Map<string, Diagnostic[]>; disposed: boolean }[],
    listeners: { open: [] as Handler<Loose>[], change: [] as Handler<Loose>[], close: [] as Handler<Loose>[], config: [] as Handler<Loose>[] },
    config: {} as Record<string, unknown>,
    documents: [] as FakeDocument[],
    activeDocument: undefined as FakeDocument | undefined,
    activeSelection: new Position(0, 0),
    opened: [] as string[],
    infos: [] as string[],
    warnings: [] as string[],
    output: [] as string[],
    outputChannels: 0,
    revealed: 0,
    executed: [] as string[],
    quickPick: undefined as undefined | ((items: Loose[]) => Loose),
  };

  const disposable = (fn: () => void) => ({ dispose: fn });
  const listener = <T>(list: Handler<T>[]) => (h: Handler<T>) => {
    list.push(h);
    return disposable(() => {
      const i = list.indexOf(h);
      if (i >= 0) list.splice(i, 1);
    });
  };

  const vscode = {
    Position,
    Range,
    Selection,
    Diagnostic,
    DiagnosticSeverity,
    CodeLens,
    CodeAction,
    CodeActionKind,
    WorkspaceEdit,
    MarkdownString,
    Hover,
    EventEmitter,
    Uri,
    languages: {
      createDiagnosticCollection(name: string) {
        const c = { name, map: new Map<string, Diagnostic[]>(), disposed: false };
        host.collections.push(c);
        return {
          set: (uri: StubUri, list: Diagnostic[]) => c.map.set(uri.toString(), list),
          delete: (uri: StubUri) => c.map.delete(uri.toString()),
          clear: () => c.map.clear(),
          dispose: () => {
            c.disposed = true;
            c.map.clear();
          },
        };
      },
      registerCodeLensProvider(selector: unknown, provider: unknown) {
        const r = { selector, provider };
        host.codeLens.push(r);
        return disposable(() => host.codeLens.splice(host.codeLens.indexOf(r), 1));
      },
      registerHoverProvider(selector: unknown, provider: unknown) {
        const r = { selector, provider };
        host.hover.push(r);
        return disposable(() => host.hover.splice(host.hover.indexOf(r), 1));
      },
      registerCodeActionsProvider(selector: unknown, provider: unknown, meta: unknown) {
        const r = { selector, provider, meta };
        host.actions.push(r);
        return disposable(() => host.actions.splice(host.actions.indexOf(r), 1));
      },
    },
    commands: {
      registerCommand(id: string, fn: (...a: unknown[]) => unknown) {
        host.commands.set(id, fn);
        return disposable(() => host.commands.delete(id));
      },
      async executeCommand(id: string) {
        host.executed.push(id);
      },
    },
    workspace: {
      get textDocuments() {
        return host.documents;
      },
      getConfiguration(section: string) {
        return {
          get: (key: string, fallback?: unknown) => {
            const v = host.config[`${section}.${key}`];
            return v === undefined ? fallback : v;
          },
        };
      },
      onDidOpenTextDocument: listener(host.listeners.open),
      onDidChangeTextDocument: listener(host.listeners.change),
      onDidCloseTextDocument: listener(host.listeners.close),
      onDidChangeConfiguration: listener(host.listeners.config),
    },
    window: {
      get activeTextEditor() {
        const d = host.activeDocument;
        if (!d) return undefined;
        return {
          document: d,
          selection: { active: host.activeSelection } as unknown,
          revealRange: () => void host.revealed++,
        };
      },
      createOutputChannel() {
        host.outputChannels++;
        return { appendLine: (s: string) => host.output.push(s), show: () => {}, dispose: () => {} };
      },
      showInformationMessage: async (m: string) => void host.infos.push(m),
      showWarningMessage: async (m: string) => void host.warnings.push(m),
      showQuickPick: async (items: unknown[]) => (host.quickPick ? host.quickPick(items as Loose[]) : undefined),
      showTextDocument: async (d: FakeDocument) => ({ document: d, selection: {}, revealRange: () => {} }),
    },
    env: {
      openExternal: async (u: StubUri) => {
        host.opened.push(u.toString());
        return true;
      },
    },
  };
  return { vscode, host };
}
