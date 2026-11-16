// Offset → line/column. Offsets are UTF-16 code units (what the parser returns
// and what `String.prototype.slice` takes); lines and columns are 1-based and
// columns count UTF-16 code units too, like TypeScript, ESLint and LSP do by
// default (an emoji is two columns wide).

export interface Loc {
  line: number;
  col: number;
}

export interface RangeLoc {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

/**
 * Index of the line starts of a text. `\n`, `\r\n` and a lone `\r` each end a
 * line; `\r\n` is one terminator, so a CRLF file numbers its lines like an
 * LF file does. Building the index is linear; each lookup is a binary search.
 */
export class LineIndex {
  private readonly starts: number[] = [0];
  readonly length: number;

  constructor(text: string) {
    this.length = text.length;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 10) {
        this.starts.push(i + 1);
      } else if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) i++;
        this.starts.push(i + 1);
      }
    }
  }

  /** Number of lines (an empty text has one). */
  get lineCount(): number {
    return this.starts.length;
  }

  /**
   * Line and column of an offset. Offsets are clamped to `[0, length]`; a
   * non-integer or NaN offset counts as 0. An offset inside a `\r\n` pair
   * reports the end of the line it terminates.
   */
  locate(offset: number): Loc {
    let o = Number.isFinite(offset) ? Math.trunc(offset) : 0;
    if (o < 0) o = 0;
    if (o > this.length) o = this.length;
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.starts[mid] <= o) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: o - this.starts[lo] + 1 };
  }

  /** Start and (exclusive) end of a half-open range. */
  range(start: number, end: number): RangeLoc {
    const a = this.locate(start);
    const b = this.locate(end);
    return { line: a.line, col: a.col, endLine: b.line, endCol: b.col };
  }
}
