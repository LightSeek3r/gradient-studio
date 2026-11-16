import { describe, expect, it } from "vitest";
import { parseGradient, scoreParsed } from "@opal42/gradient";
import { fixBlock, fixGradientText } from "../src/fix";
import type { Report } from "../src/types";
import { cli, failingFs, fixtureCopy, put, read, tempDir } from "./helpers";

const json = (s: string): Report => JSON.parse(s) as Report;
const scores = (css: string): (number | null)[] =>
  parseGradient(css).gradients.map((g) => {
    const r = scoreParsed(g);
    return r.status === "ok" ? r.score : null;
  });

const BAD = "linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff)";

describe("score --fix", () => {
  it("rewrites only gradients whose score improves, and reports each change", async () => {
    const cwd = await fixtureCopy();
    const before = await read(cwd, "rough.css");
    const r = await cli(["score", "--fix", "rough.css"], { cwd });
    expect(r.code).toBe(0);
    const after = await read(cwd, "rough.css");
    expect(after).not.toBe(before);
    expect(r.stdout).toMatch(/fixed: smoothness score 58 -> 90/);
    expect(r.stdout).toMatch(/fixed 3 gradients/);
    // The hard-stop gradient and the already-fine one keep their text.
    expect(after).toContain("linear-gradient(90deg, #e63946 0%, #e63946 50%, #1d3557 50%, #1d3557 100%)");
  });

  it("every fixed gradient scores higher than before", async () => {
    const cwd = await fixtureCopy();
    const before = scores(await read(cwd, "rough.css"));
    await cli(["score", "--fix", "rough.css"], { cwd });
    const after = scores(await read(cwd, "rough.css"));
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!).toBeGreaterThanOrEqual(before[i]!);
    }
    expect(after[0]).toBeGreaterThan(before[0]!);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const cwd = await fixtureCopy();
    await cli(["score", "--fix", "."], { cwd });
    const once = await Promise.all(["rough.css", "smooth.css", "card.vue", "page.html", "theme.ts", "notes.md"].map((f) => read(cwd, f)));
    const second = await cli(["score", "--fix", "--json", "."], { cwd });
    const twice = await Promise.all(["rough.css", "smooth.css", "card.vue", "page.html", "theme.ts", "notes.md"].map((f) => read(cwd, f)));
    expect(twice).toEqual(once);
    expect(json(second.stdout).summary).toMatchObject({ fixable: 0, fixed: 0 });
  });

  it("is idempotent for refine --write as well", async () => {
    const cwd = await fixtureCopy();
    await cli(["refine", "--write", "rough.css"], { cwd });
    const once = await read(cwd, "rough.css");
    const again = await cli(["refine", "--write", "--json", "rough.css"], { cwd });
    expect(await read(cwd, "rough.css")).toBe(once);
    expect(json(again.stdout).summary.fixed).toBe(0);
  });

  it("--dry-run reports the change and writes nothing", async () => {
    const cwd = await fixtureCopy();
    const before = await read(cwd, "rough.css");
    const r = await cli(["score", "--fix", "--dry-run", "rough.css"], { cwd });
    expect(r.code).toBe(0);
    expect(await read(cwd, "rough.css")).toBe(before);
    expect(r.stdout).toMatch(/nothing written \(--dry-run\)/);
    expect(r.stdout).toMatch(/\+ linear-gradient\(90deg, #f500a6 0%, #ff0000 50%, #7e00d0 100%\)/);
  });

  it("never touches skipped gradients", async () => {
    const cwd = await fixtureCopy();
    const before = await read(cwd, "skipped.css");
    const r = await cli(["score", "--fix", "skipped.css"], { cwd });
    expect(r.code).toBe(0);
    expect(await read(cwd, "skipped.css")).toBe(before);
  });

  it("does not rewrite a file with nothing to fix (mtime-safe: no write call)", async () => {
    const cwd = await tempDir();
    await put(cwd, "ok.css", "a { background: linear-gradient(#fef3c7, #fde68a, #f59e0b); }\n");
    const fs = failingFs(() => true, "EROFS", ["writeFile"]);
    const r = await cli(["score", "--fix", "ok.css"], { cwd, fs });
    expect(r.code).toBe(0);
  });

  it("keeps everything outside the stop arguments byte for byte", async () => {
    const cwd = await tempDir();
    const src = `/* head */\n.a {\n  background: ${BAD}; /* keep me */\n}\n.b { color: red }\n`;
    await put(cwd, "a.css", src);
    await cli(["score", "--fix", "a.css"], { cwd });
    const out = await read(cwd, "a.css");
    expect(out.startsWith("/* head */\n.a {\n  background: linear-gradient(90deg, ")).toBe(true);
    expect(out.endsWith("); /* keep me */\n}\n.b { color: red }\n")).toBe(true);
  });

  it("preserves the direction text, interpolation clause, comments and layout between stops", async () => {
    const cwd = await tempDir();
    const src = `a { background: linear-gradient(\n    to right in oklch,\n    #ff0000 /* start */,\n    #00ff00 50%,\n    #0000ff\n  ); }\n`;
    await put(cwd, "a.css", src);
    const r = await cli(["score", "--fix", "a.css"], { cwd });
    expect(r.stdout).toMatch(/fixed/);
    const out = await read(cwd, "a.css");
    expect(out).toMatch(/^a \{ background: linear-gradient\(\n {4}to right in oklch,\n {4}#[0-9a-f]{6} 0% \/\* start \*\/,\n {4}#[0-9a-f]{6} 50%,\n {4}#[0-9a-f]{6} 100%\n {2}\); \}\n$/);
  });

  it("keeps a stop's original text when its colour and position do not change", async () => {
    const out = fixGradientText("linear-gradient(red, lime, blue)");
    expect(out).not.toBeNull();
    // the middle stop is rewritten (new colour), the text of any untouched stop would stay
    expect(out!.text).toMatch(/^linear-gradient\(#[0-9a-f]{6} 0%, #[0-9a-f]{6} 50%, #[0-9a-f]{6} 100%\)$/);
  });

  it("preserves CRLF line endings", async () => {
    const cwd = await tempDir();
    const src = `.a {\r\n  background: linear-gradient(\r\n    90deg,\r\n    #ff0000,\r\n    #00ff00 50%,\r\n    #0000ff\r\n  );\r\n}\r\n`;
    await put(cwd, "crlf.css", src);
    await cli(["score", "--fix", "crlf.css"], { cwd });
    const out = await read(cwd, "crlf.css");
    expect(out).not.toBe(src);
    expect(out.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(out.split("\r\n")).toHaveLength(src.split("\r\n").length);
  });

  it("CRLF files fix to the same result as LF files", async () => {
    const lf = `a {\n  background: ${BAD};\n}\n`;
    const dir = await tempDir();
    await put(dir, "lf.css", lf);
    await put(dir, "crlf.css", lf.replace(/\n/g, "\r\n"));
    await cli(["score", "--fix", "lf.css", "crlf.css"], { cwd: dir });
    expect((await read(dir, "crlf.css")).replace(/\r\n/g, "\n")).toBe(await read(dir, "lf.css"));
  });

  it("keeps a UTF-8 BOM", async () => {
    const cwd = await tempDir();
    await put(cwd, "bom.css", `\uFEFFa { background: ${BAD}; }\n`);
    await cli(["score", "--fix", "bom.css"], { cwd });
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(`${cwd}/bom.css`);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).not.toContain(BAD);
  });

  it("keeps non-ASCII text around the gradient", async () => {
    const cwd = await tempDir();
    await put(cwd, "u.css", `/* café \u{1F308} */ a { background: ${BAD}; } /* 日本 */\n`);
    await cli(["score", "--fix", "u.css"], { cwd });
    const out = await read(cwd, "u.css");
    expect(out.startsWith("/* café \u{1F308} */ a { background: linear-gradient(")).toBe(true);
    expect(out.endsWith("); } /* 日本 */\n")).toBe(true);
  });

  it("fixes several gradients on one line and in embedded containers", async () => {
    const cwd = await tempDir();
    await put(cwd, "c.vue", `<div style="background: ${BAD}" :style="{ x: '${BAD}' }"></div>\n`);
    const r = await cli(["score", "--fix", "--json", "c.vue"], { cwd });
    expect(json(r.stdout).summary).toMatchObject({ fixable: 2, fixed: 2 });
    const out = await read(cwd, "c.vue");
    expect(out).not.toContain(BAD);
    expect(out.match(/linear-gradient\(/g)).toHaveLength(2);
  });

  it("leaves gradients with colour hints alone (a rewrite would drop the hint)", async () => {
    const cwd = await tempDir();
    const src = `a { background: linear-gradient(90deg, #ff0000, 30%, #00ff00 50%, #0000ff); }\n`;
    await put(cwd, "h.css", src);
    const r = await cli(["score", "--fix", "h.css"], { cwd });
    expect(r.code).toBe(0);
    expect(await read(cwd, "h.css")).toBe(src);
  });

  it("leaves gradients with double-position stops alone", async () => {
    const cwd = await tempDir();
    const src = `a { background: linear-gradient(90deg, #ff0000 0% 20%, #00ff00 50%, #0000ff); }\n`;
    await put(cwd, "d.css", src);
    await cli(["score", "--fix", "d.css"], { cwd });
    expect(await read(cwd, "d.css")).toBe(src);
  });

  it("leaves hard-stop gradients alone", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--fix", "--json", "rough.css"], { cwd });
    const split = json(r.stdout).files[0].gradients[4];
    expect(split.fix).toBeUndefined();
  });

  it("applies --min-score to the scores after fixing", async () => {
    const cwd = await tempDir();
    await put(cwd, "a.css", `a { background: ${BAD}; }\n`);
    const dry = await cli(["score", "--fix", "--dry-run", "--min-score", "80", "a.css"], { cwd });
    expect(dry.code).toBe(1);
    const real = await cli(["score", "--fix", "--min-score", "80", "a.css"], { cwd });
    expect(real.code).toBe(0);
  });

  it("a write failure is an I/O error (exit 3) and the report says so", async () => {
    const cwd = await tempDir();
    await put(cwd, "a.css", `a { background: ${BAD}; }\n`);
    const fs = failingFs((p) => p.endsWith("a.css"), "EACCES", ["writeFile"]);
    const r = await cli(["score", "--fix", "--json", "a.css"], { cwd, fs });
    expect(r.code).toBe(3);
    const f = json(r.stdout).files[0];
    expect(f).toMatchObject({ status: "error", error: { code: "EACCES" } });
    expect(f.gradients[0].fix?.applied).toBe(false);
    expect(await read(cwd, "a.css")).toContain(BAD);
  });

  it("JSON describes each fix", async () => {
    const cwd = await tempDir();
    await put(cwd, "a.css", `a { background: ${BAD}; }\n`);
    const r = await cli(["score", "--fix", "--json", "a.css"], { cwd });
    const g = json(r.stdout).files[0].gradients[0];
    expect(g.fix).toMatchObject({ applied: true, scoreBefore: 58, scoreAfter: 90, original: BAD });
    expect(g.fix!.replacement).toBe(await read(cwd, "a.css").then((t) => t.slice(16, 16 + g.fix!.replacement.length)));
    expect(json(r.stdout).files[0].rewritten).toBe(true);
  });

  it("with --format github, a refinement is a notice", async () => {
    const cwd = await tempDir();
    await put(cwd, "a.css", `a { background: ${BAD}; }\n`);
    const r = await cli(["refine", "--format", "github", "a.css"], { cwd });
    expect(r.stdout).toMatch(/^::notice file=a\.css,line=1,col=17.*title=opal42 refinement available::smoothness score 58 -> 90 with /m);
  });
});

describe("refine", () => {
  it("without --write changes no file", async () => {
    const cwd = await fixtureCopy();
    const before = await read(cwd, "rough.css");
    const r = await cli(["refine", "rough.css"], { cwd });
    expect(r.code).toBe(0);
    expect(await read(cwd, "rough.css")).toBe(before);
    expect(r.stdout).toMatch(/run with --write to apply/);
  });

  it("--write rewrites the files", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["refine", "--write", "rough.css"], { cwd });
    expect(r.code).toBe(0);
    expect(await read(cwd, "rough.css")).not.toContain(BAD);
    expect(r.stdout).toMatch(/fixed 3 gradients/);
  });

  it("says so when nothing can be refined", async () => {
    const cwd = await tempDir();
    await put(cwd, "ok.css", "a { background: linear-gradient(#fef3c7, #fde68a, #f59e0b); }\n");
    const r = await cli(["refine", "ok.css"], { cwd });
    expect(r.stdout).toMatch(/no gradient can be refined further/);
  });
});

describe("fixing standard input", () => {
  it("prints the rewritten text on stdout and the report on stderr", async () => {
    const cwd = await tempDir();
    const src = `a { background: ${BAD}; }\n`;
    const r = await cli(["score", "--fix", "-"], { cwd, stdin: src });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^a \{ background: linear-gradient\(90deg, #[0-9a-f]{6} 0%/);
    expect(r.stdout.endsWith("; }\n")).toBe(true);
    expect(r.stderr).toMatch(/fixed: smoothness score 58 -> 90/);
  });

  it("passes the input through unchanged when nothing improves", async () => {
    const src = "a { background: linear-gradient(#fef3c7, #fde68a, #f59e0b); }\n";
    const r = await cli(["refine", "--write", "-"], { cwd: await tempDir(), stdin: src });
    expect(r.stdout).toBe(src);
  });

  it("--dry-run prints the report on stdout and no text", async () => {
    const r = await cli(["score", "--fix", "--dry-run", "-"], { cwd: await tempDir(), stdin: `a { background: ${BAD}; }\n` });
    expect(r.stdout).toMatch(/smoothness score 58\/100/);
    expect(r.stdout).not.toMatch(/^a \{/);
  });

  it("refine - (no --write) is a dry run", async () => {
    const r = await cli(["refine", "-"], { cwd: await tempDir(), stdin: `a { background: ${BAD}; }\n` });
    expect(r.stdout).toMatch(/refinement available: smoothness score 58 -> 90/);
  });
});

describe("fixGradientText", () => {
  it("returns null for skipped, hard-stop and already-optimal gradients", () => {
    expect(fixGradientText("linear-gradient(red, var(--x))")).toBeNull();
    expect(fixGradientText("radial-gradient(red, blue)")).toBeNull();
    expect(fixGradientText("linear-gradient(90deg, #e63946 50%, #1d3557 50%)")).toBeNull();
    expect(fixGradientText("linear-gradient(#fef3c7, #fde68a, #f59e0b)")).toBeNull();
    expect(fixGradientText("not a gradient")).toBeNull();
  });

  it("reaches a fixed point: fixing the output finds nothing more", () => {
    for (const src of [BAD, "linear-gradient(to right, #111111, #eeeeee, #222222)", "linear-gradient(90deg, #ff6b6b 0%, #ffd93d 5%, #6bcb77 10%, #4d96ff 100%)"]) {
      const first = fixGradientText(src);
      if (first) expect(fixGradientText(first.text)).toBeNull();
    }
  });

  it("never lowers the score and reports before/after truthfully", () => {
    const r = fixGradientText(BAD)!;
    expect(scores(BAD)).toEqual([r.before]);
    expect(scores(r.text)).toEqual([r.after]);
    expect(r.after).toBeGreaterThan(r.before);
  });

  it("fixBlock names why a gradient is left alone", () => {
    const block = (css: string) => fixBlock(parseGradient(css).gradients[0]);
    expect(block("linear-gradient(red, 30%, blue)")).toBe("hints");
    expect(block("linear-gradient(red 0% 20%, blue)")).toBe("double-position");
    expect(block("linear-gradient(red, var(--x))")).toBe("unparseable");
    expect(block("linear-gradient(red, blue)")).toBeNull();
  });
});
