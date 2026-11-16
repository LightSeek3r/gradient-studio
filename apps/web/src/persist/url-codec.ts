// ── Document <-> compact text codec ───────────────────────────────────────────
// One format for the URL hash and for localStorage. Specified in
// docs/URL-FORMAT.md. `decodeDocument` never throws: anything malformed,
// out of range or oversized yields null and the caller falls back.

import { isLocale, type Locale } from "../i18n/locale";
import { isBlendMode, MAX_DIRECTIONS, MAX_STOPS, MIN_STOPS, round2, sortTicks, type GradientDocument } from "../state/document";

export const CODEC_VERSION = "v1";
/** Longest encoded document accepted (a maximal valid one is ~230 chars). */
export const MAX_ENCODED_LENGTH = 1024;

const STOP_RE = /^([0-9a-fA-F]{6})@(\d{1,3}(?:\.\d{1,2})?)$/;
const DIRECTION_RE = /^(\d{1,3}):(\d{1,3}):([01])$/;

function formatNumber(n: number): string {
  return String(round2(n));
}

/**
 * `v1;s=101b45@0,9333ea@100;d=135:100:1;b=normal` (no leading `#`). With
 * `lang`, `;lang=fr` is appended: the interface language of the link, which
 * is not part of the document (docs/URL-FORMAT.md).
 */
export function encodeDocument(doc: GradientDocument, lang?: Locale | null): string {
  const stops = sortTicks(doc.ticks)
    .map((t) => `${t.color.replace(/^#/, "").toLowerCase()}@${formatNumber(t.position)}`)
    .join(",");
  const directions = doc.directions
    .map((d) => `${Math.round(d.angle)}:${Math.round(d.weight)}:${d.enabled ? 1 : 0}`)
    .join(",");
  const base = `${CODEC_VERSION};s=${stops};d=${directions};b=${doc.blend}`;
  return lang ? `${base};lang=${lang}` : base;
}

/**
 * The `lang=` of a document fragment, or null when absent, unsupported or
 * when the fragment is not a document at all. Independent of `decodeDocument`:
 * an unsupported language never invalidates the gradient.
 */
export function decodeLang(input: unknown): Locale | null {
  if (typeof input !== "string") return null;
  const text = input.startsWith("#") ? input.slice(1) : input;
  if (text.length === 0 || text.length > MAX_ENCODED_LENGTH || !text.startsWith(`${CODEC_VERSION};`)) return null;
  for (const seg of text.split(";").slice(1)) {
    if (seg.startsWith("lang=")) {
      const value = seg.slice(5).toLowerCase();
      return isLocale(value) ? value : null;
    }
  }
  return null;
}

/**
 * Parse an encoded document (an optional leading `#` is ignored). Strict:
 * every field must be present at most once and within its range, there must
 * be 2-10 stops and 1-7 directions with at least one enabled. Ids are
 * assigned 1..n (stops in position order, directions in list order).
 */
export function decodeDocument(input: unknown): GradientDocument | null {
  try {
    if (typeof input !== "string") return null;
    const text = input.startsWith("#") ? input.slice(1) : input;
    if (text.length === 0 || text.length > MAX_ENCODED_LENGTH) return null;

    const [version, ...segments] = text.split(";");
    if (version !== CODEC_VERSION) return null;

    const fields = new Map<string, string>();
    for (const seg of segments) {
      const eq = seg.indexOf("=");
      if (eq <= 0) return null;
      const key = seg.slice(0, eq);
      if (!["s", "d", "b", "lang"].includes(key) || fields.has(key)) return null;
      fields.set(key, seg.slice(eq + 1));
    }

    const stopsText = fields.get("s");
    if (!stopsText) return null;
    const stopItems = stopsText.split(",");
    if (stopItems.length < MIN_STOPS || stopItems.length > MAX_STOPS) return null;
    const ticks = [];
    for (const item of stopItems) {
      const m = STOP_RE.exec(item);
      if (!m) return null;
      const position = Number(m[2]);
      if (!(position >= 0 && position <= 100)) return null;
      ticks.push({ id: 0, color: `#${m[1].toLowerCase()}`, position });
    }

    const dirText = fields.get("d") ?? "135:100:1";
    const dirItems = dirText.split(",");
    if (dirItems.length < 1 || dirItems.length > MAX_DIRECTIONS) return null;
    const directions = [];
    for (const [i, item] of dirItems.entries()) {
      const m = DIRECTION_RE.exec(item);
      if (!m) return null;
      const angle = Number(m[1]);
      const weight = Number(m[2]);
      if (angle >= 360 || weight < 1 || weight > 100) return null;
      directions.push({ id: i + 1, angle, weight, enabled: m[3] === "1" });
    }
    if (!directions.some((d) => d.enabled)) return null;

    const blend = fields.get("b") ?? "normal";
    if (!isBlendMode(blend)) return null;

    return {
      ticks: sortTicks(ticks).map((t, i) => ({ ...t, id: i + 1 })),
      directions,
      blend,
    };
  } catch {
    return null;
  }
}
