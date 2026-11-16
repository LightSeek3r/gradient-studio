import { createHash } from "node:crypto";

/** JSON with sorted object keys: the same value always gives the same text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** First 16 hex digits of the SHA-256 of `text`. */
export function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Round to `digits` decimals; -0 becomes 0; non-finite numbers become null. */
export function round(x: number, digits = 4): number | null {
  if (!Number.isFinite(x)) return null;
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return r === 0 ? 0 : r;
}
