import { describe, expect, it } from "vitest";
import { compileIgnore } from "../src/glob";

const m = (patterns: string[], path: string): boolean => compileIgnore(patterns).matches(path);

describe("compileIgnore", () => {
  it("matches nothing without patterns", () => {
    expect(m([], "a/b.css")).toBe(false);
  });

  it("a plain name matches any path segment (like .gitignore)", () => {
    expect(m(["vendor"], "vendor/a.css")).toBe(true);
    expect(m(["vendor"], "src/vendor/a.css")).toBe(true);
    expect(m(["vendor"], "src/vendors/a.css")).toBe(false);
  });

  it("a plain name matches a file basename", () => {
    expect(m(["reset.css"], "src/reset.css")).toBe(true);
    expect(m(["reset.css"], "src/reset.scss")).toBe(false);
  });

  it("* matches within one segment", () => {
    expect(m(["*.min.css"], "dist/app.min.css")).toBe(true);
    expect(m(["*.min.css"], "app.css")).toBe(false);
    expect(m(["a*c"], "abc")).toBe(true);
    expect(m(["a*c"], "ac")).toBe(true);
  });

  it("? matches exactly one character", () => {
    expect(m(["a?.css"], "ab.css")).toBe(true);
    expect(m(["a?.css"], "a.css")).toBe(false);
    expect(m(["a?.css"], "abc.css")).toBe(false);
  });

  it("a pattern with a slash is anchored at the working directory", () => {
    expect(m(["src/legacy"], "src/legacy/a.css")).toBe(true);
    expect(m(["src/legacy"], "lib/src/legacy/a.css")).toBe(false);
  });

  it("a leading ./ and a trailing / are ignored", () => {
    expect(m(["./src/legacy/"], "src/legacy/a.css")).toBe(true);
  });

  it("* does not cross a slash", () => {
    expect(m(["src/*.css"], "src/a.css")).toBe(true);
    expect(m(["src/*.css"], "src/deep/a.css")).toBe(false);
  });

  it("** crosses slashes", () => {
    expect(m(["src/**/*.css"], "src/a/b/c.css")).toBe(true);
    expect(m(["src/**/*.css"], "src/c.css")).toBe(true);
    expect(m(["src/**"], "src/a/b/c.css")).toBe(true);
    expect(m(["**/generated/*.css"], "x/y/generated/a.css")).toBe(true);
    expect(m(["**/generated/*.css"], "generated/a.css")).toBe(true);
  });

  it("matches when a parent directory matches", () => {
    expect(m(["src/legacy"], "src/legacy")).toBe(true);
    expect(m(["a/b"], "a/b/c/d.css")).toBe(true);
  });

  it("escapes regular-expression characters in literals", () => {
    expect(m(["a+b.css"], "a+b.css")).toBe(true);
    expect(m(["a+b.css"], "aab.css")).toBe(false);
    expect(m(["(x)[y]{z}.css"], "(x)[y]{z}.css")).toBe(true);
    expect(m(["a.css"], "aXcss")).toBe(false);
  });

  it("accepts several patterns", () => {
    expect(m(["foo", "*.snap"], "x/a.snap")).toBe(true);
    expect(m(["foo", "*.snap"], "x/foo/a.css")).toBe(true);
    expect(m(["foo", "*.snap"], "x/a.css")).toBe(false);
  });

  it("ignores empty and dot patterns", () => {
    expect(m(["", " ", ".", "./"], "a.css")).toBe(false);
  });

  it("normalises backslashes in patterns", () => {
    expect(m(["src\\legacy"], "src/legacy/a.css")).toBe(true);
  });

  it("collapses long runs of ** without catastrophic backtracking", () => {
    const start = Date.now();
    const pattern = "**/".repeat(40) + "x.css";
    expect(m([pattern], "a/".repeat(60) + "y.css")).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
