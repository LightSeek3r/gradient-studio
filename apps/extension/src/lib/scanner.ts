// The page scanner: ONE self-contained function whose source text is sent to
// the inspected page through `chrome.devtools.inspectedWindow.eval`. It runs in
// the page's main world, so:
//
//   - it must not reference anything outside its own body (no imports, no
//     module constants, no helpers): `scanPage.toString()` is all that arrives.
//     tests/scanner-source.test.ts checks this by running the source text in a
//     bare `new Function` scope and by scanning it for bundler helpers;
//   - it is stateless: the panel drives a scan through many short calls
//     (`op: "info" | "sheet" | "elements"`), each carrying its own cursor, so
//     no call holds the page's main thread for long and nothing is left behind
//     on the page (no globals, no listeners, no DOM changes);
//   - it never throws: failures come back as `{ op: "error" }`;
//   - the page can patch built-ins (Array.prototype, JSON, getComputedStyle),
//     so the panel treats the result as untrusted (scan-result.ts).
//
// It reads, it never writes. It makes no network request.

import type { ScanRequest, ScanResult } from "./scan-types";

export function scanPage(req: ScanRequest): ScanResult {
  try {
    const TRACKED = ["background-image", "border-image-source", "mask-image", "-webkit-mask-image", "list-style-image"];
    const SHORTHANDS = [
      "background",
      "background-image",
      "border-image",
      "border-image-source",
      "mask",
      "mask-image",
      "-webkit-mask",
      "-webkit-mask-image",
      "list-style",
      "list-style-image",
    ];
    const MARK = "gradient(";

    const hasGradient = (v: unknown): v is string => typeof v === "string" && v.indexOf(MARK) !== -1;

    const clip = (v: string, max: number) => (v.length > max ? { value: v.slice(0, max), truncated: true } : { value: v, truncated: false });

    const esc = (s: string): string => {
      try {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
      } catch {
        /* fall through */
      }
      return s.replace(/[^\w-]/g, (c) => "\\" + c);
    };

    // Short, readable label: tag#id.class1.class2
    const describe = (el: Element): string => {
      let out = el.localName;
      if (el.id) out += "#" + esc(el.id.slice(0, 40));
      const cls = el.classList;
      if (cls) {
        for (let i = 0; i < cls.length && i < 2; i++) out += "." + esc(cls[i].slice(0, 30));
      }
      return out.slice(0, 120);
    };

    // A selector that matches this element again: #id when the id is unique,
    // otherwise a chain of :nth-child steps up to the nearest unique id (or <html>).
    const uniquePath = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      let depth = 0;
      while (node && depth < 24) {
        if (node.id && node.ownerDocument.getElementById(node.id) === node) {
          parts.unshift("#" + esc(node.id.slice(0, 80)));
          break;
        }
        const parent: Element | null = node.parentElement;
        if (!parent) {
          parts.unshift(node.localName);
          break;
        }
        let n = 1;
        for (let s = node.previousElementSibling; s; s = s.previousElementSibling) n++;
        parts.unshift(node.localName + ":nth-child(" + n + ")");
        node = parent;
        depth++;
      }
      return parts.join(" > ").slice(0, 600);
    };

    const isCustom = (name: string) => name.length > 2 && name.charCodeAt(0) === 45 && name.charCodeAt(1) === 45;

    if (req.op === "info") {
      const state = document.readyState;
      return {
        op: "info",
        elements: document.getElementsByTagName("*").length,
        sheets: document.styleSheets.length + (document.adoptedStyleSheets ? document.adoptedStyleSheets.length : 0),
        readyState: state === "loading" || state === "interactive" || state === "complete" ? state : "unknown",
      };
    }

    if (req.op === "elements") {
      const all = document.getElementsByTagName("*");
      const total = all.length;
      const end = Math.min(total, req.start + req.count);
      const hits: Extract<ScanResult, { op: "elements" }>["hits"] = [];
      const started = Date.now();
      let hitCapReached = false;
      let i = req.start;

      for (; i < end; i++) {
        if (i > req.start && Date.now() - started > req.budgetMs) break;
        if (hits.length >= req.maxHits) {
          hitCapReached = true;
          break;
        }
        const el = all[i];
        let cs: CSSStyleDeclaration;
        try {
          cs = getComputedStyle(el);
        } catch {
          continue;
        }

        let label = "";
        let path = "";
        const add = (source: "computed" | "custom-property", property: string, raw: string, pseudo: string) => {
          if (!label) {
            label = describe(el);
            path = uniquePath(el);
          }
          const c = clip(raw, req.maxValueLength);
          hits.push({
            source,
            property,
            value: c.value,
            ...(c.truncated ? { truncated: true } : {}),
            selector: label + pseudo,
            path,
            origin: "",
          });
        };

        const read = (style: CSSStyleDeclaration, pseudo: string) => {
          let maskValue = "";
          for (let p = 0; p < TRACKED.length; p++) {
            const v = style.getPropertyValue(TRACKED[p]);
            if (!hasGradient(v)) continue;
            if (TRACKED[p] === "mask-image") maskValue = v;
            // -webkit-mask-image is an alias of mask-image in current browsers: report it once.
            if (TRACKED[p] === "-webkit-mask-image" && v === maskValue) continue;
            add("computed", TRACKED[p], v, pseudo);
          }
        };
        read(cs, "");

        // Custom properties: the ones the stylesheets declared with a gradient,
        // plus the ones set inline on this element. Report an element only where
        // the value differs from its parent's (the declaring element), because
        // custom properties inherit.
        const names: string[] = req.customProps.slice();
        const inline = (el as HTMLElement).style;
        if (inline && inline.length) {
          for (let k = 0; k < inline.length && k < 64; k++) {
            const name = inline[k];
            if (isCustom(name) && names.indexOf(name) === -1) names.push(name);
          }
        }
        if (names.length) {
          const parent = el.parentElement;
          const pcs = parent ? getComputedStyle(parent) : null;
          for (let k = 0; k < names.length; k++) {
            const v = cs.getPropertyValue(names[k]);
            if (!hasGradient(v)) continue;
            if (pcs && pcs.getPropertyValue(names[k]) === v) continue;
            add("custom-property", names[k], v, "");
          }
        }

        if (req.pseudo) {
          const pseudos = ["::before", "::after"];
          for (let k = 0; k < pseudos.length; k++) {
            let pcs: CSSStyleDeclaration;
            try {
              pcs = getComputedStyle(el, pseudos[k]);
            } catch {
              continue;
            }
            const content = pcs.getPropertyValue("content");
            if (!content || content === "none" || content === "normal") continue;
            read(pcs, pseudos[k]);
          }
        }
      }

      return { op: "elements", start: req.start, next: Math.max(i, req.start + 1), total, hits, hitCapReached };
    }

    if (req.op === "sheet") {
      const list: CSSStyleSheet[] = [];
      for (let s = 0; s < document.styleSheets.length; s++) list.push(document.styleSheets[s] as CSSStyleSheet);
      const adopted = document.adoptedStyleSheets;
      if (adopted) for (let s = 0; s < adopted.length; s++) list.push(adopted[s]);
      const sheet = list[req.index];

      const labelOf = (sh: CSSStyleSheet): string => {
        const href = sh.href;
        if (href) {
          const cut = href.search(/[?#]/);
          return (cut === -1 ? href : href.slice(0, cut)).slice(0, 300);
        }
        return sh.ownerNode ? "<style>" : "<constructed stylesheet>";
      };

      if (!sheet) {
        return { op: "sheet", index: req.index, label: "", status: "error", hits: [], customProps: [], rules: 0, next: null, capped: false };
      }
      const label = labelOf(sheet);
      const base = { op: "sheet" as const, index: req.index, label };

      let top: CSSRuleList | null = null;
      try {
        top = sheet.cssRules;
      } catch (e) {
        const name = e && (e as { name?: string }).name;
        return { ...base, status: name === "SecurityError" ? ("cross-origin" as const) : ("error" as const), hits: [], customProps: [], rules: 0, next: null, capped: false };
      }
      if (!top) return { ...base, status: "error" as const, hits: [], customProps: [], rules: 0, next: null, capped: false };

      const hits: Extract<ScanResult, { op: "sheet" }>["hits"] = [];
      const customProps: string[] = [];
      const started = Date.now();
      let visited = 0;
      let stopped = false;
      let capped = false;

      const keyframesName = (rule: CSSRule): string => {
        const parent = rule.parentRule as (CSSRule & { name?: string }) | null;
        return parent && typeof parent.name === "string" ? "@keyframes " + parent.name + " " : "";
      };

      const readDeclarations = (selector: string, style: CSSStyleDeclaration, sheetLabel: string) => {
        // A shorthand and its longhand (or mask and -webkit-mask-image) report the
        // same text: keep the first of each distinct value in this rule.
        const seen: string[] = [];
        for (let p = 0; p < SHORTHANDS.length; p++) {
          const v = style.getPropertyValue(SHORTHANDS[p]);
          if (!hasGradient(v) || seen.indexOf(v) !== -1) continue;
          seen.push(v);
          const c = clip(v, req.maxValueLength);
          hits.push({
            source: "stylesheet",
            property: SHORTHANDS[p],
            value: c.value,
            ...(c.truncated ? { truncated: true } : {}),
            selector: selector.slice(0, 300),
            path: "",
            origin: sheetLabel,
          });
        }
        for (let k = 0; k < style.length && k < 2000; k++) {
          const name = style[k];
          if (!isCustom(name)) continue;
          const v = style.getPropertyValue(name);
          if (!hasGradient(v)) continue;
          const c = clip(v, req.maxValueLength);
          hits.push({
            source: "stylesheet",
            property: name,
            value: c.value,
            ...(c.truncated ? { truncated: true } : {}),
            selector: selector.slice(0, 300),
            path: "",
            origin: sheetLabel,
          });
          if (customProps.indexOf(name) === -1 && customProps.length < 200) customProps.push(name);
        }
      };

      // Iterative depth-first walk. Nested lists: grouping rules (@media, @supports,
      // @layer, @container), nesting inside style rules, @keyframes, @import.
      const stack: { rules: CSSRuleList; i: number; label: string; parentSel: string }[] = [{ rules: top, i: 0, label, parentSel: "" }];
      let importDepth = 0;
      while (stack.length && !stopped) {
        const frame = stack[stack.length - 1];
        if (frame.i >= frame.rules.length) {
          stack.pop();
          continue;
        }
        const rule = frame.rules[frame.i++] as CSSRule & {
          style?: CSSStyleDeclaration;
          selectorText?: string;
          keyText?: string;
          cssRules?: CSSRuleList;
          styleSheet?: CSSStyleSheet | null;
        };
        visited++;
        if (visited > req.maxRules) {
          capped = true;
          stopped = true;
          break;
        }
        const replaying = visited <= req.skip;

        // CSS nesting: a nested rule's own selector is relative (`& .inner`, `.inner`); show it in full.
        let resolved = "";
        if (typeof rule.selectorText === "string") {
          resolved = rule.selectorText;
          if (frame.parentSel) resolved = resolved.indexOf("&") !== -1 ? resolved.split("&").join(frame.parentSel) : frame.parentSel + " " + resolved;
        }

        if (!replaying) {
          if (typeof rule.selectorText === "string" && rule.style) {
            readDeclarations(resolved, rule.style, frame.label);
          } else if (typeof rule.keyText === "string" && rule.style) {
            readDeclarations(keyframesName(rule) + rule.keyText, rule.style, frame.label);
          }
        }
        // Descend (also while replaying, to keep the visit order identical).
        if (rule.cssRules && rule.cssRules.length) {
          stack.push({ rules: rule.cssRules, i: 0, label: frame.label, parentSel: resolved || frame.parentSel });
        } else if (rule.styleSheet && importDepth < 8) {
          let inner: CSSRuleList | null = null;
          try {
            inner = rule.styleSheet.cssRules;
          } catch {
            inner = null; // cross-origin @import: skipped
          }
          if (inner) {
            importDepth++;
            stack.push({ rules: inner, i: 0, label: labelOf(rule.styleSheet), parentSel: "" });
          }
        }
        if (!replaying && Date.now() - started > req.budgetMs) {
          stopped = true;
        }
      }

      const done = !stopped || capped;
      return { ...base, status: "ok" as const, hits, customProps, rules: visited, next: done ? null : visited, capped };
    }

    return { op: "error", message: "unknown op" };
  } catch (e) {
    return { op: "error", message: String(e && (e as { message?: unknown }).message ? (e as { message: unknown }).message : e).slice(0, 300) };
  }
}

/** The text sent to the page. Evaluates to the function; see `scanExpression`. */
export const SCANNER_SOURCE: string = scanPage.toString();

/** Expression for `inspectedWindow.eval`: calls the scanner with one request. */
export function scanExpression(req: ScanRequest): string {
  return "(" + SCANNER_SOURCE + ")(" + JSON.stringify(req) + ")";
}
