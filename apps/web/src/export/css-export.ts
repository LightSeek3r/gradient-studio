// ── CSS export formatting (pure) ──────────────────────────────────────────────

import { rgbToHex, type GradientStyle } from "@opal42/gradient";

/** Blend-mode lists that are all "normal" are the CSS default — skip the line. */
function isDefaultBlend(mode: string): boolean {
  return mode.split(", ").every((m) => m === "normal");
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}

/** `rgba(r, g, b, 1)` is just a verbose `#rrggbb` - emit the short form. */
function opaqueRgbaToHex(css: string): string {
  return css.replace(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*1\s*\)/g, (_m, r, g, b) =>
    rgbToHex({ r: +r, g: +g, b: +b }),
  );
}

/**
 * Copy-paste-ready CSS declarations for a gradient style, one colour stop
 * per line so long multi-layer values stay readable (and wrap) on any width.
 */
export function buildExportLines(style: GradientStyle): string[] {
  const layers = splitTopLevel(opaqueRgbaToHex(style.background));
  const lines: string[] = [];

  if (!layers.every((l) => /^linear-gradient\(/.test(l))) {
    lines.push(`background: ${layers.join(", ")};`);
  } else if (layers.length === 1) {
    const [angle, ...stops] = splitTopLevel(layers[0].slice("linear-gradient(".length, -1));
    lines.push(`background: linear-gradient(${angle},`);
    stops.forEach((stop, i) => lines.push(`  ${stop}${i === stops.length - 1 ? ");" : ","}`));
  } else {
    lines.push("background:");
    layers.forEach((layer, li) => {
      const [angle, ...stops] = splitTopLevel(layer.slice("linear-gradient(".length, -1));
      const lastLayer = li === layers.length - 1;
      lines.push(`  linear-gradient(${angle},`);
      stops.forEach((stop, i) => {
        const end = i === stops.length - 1 ? (lastLayer ? ");" : "),") : ",";
        lines.push(`    ${stop}${end}`);
      });
    });
  }

  if (!isDefaultBlend(style.backgroundBlendMode)) {
    lines.push(`background-blend-mode: ${style.backgroundBlendMode};`);
  }
  return lines;
}
