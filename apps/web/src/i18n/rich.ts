// ── Messages with a little inline markup ──────────────────────────────────────
// A few sentences carry emphasis or code inside them (`<accent>OKLCH</accent>`,
// `<code>linear-gradient(…)</code>`). The catalogue keeps one whole sentence;
// this turns the formatted text into React nodes. Only the tag names passed in
// `tags` are recognised, so a literal "<120°" in a message stays text.

import { createElement, Fragment, type ReactNode } from "react";

export type RichTags = Readonly<Record<string, (children: string) => ReactNode>>;

export function renderRich(text: string, tags: RichTags): ReactNode {
  const names = Object.keys(tags);
  if (names.length === 0) return text;
  const pattern = new RegExp(`<(${names.join("|")})>([^<]*)</\\1>`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(createElement(Fragment, { key: n++ }, tags[m[1]](m[2])));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
