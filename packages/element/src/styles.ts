// ── Encapsulated styles ────────────────────────────────────────────────────────
// Public theming surface (CSS custom properties, inherited into the shadow
// root): --opal42-bg, --opal42-fg, --opal42-accent, --opal42-radius. Internal
// names start with `--o-`. Defaults follow prefers-color-scheme; forced-colors
// switches to system colours. Foreground/background pairs are chosen for at least
// 4.5:1 contrast in both schemes (checked in a real browser, docs/element.md).

const TOKENS = `
:host {
  --o-bg: var(--opal42-bg, #ffffff);
  --o-fg: var(--opal42-fg, #1a1a22);
  --o-muted: color-mix(in srgb, var(--o-fg) 72%, var(--o-bg));
  --o-line: color-mix(in srgb, var(--o-fg) 28%, var(--o-bg));
  --o-accent: var(--opal42-accent, #2a4bd0);
  --o-radius: var(--opal42-radius, 10px);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :host {
    --o-bg: var(--opal42-bg, #16161c);
    --o-fg: var(--opal42-fg, #ececf2);
    --o-accent: var(--opal42-accent, #9db1ff);
  }
}
`;

const SWATCH = `
.swatch {
  display: block;
  border-radius: calc(var(--o-radius) - 2px);
  border: 1px solid var(--o-line);
  background-color: var(--o-bg);
  background-image: none;
  forced-color-adjust: none;
}
.swatch:empty { min-height: 1px; }
`;

const FORCED = `
@media (forced-colors: active) {
  :host { --o-bg: Canvas; --o-fg: CanvasText; --o-muted: CanvasText; --o-line: CanvasText; --o-accent: Highlight; }
  .card { border-color: CanvasText; }
  .fill { background: Highlight; forced-color-adjust: none; }
  .bar { border: 1px solid CanvasText; background: Canvas; }
  summary:focus-visible, .card:focus-visible { outline: 2px solid Highlight; }
}
`;

export const PREVIEW_CSS = `${TOKENS}
:host { display: block; height: 4rem; min-width: 2rem; }
:host([hidden]) { display: none; }
.swatch { height: 100%; width: 100%; box-sizing: border-box; }
${SWATCH}
@media (forced-colors: active) { :host { --o-line: CanvasText; } }
`;

export const SCORE_CSS = `${TOKENS}
:host { display: block; max-width: 36rem; }
:host([hidden]) { display: none; }
*, *::before, *::after { box-sizing: border-box; }
.card {
  background: var(--o-bg);
  color: var(--o-fg);
  border: 1px solid var(--o-line);
  border-radius: var(--o-radius);
  padding: 0.875rem;
  font: 0.9375rem/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.card > * + * { margin-block-start: 0.75rem; }
.top { display: flex; gap: 0.875rem; align-items: stretch; }
.swatch-wrap { flex: 0 0 8rem; min-height: 4.5rem; display: flex; }
.swatch-wrap .swatch { flex: 1; min-height: 4.5rem; }
.score { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 0.25rem; }
.score-label { color: var(--o-muted); font-size: 0.8125rem; }
.score-value { display: flex; align-items: baseline; gap: 0.375rem; flex-wrap: wrap; }
.score-value strong { font-size: 2rem; line-height: 1; font-variant-numeric: tabular-nums; color: var(--o-accent); }
.score-value .out { color: var(--o-muted); font-size: 0.8125rem; }
.score-value .none { font-size: 1.125rem; font-weight: 600; }
.bar { height: 0.5rem; border-radius: 999px; background: var(--o-line); overflow: hidden; }
.fill { height: 100%; width: 0; background: var(--o-accent); }
@media (prefers-reduced-motion: no-preference) { .fill { transition: width 0.25s ease; } }
.compact .top { gap: 0.625rem; }
.compact .swatch-wrap { flex-basis: 4rem; min-height: 2.5rem; }
.compact .swatch-wrap .swatch { min-height: 2.5rem; }
.compact .score-value strong { font-size: 1.375rem; }
.compact .bar { display: none; }
.compact { padding: 0.625rem; }
p { margin: 0; }
.note, .notice, .empty, .skipped-reason { color: var(--o-muted); font-size: 0.8125rem; }
.notice { color: var(--o-fg); border-inline-start: 3px solid var(--o-accent); padding-inline-start: 0.5rem; }
.skipped-title { font-weight: 600; }
details { border-top: 1px solid var(--o-line); padding-top: 0.5rem; }
summary { cursor: pointer; font-weight: 600; border-radius: 4px; }
summary:focus-visible, .card:focus-visible { outline: 2px solid var(--o-accent); outline-offset: 2px; }
ul { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.625rem; }
.issue-head { display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; align-items: baseline; }
.issue-name { font-weight: 600; }
.badge { font-size: 0.75rem; border: 1px solid var(--o-line); border-radius: 999px; padding: 0 0.5rem; color: var(--o-muted); }
.pts { margin-inline-start: auto; font-variant-numeric: tabular-nums; color: var(--o-muted); font-size: 0.8125rem; }
.issue-text { color: var(--o-muted); font-size: 0.8125rem; margin-block-start: 0.125rem; }
code { font: 0.75rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.issue-code { color: var(--o-muted); }
.fix { border-top: 1px solid var(--o-line); padding-top: 0.5rem; }
.fix-title { font-weight: 600; }
.fix-body { display: flex; gap: 0.75rem; align-items: center; margin-block-start: 0.375rem; }
.fix-body .swatch { flex: 0 0 5rem; height: 2.5rem; }
.fix-label { font-weight: 500; }
.fix-gain { color: var(--o-accent); font-weight: 600; font-variant-numeric: tabular-nums; }
.fix-css { display: block; margin-block-start: 0.375rem; color: var(--o-muted); }
.vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (max-width: 26rem) { .top { flex-direction: column; } .swatch-wrap { flex-basis: auto; } }
${SWATCH}
${FORCED}
`;

/** Per-realm cache of constructed sheets, one per CSS text. */
const sheets = new WeakMap<object, Map<string, CSSStyleSheet>>();

/** Adopts `css` into `root` (constructable stylesheet, no inline <style>, so strict CSP is fine); falls back to a <style> element. */
export function applyStyles(root: ShadowRoot, css: string): void {
  try {
    const realm = root.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    const Sheet = realm?.CSSStyleSheet;
    if (Sheet && "replaceSync" in Sheet.prototype && "adoptedStyleSheets" in root) {
      let byText = sheets.get(realm);
      if (!byText) sheets.set(realm, (byText = new Map()));
      let sheet = byText.get(css);
      if (!sheet) {
        sheet = new Sheet();
        sheet.replaceSync(css);
        byText.set(css, sheet);
      }
      root.adoptedStyleSheets = [sheet];
      return;
    }
  } catch {
    // fall through to the <style> element
  }
  const style = root.ownerDocument.createElement("style");
  style.textContent = css;
  root.prepend(style);
}
