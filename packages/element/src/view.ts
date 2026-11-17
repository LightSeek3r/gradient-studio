// ── DOM rendering ──────────────────────────────────────────────────────────────
// Everything is built with createElement / textContent / setAttribute of fixed
// names. No innerHTML, no insertAdjacentHTML, no template strings of markup. The
// only values that reach a `style` are an integer percentage and the swatch
// strings that analyze.ts rebuilt with toCSS and matched against an allow-list;
// they are set through the CSS object model (style.setProperty), which strict
// CSPs allow.

import type { ElementResult } from "./analyze";
import type { Translate } from "./messages";

type Doc = Document;

export interface ViewOptions {
  showIssues: boolean;
  showFix: boolean;
  compact: boolean;
  /** Accessible name prefix of the group. */
  label: string;
}

export interface Skeleton {
  card: HTMLElement;
  content: HTMLElement;
  live: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Doc, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Applies validated background values; later declarations the browser rejects leave the earlier one in place. */
export function paintSwatch(node: HTMLElement, backgrounds: readonly string[]): void {
  for (const value of backgrounds) node.style.setProperty("background-image", value);
}

function swatch(doc: Doc, backgrounds: readonly string[], label: string, cls = "swatch"): HTMLElement {
  const node = el(doc, "div", cls);
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", label);
  node.setAttribute("part", "swatch");
  paintSwatch(node, backgrounds);
  return node;
}

/** The swatch label built from validated hex colours only. */
export function swatchLabel(t: Translate, key: string, stops: readonly string[]): string {
  if (stops.length === 0) return t("preview.none");
  return t(key, { first: stops[0], last: stops[stops.length - 1], count: stops.length });
}

/** Creates the persistent frame: the group (named), the replaceable content and the polite live region. */
export function createSkeleton(doc: Doc): Skeleton {
  const card = el(doc, "div", "card");
  card.setAttribute("role", "group");
  card.setAttribute("part", "card");
  const content = el(doc, "div", "content");
  const live = el(doc, "div", "vh");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  card.append(content, live);
  return { card, content, live };
}

/** The group's accessible name for a result. */
export function groupName(r: ElementResult, o: ViewOptions, t: Translate): string {
  const label = o.label;
  if (r.status === "ok") return t("group.ok", { label, score: r.score ?? 0 });
  if (r.status === "skipped") return t("group.skipped", { label });
  if (r.status === "invalid") return t("group.invalid", { label });
  return t("group.empty", { label });
}

/** The sentence for the polite live region. */
export function liveText(r: ElementResult, t: Translate): string {
  if (r.status === "ok") {
    const n = r.findings.length;
    return t("live.ok", { score: r.score ?? 0, count: t(n === 1 ? "count.one" : "count.other", { n }) });
  }
  if (r.status === "skipped") return t("live.skipped", { reason: r.skipped?.reason ?? "" });
  if (r.status === "invalid") return t("live.invalid", { message: invalidText(r, t) });
  return t("live.empty");
}

function invalidText(r: ElementResult, t: Translate): string {
  const code = r.invalid?.code ?? "internal";
  return t(`invalid.${code}`, { index: r.invalid?.index ?? r.index, count: r.gradients });
}

function ruleName(t: Translate, code: string): string {
  const key = `rule.${code}.name`;
  return t.has(key) ? t(key) : (code.split("/").pop() ?? code).replace(/-/g, " ");
}

/** Builds the card body for `r`. `issuesOpen` is the user's choice (null = the default). */
export function renderContent(
  doc: Doc,
  r: ElementResult,
  o: ViewOptions,
  t: Translate,
  state: { issuesOpen: boolean | null; onToggle: (open: boolean) => void },
): DocumentFragment {
  const out = doc.createDocumentFragment();
  const card = (n: Node) => out.append(n);

  if (r.truncated) {
    const n = el(doc, "p", "notice", t("truncated"));
    n.setAttribute("data-key", "notice");
    card(n);
  }

  if (r.status === "empty") {
    card(el(doc, "p", "empty", t("empty")));
    return out;
  }
  if (r.status === "invalid") {
    card(el(doc, "p", "empty", invalidText(r, t)));
    return out;
  }

  // Swatch and score.
  const top = el(doc, "div", "top");
  if (r.swatch.length) {
    const wrap = el(doc, "div", "swatch-wrap");
    wrap.append(swatch(doc, r.swatch, swatchLabel(t, "swatch.label", r.stops)));
    top.append(wrap);
  }
  const score = el(doc, "div", "score");
  score.setAttribute("part", "score");
  score.append(el(doc, "span", "score-label", t("score.name")));
  const value = el(doc, "span", "score-value");
  if (r.status === "ok" && r.score !== null) {
    value.append(el(doc, "strong", undefined, String(r.score)), el(doc, "span", "out", t("score.outOf")));
    const bar = el(doc, "div", "bar");
    bar.setAttribute("aria-hidden", "true");
    const fill = el(doc, "div", "fill");
    fill.style.setProperty("width", `${Math.max(0, Math.min(100, Math.round(r.score)))}%`);
    bar.append(fill);
    score.append(value, bar);
  } else {
    value.append(el(doc, "span", "none", t("score.none")));
    score.append(value);
  }
  top.append(score);
  card(top);

  if (r.gradients > 1) card(el(doc, "p", "note", t("multi", { n: r.index + 1, count: r.gradients })));

  if (r.status === "skipped" && r.skipped) {
    const box = el(doc, "div", "skipped");
    box.setAttribute("part", "skipped");
    box.append(el(doc, "p", "skipped-title", t("skipped.title")), el(doc, "p", "skipped-reason", t("skipped.intro")));
    const why = t.has(`skipped.${r.skipped.code}`) ? t(`skipped.${r.skipped.code}`) : r.skipped.reason;
    box.append(el(doc, "p", "skipped-reason", `${why} (${r.skipped.code})`));
    card(box);
    return out;
  }

  if (o.showIssues) {
    if (r.findings.length === 0) {
      card(el(doc, "p", "note", t("issues.none")));
    } else {
      const details = el(doc, "details");
      details.setAttribute("part", "issues");
      details.open = state.issuesOpen ?? !o.compact;
      details.addEventListener("toggle", () => state.onToggle(details.open));
      const summary = el(doc, "summary", undefined, t("issues.summary", { n: r.findings.length }));
      summary.setAttribute("data-key", "issues-summary");
      const list = el(doc, "ul");
      for (const f of r.findings) {
        const li = el(doc, "li", "issue");
        li.setAttribute("data-code", f.code);
        li.setAttribute("data-severity", f.severity);
        const head = el(doc, "div", "issue-head");
        head.append(
          el(doc, "span", "issue-name", ruleName(t, f.code)),
          el(doc, "span", "badge", t(`severity.${f.severity}`)),
          el(doc, "span", "pts", t("issue.points", { n: f.pointsLost })),
        );
        li.append(head);
        if (!o.compact) {
          const key = `rule.${f.code}.measures`;
          li.append(el(doc, "p", "issue-text", t.has(key) ? t(key) : f.message), el(doc, "code", "issue-code", f.code));
        }
        list.append(li);
      }
      details.append(summary, list);
      card(details);
    }
  }

  if (o.showFix && r.status === "ok" && r.findings.length > 0) {
    const fix = el(doc, "section", "fix");
    fix.setAttribute("part", "fix");
    const h = el(doc, "p", "fix-title", t("fix.title"));
    fix.append(h);
    if (r.fix) {
      const body = el(doc, "div", "fix-body");
      if (r.fix.swatch.length) body.append(swatch(doc, r.fix.swatch, t("fix.swatch")));
      const text = el(doc, "div");
      text.append(el(doc, "span", "fix-label", `${r.fix.label} `));
      text.append(el(doc, "span", "fix-gain", t("fix.gain", { n: r.fix.gain, before: r.fix.before, after: r.fix.after })));
      body.append(text);
      fix.append(body, el(doc, "code", "fix-css", r.fix.css), el(doc, "p", "note", t("fix.note")));
    } else {
      fix.append(el(doc, "p", "note", t("fix.none")));
    }
    card(fix);
  }
  return out;
}

/** The preview swatch for a result (or an inert empty box). */
export function renderPreview(doc: Doc, r: ElementResult, t: Translate, name: string | null): HTMLElement {
  const label = name ? name : swatchLabel(t, "preview.label", r.stops);
  const node = swatch(doc, r.swatch, label);
  node.removeAttribute("part");
  node.setAttribute("part", "swatch");
  return node;
}
