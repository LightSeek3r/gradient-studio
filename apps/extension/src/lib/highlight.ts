// Expressions for "Highlight element on page" and "Show in Elements panel".
// Both run through `inspectedWindow.eval` and take the element's selector as a
// JSON string literal, never as code. The selector comes from the page (see
// scan-result.ts); it is only ever handed to `document.querySelector`.

/** Longest selector accepted. */
const MAX_PATH = 800;

function literal(path: string): string | null {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH) return null;
  return JSON.stringify(path);
}

/**
 * Scrolls the element into view and draws a temporary outline over it: a
 * `position: fixed` box appended to <html> and removed after ~1.8 s. The
 * element's own styles are never touched, so there is nothing to restore, and
 * repeated clicks stack harmlessly. Returns "ok" | "missing" | "error".
 */
export function highlightExpression(path: string, ms = 1800): string | null {
  const sel = literal(path);
  if (sel === null) return null;
  return `(function (sel, ms) {
  try {
    var el = document.querySelector(sel);
    if (!el) return "missing";
    el.scrollIntoView({ block: "center", inline: "center" });
    var r = el.getBoundingClientRect();
    var box = document.createElement("div");
    box.setAttribute("data-opal42-highlight", "");
    var s = box.style;
    s.position = "fixed";
    s.left = r.left - 2 + "px";
    s.top = r.top - 2 + "px";
    s.width = Math.max(r.width, 4) + 4 + "px";
    s.height = Math.max(r.height, 4) + 4 + "px";
    s.boxSizing = "border-box";
    s.outline = "2px solid #ff2bd6";
    s.boxShadow = "0 0 0 2px #fff, 0 0 0 4px rgba(0,0,0,0.6)";
    s.background = "rgba(255,43,214,0.12)";
    s.pointerEvents = "none";
    s.zIndex = "2147483647";
    document.documentElement.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, ms);
    return "ok";
  } catch (e) { return "error"; }
})(${sel}, ${Math.max(200, Math.min(10000, Math.round(ms)))})`;
}

/** Selects the element in DevTools' Elements panel (`inspect()` is a DevTools command-line API). */
export function inspectExpression(path: string): string | null {
  const sel = literal(path);
  if (sel === null) return null;
  return `(function (sel) {
  try {
    var el = document.querySelector(sel);
    if (!el) return "missing";
    inspect(el);
    return "ok";
  } catch (e) { return "error"; }
})(${sel})`;
}
