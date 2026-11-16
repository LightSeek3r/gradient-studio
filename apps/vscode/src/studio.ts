// Gradient Studio link for a gradient (docs/URL-FORMAT.md, version v1). Pure.
//
//   <studioUrl>#v1;s=rrggbb@pos,...;d=angle:100:1;b=normal
//
// The fragment is never sent to a server by browsers. The link is only opened
// by the explicit command "Opal42: Open in Gradient Studio".

import { resolveStops, type GradientDocument } from "@opal42/gradient";

export const DEFAULT_STUDIO_URL = "https://gradient-studio-al4.pages.dev/";
/** Most stops the web app's link format holds. */
export const MAX_STUDIO_STOPS = 10;

const HEX = /^#[0-9a-f]{6}$/i;

/** A percentage with at most 2 decimals, as the web app writes it. */
function pos(p: number): string {
  const v = Math.round(Math.min(100, Math.max(0, p * 100)) * 100) / 100;
  return String(v);
}

export type StudioHash = { ok: true; hash: string } | { ok: false; reason: string };

/** The `#v1;...` fragment for a document, or why it cannot be represented. */
export function studioHash(doc: GradientDocument | null | undefined): StudioHash {
  if (!doc || doc.kind !== "linear" || !Array.isArray(doc.stops)) return { ok: false, reason: "This is not a linear gradient Gradient Studio can open." };
  if (doc.repeating) return { ok: false, reason: "Repeating gradients cannot be opened in Gradient Studio." };
  if (doc.stops.length < 2) return { ok: false, reason: "A gradient needs at least two stops." };
  if (doc.stops.length > MAX_STUDIO_STOPS) return { ok: false, reason: `Gradient Studio links hold at most ${MAX_STUDIO_STOPS} stops.` };
  const resolved = resolveStops(doc);
  if (resolved.length !== doc.stops.length) return { ok: false, reason: "The stop positions could not be resolved." };
  const stops: string[] = [];
  for (const s of resolved) {
    if (typeof s.color !== "string" || !HEX.test(s.color) || !Number.isFinite(s.position)) {
      return { ok: false, reason: "A stop colour could not be read." };
    }
    stops.push(`${s.color.slice(1).toLowerCase()}@${pos(s.position)}`);
  }
  const angle = Number.isFinite(doc.angle) ? ((Math.round(doc.angle) % 360) + 360) % 360 : 180;
  return { ok: true, hash: `#v1;s=${stops.join(",")};d=${angle}:100:1;b=normal` };
}

/** `base` when it is an http(s) URL, else the default. */
export function normalizeStudioBase(base: unknown): string {
  if (typeof base !== "string") return DEFAULT_STUDIO_URL;
  try {
    const u = new URL(base.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return DEFAULT_STUDIO_URL;
    u.hash = "";
    return u.toString();
  } catch {
    return DEFAULT_STUDIO_URL;
  }
}

/** The full link, or why there is none. */
export function studioUrl(base: unknown, doc: GradientDocument | null | undefined): { ok: true; url: string } | { ok: false; reason: string } {
  const h = studioHash(doc);
  if (!h.ok) return h;
  const u = new URL(normalizeStudioBase(base));
  u.hash = h.hash;
  return { ok: true, url: u.toString() };
}
