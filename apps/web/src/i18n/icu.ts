// ── ICU-lite message formatting ───────────────────────────────────────────────
// The small subset of ICU MessageFormat the catalogues use, with no runtime
// dependency (docs/i18n.md):
//
//   {name}                                        a value
//   {n, plural, =0 {none} one {# item} other {# items}}
//                                                  `#` is the number, formatted
//                                                  for the locale; the category
//                                                  comes from Intl.PluralRules
//   {kind, select, a {…} b {…} other {…}}         exact match, else `other`
//   \{  \}  \\                                     literal characters
//
// Apostrophes are plain characters (French needs them everywhere), so there is
// no ICU quoting. Branches may nest further placeholders. Pure and
// deterministic; parsed messages are cached per string.

export type MessageValue = string | number;
export type MessageParams = Readonly<Record<string, MessageValue>>;

type Node =
  | { t: "text"; v: string }
  | { t: "arg"; name: string }
  | { t: "hash" }
  | { t: "plural"; name: string; branches: Branch[] }
  | { t: "select"; name: string; branches: Branch[] };

interface Branch {
  /** `one`, `other`, … or `=0`. */
  selector: string;
  nodes: Node[];
}

class ParseError extends Error {}

function parse(source: string): Node[] {
  let i = 0;

  const readUntilTop = (stopAtBrace: boolean, inPlural: boolean): Node[] => {
    const nodes: Node[] = [];
    let text = "";
    const flush = () => {
      if (text) nodes.push({ t: "text", v: text });
      text = "";
    };
    while (i < source.length) {
      const ch = source[i];
      if (ch === "\\" && i + 1 < source.length && "{}\\#".includes(source[i + 1])) {
        text += source[i + 1];
        i += 2;
      } else if (ch === "}") {
        if (stopAtBrace) break;
        throw new ParseError(`unexpected "}" at ${i}`);
      } else if (ch === "{") {
        flush();
        i++;
        nodes.push(readArgument());
      } else if (ch === "#" && inPlural) {
        flush();
        nodes.push({ t: "hash" });
        i++;
      } else {
        text += ch;
        i++;
      }
    }
    flush();
    return nodes;
  };

  const skipSpace = () => {
    while (i < source.length && /\s/.test(source[i])) i++;
  };

  const readWord = (): string => {
    skipSpace();
    const start = i;
    while (i < source.length && /[\w=.-]/.test(source[i])) i++;
    if (start === i) throw new ParseError(`expected a name at ${i}`);
    return source.slice(start, i);
  };

  const readArgument = (): Node => {
    const name = readWord();
    skipSpace();
    if (source[i] === "}") {
      i++;
      return { t: "arg", name };
    }
    if (source[i] !== ",") throw new ParseError(`expected "," or "}" at ${i}`);
    i++;
    const kind = readWord();
    if (kind !== "plural" && kind !== "select") throw new ParseError(`unknown argument type "${kind}"`);
    skipSpace();
    if (source[i] !== ",") throw new ParseError(`expected "," at ${i}`);
    i++;
    const branches: Branch[] = [];
    for (;;) {
      skipSpace();
      if (source[i] === "}") {
        i++;
        break;
      }
      const selector = readWord();
      skipSpace();
      if (source[i] !== "{") throw new ParseError(`expected "{" after "${selector}"`);
      i++;
      const nodes = readUntilTop(true, kind === "plural");
      if (source[i] !== "}") throw new ParseError("unclosed branch");
      i++;
      branches.push({ selector, nodes });
    }
    if (!branches.some((b) => b.selector === "other")) throw new ParseError(`"${name}" has no "other" branch`);
    return { t: kind, name, branches };
  };

  const nodes = readUntilTop(false, false);
  if (i < source.length) throw new ParseError(`trailing text at ${i}`);
  return nodes;
}

const cache = new Map<string, Node[]>();

/** Parsed form of a message (cached). Throws `Error` on malformed syntax. */
function compile(source: string): Node[] {
  let nodes = cache.get(source);
  if (!nodes) {
    nodes = parse(source);
    cache.set(source, nodes);
  }
  return nodes;
}

/** Every argument name a message uses (plural and select variables included), sorted. */
export function placeholdersOf(source: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.t === "arg") names.add(n.name);
      else if (n.t === "plural" || n.t === "select") {
        names.add(n.name);
        for (const b of n.branches) walk(b.nodes);
      }
    }
  };
  walk(compile(source));
  return [...names].sort();
}

/** `null` when the message parses, otherwise the reason it does not. */
export function messageError(source: string): string | null {
  try {
    compile(source);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export interface FormatContext {
  locale: string;
  plurals: Intl.PluralRules;
  numbers: Intl.NumberFormat;
}

export function formatMessage(source: string, params: MessageParams | undefined, ctx: FormatContext): string {
  let nodes: Node[];
  try {
    nodes = compile(source);
  } catch {
    // A malformed message must never break the page: show it as written.
    return source;
  }
  return render(nodes, params ?? {}, ctx, null);
}

function render(nodes: Node[], params: MessageParams, ctx: FormatContext, hash: number | null): string {
  let out = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        out += n.v;
        break;
      case "hash":
        out += hash === null ? "#" : ctx.numbers.format(hash);
        break;
      case "arg": {
        const v = params[n.name];
        out += v === undefined ? `{${n.name}}` : String(v);
        break;
      }
      case "plural": {
        const raw = params[n.name];
        const value = typeof raw === "number" ? raw : Number(raw);
        const exact = n.branches.find((b) => b.selector === `=${value}`);
        const category = Number.isFinite(value) ? ctx.plurals.select(value) : "other";
        const branch = exact ?? n.branches.find((b) => b.selector === category) ?? n.branches.find((b) => b.selector === "other")!;
        out += render(branch.nodes, params, ctx, Number.isFinite(value) ? value : null);
        break;
      }
      case "select": {
        const key = String(params[n.name] ?? "other");
        const branch = n.branches.find((b) => b.selector === key) ?? n.branches.find((b) => b.selector === "other")!;
        out += render(branch.nodes, params, ctx, hash);
        break;
      }
    }
  }
  return out;
}
