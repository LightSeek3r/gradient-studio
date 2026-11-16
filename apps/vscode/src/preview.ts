// Inline SVG swatches for hovers. Pure.
//
// Safety: the SVG is built from a fixed template. The only dynamic values are
//  - colours, accepted only when they match /^#[0-9a-f]{6}$/i and written back
//    lower-case, and
//  - numbers, accepted only when finite and always written with toFixed().
// No user string (not an id, name or message) ever reaches the markup, so the
// result cannot carry markup, script or an external reference.

import { bakeStops, type GradientDocument } from "@opal42/gradient";

const HEX = /^#[0-9a-f]{6}$/i;
const EXTRA_STOPS = 24;

const num = (n: number, digits = 2): string => (Number.isFinite(n) ? n.toFixed(digits) : "0");

export interface SwatchSize {
  width: number;
  height: number;
}

export const SWATCH: SwatchSize = { width: 240, height: 28 };

interface Pt {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The gradient line of a CSS `linear-gradient(<angle>)` in a `w` x `h` box:
 * through the centre, length |w sin a| + |h cos a| (CSS Images 3).
 */
export function gradientLine(angleDeg: number, w: number, h: number): Pt {
  const a = (Number.isFinite(angleDeg) ? angleDeg : 180) * (Math.PI / 180);
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = w / 2;
  const cy = h / 2;
  return { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half };
}

/**
 * An SVG of `doc` painted the way the CSS would render it (sRGB, or the
 * document's own interpolation), or null when the document cannot be drawn.
 */
export function gradientSvg(doc: GradientDocument, size: SwatchSize = SWATCH): string | null {
  try {
    if (!doc || doc.kind !== "linear" || !Array.isArray(doc.stops) || doc.stops.length < 2) return null;
    const w = Math.max(1, Math.min(2000, Math.round(size.width)));
    const h = Math.max(1, Math.min(2000, Math.round(size.height)));
    const baked = bakeStops(doc, doc.stops.length + EXTRA_STOPS, { interpolation: doc.interpolation ?? { space: "srgb" } });
    const stops: string[] = [];
    for (const s of baked) {
      if (typeof s.color !== "string" || !HEX.test(s.color)) return null;
      const position = typeof s.position === "number" && Number.isFinite(s.position) ? Math.min(1, Math.max(0, s.position)) : null;
      if (position === null) return null;
      stops.push(`<stop offset="${num(position, 4)}" stop-color="${s.color.toLowerCase()}"/>`);
    }
    if (stops.length < 2) return null;
    const p = gradientLine(doc.angle, w, h);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(p.x2)}" y2="${num(p.y2)}">` +
      stops.join("") +
      `</linearGradient></defs><rect width="${w}" height="${h}" rx="4" fill="url(#g)"/></svg>`
    );
  } catch {
    return null;
  }
}

/** `data:image/svg+xml;base64,...` for markdown images. */
export function svgDataUri(svg: string): string {
  // The SVG is ASCII by construction; btoa exists in Node >= 16 and in web workers.
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** The markdown image for a document, or null when it cannot be drawn. */
export function swatchMarkdown(doc: GradientDocument, alt: string): string | null {
  const svg = gradientSvg(doc);
  if (svg === null) return null;
  const safeAlt = alt.replace(/[^A-Za-z0-9 ,.:+()-]/g, "");
  return `![${safeAlt}](${svgDataUri(svg)})`;
}
