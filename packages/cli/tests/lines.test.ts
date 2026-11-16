import { describe, expect, it } from "vitest";
import { LineIndex } from "../src/lines";

describe("LineIndex", () => {
  it("an empty text has one line and offset 0 is 1:1", () => {
    const ix = new LineIndex("");
    expect(ix.lineCount).toBe(1);
    expect(ix.locate(0)).toEqual({ line: 1, col: 1 });
  });

  it("counts columns from 1 on the first line", () => {
    const ix = new LineIndex("abc");
    expect(ix.locate(0)).toEqual({ line: 1, col: 1 });
    expect(ix.locate(2)).toEqual({ line: 1, col: 3 });
    expect(ix.locate(3)).toEqual({ line: 1, col: 4 });
  });

  it("starts a new line after \\n", () => {
    const ix = new LineIndex("ab\ncd\nef");
    expect(ix.lineCount).toBe(3);
    expect(ix.locate(3)).toEqual({ line: 2, col: 1 });
    expect(ix.locate(7)).toEqual({ line: 3, col: 2 });
  });

  it("treats \\r\\n as one line terminator", () => {
    const ix = new LineIndex("ab\r\ncd\r\nef");
    expect(ix.lineCount).toBe(3);
    expect(ix.locate(4)).toEqual({ line: 2, col: 1 });
    expect(ix.locate(8)).toEqual({ line: 3, col: 1 });
  });

  it("gives the same line numbers for LF and CRLF versions of a text", () => {
    const lf = "a\nbb\nccc\n\nd";
    const crlf = lf.replace(/\n/g, "\r\n");
    const a = new LineIndex(lf);
    const b = new LineIndex(crlf);
    for (const needle of ["a", "bb", "ccc", "d"]) {
      expect(b.locate(crlf.indexOf(needle)).line).toBe(a.locate(lf.indexOf(needle)).line);
      expect(b.locate(crlf.indexOf(needle)).col).toBe(a.locate(lf.indexOf(needle)).col);
    }
  });

  it("an offset between \\r and \\n stays on the line it terminates", () => {
    const ix = new LineIndex("ab\r\ncd");
    expect(ix.locate(3)).toEqual({ line: 1, col: 4 });
  });

  it("treats a lone \\r as a line terminator", () => {
    const ix = new LineIndex("ab\rcd");
    expect(ix.lineCount).toBe(2);
    expect(ix.locate(3)).toEqual({ line: 2, col: 1 });
  });

  it("handles a mix of \\n, \\r\\n and \\r", () => {
    const text = "a\nb\r\nc\rd";
    const ix = new LineIndex(text);
    expect(ix.lineCount).toBe(4);
    expect(ix.locate(text.indexOf("d"))).toEqual({ line: 4, col: 1 });
  });

  it("an offset at the end after a final newline is the start of an empty last line", () => {
    const ix = new LineIndex("a\n");
    expect(ix.lineCount).toBe(2);
    expect(ix.locate(2)).toEqual({ line: 2, col: 1 });
  });

  it("columns count UTF-16 code units: an astral character is two columns", () => {
    const text = "\u{1F600}x";
    const ix = new LineIndex(text);
    expect(text.length).toBe(3);
    expect(ix.locate(text.indexOf("x"))).toEqual({ line: 1, col: 3 });
  });

  it("astral characters before a gradient on a CRLF line", () => {
    const text = "a\r\n/* \u{1F308}\u{1F308} */ linear-gradient(red, blue)";
    const ix = new LineIndex(text);
    const at = text.indexOf("linear");
    expect(ix.locate(at)).toEqual({ line: 2, col: "/* \u{1F308}\u{1F308} */ ".length + 1 });
  });

  it("an offset inside a surrogate pair does not throw and stays on the line", () => {
    const ix = new LineIndex("\u{1F600}");
    expect(ix.locate(1)).toEqual({ line: 1, col: 2 });
  });

  it("clamps negative, NaN, infinite and too-large offsets", () => {
    const ix = new LineIndex("ab\ncd");
    expect(ix.locate(-5)).toEqual({ line: 1, col: 1 });
    expect(ix.locate(Number.NaN)).toEqual({ line: 1, col: 1 });
    expect(ix.locate(Number.POSITIVE_INFINITY)).toEqual({ line: 1, col: 1 });
    expect(ix.locate(999)).toEqual({ line: 2, col: 3 });
  });

  it("truncates fractional offsets", () => {
    expect(new LineIndex("abc").locate(1.9)).toEqual({ line: 1, col: 2 });
  });

  it("range() returns start and exclusive end positions", () => {
    const text = "ab\ncd\nef";
    expect(new LineIndex(text).range(1, 7)).toEqual({ line: 1, col: 2, endLine: 3, endCol: 2 });
  });

  it("agrees with a naive implementation on a mixed text", () => {
    const text = "x\r\nyy\n\u{1F600}z\rw\n\r\nlast";
    const ix = new LineIndex(text);
    for (let o = 0; o <= text.length; o++) {
      let line = 1;
      let lineStart = 0;
      for (let i = 0; i < o; i++) {
        if (text[i] === "\n") {
          line++;
          lineStart = i + 1;
        } else if (text[i] === "\r") {
          if (text[i + 1] === "\n") {
            if (i + 1 < o) i++;
            else continue; // offset between \r and \n: still on this line
          }
          line++;
          lineStart = i + 1;
        }
      }
      const got = ix.locate(o);
      if (text[o - 1] === "\r" && text[o] === "\n") continue; // checked separately above
      expect(got).toEqual({ line, col: o - lineStart + 1 });
    }
  });
});
