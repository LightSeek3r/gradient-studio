import type { Range } from "../src/analyze";

export const ROUGH = "linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff)";
export const SMOOTH = "linear-gradient(#101b45, #3f1d63, #9333ea)";
export const FLAT = "linear-gradient(#000000, #ffffff)";

export const slice = (text: string, r: Range): string => text.slice(r.start, r.end);

/** A tiny seeded generator (mulberry32) so property tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomGradient(rand: () => number): string {
  const n = 2 + Math.floor(rand() * 4);
  const hex = () =>
    "#" +
    Array.from({ length: 3 }, () =>
      Math.floor(rand() * 256)
        .toString(16)
        .padStart(2, "0"),
    ).join("");
  const explicit = rand() < 0.6;
  const positions = Array.from({ length: n }, (_, i) => Math.round((i / (n - 1)) * 100 + (rand() - 0.5) * 12));
  const stops = Array.from({ length: n }, (_, i) => (explicit ? `${hex()} ${Math.min(100, Math.max(0, positions[i]))}%` : hex()));
  const dir = ["", "90deg, ", "to right, ", "45deg, ", "in oklch, ", "to bottom, "][Math.floor(rand() * 6)];
  return `linear-gradient(${dir}${stops.join(", ")})`;
}
