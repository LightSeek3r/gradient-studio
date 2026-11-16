// "Open in Gradient Studio": the URL-hash format of docs/URL-FORMAT.md (v1):
//
//   #v1;s=<rrggbb>@<pos>,...;d=<angle>:<weight>:<enabled>;b=normal
//
// Only a document the format can carry exactly gets a link: 2-10 opaque stops,
// positions inside 0-100%, a linear non-repeating gradient. Anything else is
// reported with a reason instead of being silently altered. The hash is only
// built and shown; the browser opens it when the user clicks the link.

import { resolveStops, type GradientDocument } from "@opal42/gradient";

export const DEFAULT_STUDIO_URL = "https://gradient-studio-al4.pages.dev/";

const MIN_STOPS = 2;
const MAX_STOPS = 10;

export type StudioHash = { ok: true; hash: string } | { ok: false; reason: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function studioHash(doc: GradientDocument): StudioHash {
  if (doc.kind !== "linear" || doc.repeating) return { ok: false, reason: "Only plain linear gradients open in Gradient Studio." };
  const stops = resolveStops(doc);
  if (stops.length < MIN_STOPS) return { ok: false, reason: "Gradient Studio needs at least 2 stops." };
  if (stops.length > MAX_STOPS) return { ok: false, reason: `Gradient Studio takes at most ${MAX_STOPS} stops; this one has ${stops.length}.` };
  const parts: string[] = [];
  for (const stop of stops) {
    if (stop.alpha !== undefined && stop.alpha < 1) return { ok: false, reason: "Gradient Studio edits opaque stops only." };
    if (!/^#[0-9a-f]{6}$/i.test(stop.color)) return { ok: false, reason: "A stop colour is not plain sRGB." };
    const pos = round2(stop.position * 100);
    if (!(pos >= 0 && pos <= 100)) return { ok: false, reason: "A stop sits outside 0–100%, which Gradient Studio cannot hold." };
    parts.push(`${stop.color.slice(1).toLowerCase()}@${pos}`);
  }
  const angle = ((Math.round(doc.angle) % 360) + 360) % 360;
  return { ok: true, hash: `v1;s=${parts.join(",")};d=${angle}:100:1;b=normal` };
}

/**
 * The studio address from a settings value. Only https (or http on localhost,
 * for development) without credentials is accepted; query and fragment are
 * dropped because the link brings its own fragment. Returns null for anything else.
 */
export function normalizeStudioUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 500) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local))) return null;
  if (url.username || url.password) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** The full link for a hash on a studio address. */
export function studioLink(base: string, hash: string): string {
  const normalized = normalizeStudioUrl(base) ?? DEFAULT_STUDIO_URL;
  return `${normalized}#${hash}`;
}
