// ── Component tokenizer ────────────────────────────────────────────────────────
// Splits one slice of CSS text (a gradient argument, or the inside of a colour
// function) into component values with source offsets. It is deliberately not
// a CSS Syntax tokenizer: just enough to recognise colours, numbers with units
// and nested functions, in one forward pass.

export type Token =
  | { type: "ident"; start: number; end: number; value: string }
  | { type: "hash"; start: number; end: number; value: string }
  | { type: "num"; start: number; end: number; value: number; unit: string }
  | { type: "fn"; start: number; end: number; name: string; innerStart: number; innerEnd: number }
  | { type: "slash" | "comma" | "interp" | "other"; start: number; end: number };

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
/** Characters that can continue an identifier (ASCII subset plus any non-ASCII). */
export const isIdentChar = (c: number): boolean =>
  isAlpha(c) || isDigit(c) || c === 45 /* - */ || c === 95 /* _ */ || c > 127;
const isSpace = (c: number): boolean => c === 32 || (c >= 9 && c <= 13);

/** Index just past the `}` matching the `{` at `open` (or `end` when unclosed). */
export function skipBraces(text: string, open: number, end: number): number {
  let depth = 0;
  for (let i = open; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === 123) depth++;
    else if (c === 125 && --depth === 0) return i + 1;
  }
  return end;
}

/** Index just past the string opened by the quote at `open` (ends at its quote, a newline or `end`). */
export function skipString(text: string, open: number, end: number): number {
  const q = text.charCodeAt(open);
  let i = open + 1;
  while (i < end) {
    const c = text.charCodeAt(i);
    if (c === 92 /* \ */) i += 2;
    else if (c === q) return i + 1;
    else if (c === 10) return i;
    else i++;
  }
  return end;
}

/** Index just past the `)` matching the `(` at `open`, or -1 when unbalanced within `end`. */
function matchParen(text: string, open: number, end: number): number {
  let depth = 0;
  let i = open;
  while (i < end) {
    const c = text.charCodeAt(i);
    if (c === 92) {
      i += 2;
    } else if (c === 34 || c === 39) {
      i = skipString(text, i, end);
    } else if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 || close + 2 > end ? end : close + 2;
    } else if (c === 40) {
      depth++;
      i++;
    } else if (c === 41) {
      i++;
      if (--depth === 0) return i;
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Tokens of `text[start, end)`. Whitespace and comments (block comments, and
 * `//` to the end of the line) separate tokens and are dropped. Linear in the
 * slice length.
 */
export function tokenize(text: string, start: number, end: number): Token[] {
  const out: Token[] = [];
  let i = start;
  while (i < end) {
    const c = text.charCodeAt(i);
    const next = i + 1 < end ? text.charCodeAt(i + 1) : 0;

    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === 47 /* / */) {
      if (next === 42) {
        const close = text.indexOf("*/", i + 2);
        i = close === -1 || close + 2 > end ? end : close + 2;
        continue;
      }
      if (next === 47) {
        const nl = text.indexOf("\n", i);
        i = nl === -1 || nl > end ? end : nl;
        continue;
      }
      out.push({ type: "slash", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === 44) {
      out.push({ type: "comma", start: i, end: i + 1 });
      i++;
      continue;
    }
    // Preprocessor / template interpolation: ${…}, #{…}, @{…}, $name, @name.
    if ((c === 36 || c === 35 || c === 64) && next === 123) {
      const stop = skipBraces(text, i + 1, end);
      out.push({ type: "interp", start: i, end: stop });
      i = stop;
      continue;
    }
    if (c === 36 || c === 64) {
      let j = i + 1;
      while (j < end && isIdentChar(text.charCodeAt(j))) j++;
      out.push({ type: "interp", start: i, end: j });
      i = j;
      continue;
    }
    if (c === 35 /* # */) {
      let j = i + 1;
      while (j < end && isIdentChar(text.charCodeAt(j))) j++;
      out.push({ type: "hash", start: i, end: j, value: text.slice(i + 1, j) });
      i = j;
      continue;
    }
    // Number, optionally signed, with an optional unit.
    const signed = c === 43 || c === 45;
    const d0 = signed ? next : c;
    const d1 = i + (signed ? 2 : 1) < end ? text.charCodeAt(i + (signed ? 2 : 1)) : 0;
    if (isDigit(d0) || (d0 === 46 && isDigit(d1))) {
      let j = signed ? i + 1 : i;
      while (j < end && isDigit(text.charCodeAt(j))) j++;
      if (j + 1 < end && text.charCodeAt(j) === 46 && isDigit(text.charCodeAt(j + 1))) {
        j++;
        while (j < end && isDigit(text.charCodeAt(j))) j++;
      } else if (j < end && text.charCodeAt(j) === 46) {
        j++; // "1." is tolerated as 1
      }
      const e = j < end ? text.charCodeAt(j) : 0;
      if (e === 101 || e === 69) {
        const s = j + 1 < end ? text.charCodeAt(j + 1) : 0;
        const k = s === 43 || s === 45 ? j + 2 : j + 1;
        if (k < end && isDigit(text.charCodeAt(k))) {
          j = k;
          while (j < end && isDigit(text.charCodeAt(j))) j++;
        }
      }
      const value = Number(text.slice(i, j));
      const unitStart = j;
      if (j < end && text.charCodeAt(j) === 37) j++;
      else while (j < end && isIdentChar(text.charCodeAt(j))) j++;
      out.push({ type: "num", start: i, end: j, value, unit: text.slice(unitStart, j).toLowerCase() });
      i = j;
      continue;
    }
    if (isIdentChar(c) && !isDigit(c)) {
      let j = i + 1;
      while (j < end && isIdentChar(text.charCodeAt(j))) j++;
      if (j < end && text.charCodeAt(j) === 40) {
        const close = matchParen(text, j, end);
        const stop = close === -1 ? end : close;
        out.push({
          type: "fn",
          start: i,
          end: stop,
          name: text.slice(i, j).toLowerCase(),
          innerStart: j + 1,
          innerEnd: close === -1 ? end : close - 1,
        });
        i = stop;
      } else {
        out.push({ type: "ident", start: i, end: j, value: text.slice(i, j).toLowerCase() });
        i = j;
      }
      continue;
    }
    if (c === 34 || c === 39) {
      const stop = skipString(text, i, end);
      out.push({ type: "other", start: i, end: stop });
      i = stop;
      continue;
    }
    out.push({ type: "other", start: i, end: i + 1 });
    i++;
  }
  return out;
}
