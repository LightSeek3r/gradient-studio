// Lint-ish guard: user-visible text in a .tsx component must come from the
// catalogue (t(...)). Scans every apps/web/src/**/*.tsx with the TypeScript
// parser for
//   * JSX text with letters,
//   * string / template literals with letters inside JSX expressions,
//   * string / template literals with letters in user-facing attributes
//     (aria-label, title, placeholder, alt, label, okLabel, …),
// that are not on the allow-list of technical tokens below. A new hard-coded
// string therefore fails CI. (Pure .ts modules take a translator instead.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const SRC = new URL("../src", import.meta.url).pathname;

/** Attributes whose value a person reads or hears. */
const USER_FACING = new Set([
  "aria-label",
  "aria-valuetext",
  "aria-description",
  "aria-roledescription",
  "aria-placeholder",
  "title",
  "placeholder",
  "alt",
  "label",
  "ariaLabel",
  "okLabel",
  "errLabel",
  "okMessage",
  "errMessage",
  "message",
  "intro",
  "description",
  "summary",
]);

/**
 * Technical tokens that are the same in every language: brand names, colour
 * notation names, CSS and code samples. Anything else with letters must be a
 * catalogue message.
 */
const ALLOWED = new Set([
  "Gradient Studio",
  "GitHub",
  "OKLCH +180°",
  "#4F46E5", // placeholder: a hex colour
  "indigo", // placeholder: a CSS colour name (CSS keywords stay English)
  "linear-gradient(135deg, #ff6b6b 0%, #4ecdc4 50%, #1a535c 100%)", // placeholder: CSS
  "R",
  "G",
  "B",
  "H",
  "S",
  "L",
]);

function listTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listTsx(full) : full.endsWith(".tsx") ? [full] : [];
  });
}

const hasLetters = (text: string) => /\p{L}/u.test(text);

interface Finding {
  file: string;
  line: number;
  text: string;
}

function scan(file: string): Finding[] {
  return scanSource(relative(SRC, file), readFileSync(file, "utf8"));
}

function scanSource(name: string, source: string): Finding[] {
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const found: Finding[] = [];
  const report = (node: ts.Node, text: string) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!hasLetters(trimmed) || ALLOWED.has(trimmed)) return;
    found.push({ file: name, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: trimmed });
  };
  /** Text of a string-ish literal, or null for anything else (identifiers, calls, …). */
  const literalText = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
    return null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text);
    else if (ts.isJsxAttribute(node) && USER_FACING.has(node.name.getText()) && node.initializer) {
      const init = node.initializer;
      const direct = literalText(init);
      if (direct !== null) report(init, direct);
      else if (ts.isJsxExpression(init) && init.expression) {
        const text = literalText(init.expression);
        if (text !== null) report(init, text);
      }
    } else if (ts.isJsxExpression(node) && node.parent && !ts.isJsxAttribute(node.parent) && node.expression) {
      // {"text"} or {`text`} as a JSX child; also the branches of {cond ? "a" : "b"} and {x && "a"}.
      const leaves: ts.Node[] = [];
      const collect = (e: ts.Node) => {
        if (ts.isConditionalExpression(e)) {
          collect(e.whenTrue);
          collect(e.whenFalse);
        } else if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
          collect(e.right);
        } else if (ts.isParenthesizedExpression(e)) {
          collect(e.expression);
        } else leaves.push(e);
      };
      collect(node.expression);
      for (const leaf of leaves) {
        const text = literalText(leaf);
        if (text !== null) report(leaf, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("no hard-coded user-visible strings in components", () => {
  const files = listTsx(SRC);

  it("finds the components to scan", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("the scanner catches JSX text, attributes and expression literals (canary)", () => {
    const bad = `export const A = () => (
      <div title="Hello there" aria-label={\`Stop \${n}\`}>
        Plain words
        {open ? "Open" : t("x")}
        <b>{"Quoted"}</b>
        <input placeholder="#4F46E5" className="not-text" data-x="Fine" />
      </div>
    );`;
    const texts = scanSource("canary.tsx", bad).map((f) => f.text);
    expect(texts).toEqual(["Hello there", "Stop", "Plain words", "Open", "Quoted"]);
    expect(scanSource("ok.tsx", `export const A = () => <p title={t("a")}>{t("b")} 12 · %</p>;`)).toEqual([]);
  });

  for (const file of files) {
    it(`${relative(SRC, file)} routes every visible string through t()`, () => {
      expect(scan(file), JSON.stringify(scan(file))).toEqual([]);
    });
  }
});
