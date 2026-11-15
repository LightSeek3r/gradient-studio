import { describe, expect, it } from "vitest";
import { decodeDocument, encodeDocument, MAX_ENCODED_LENGTH } from "../src/persist/url-codec";
import { BLEND_MODES, defaultDocument, MAX_STOPS, sameDocument, type GradientDocument } from "../src/state/document";

/** mulberry32: small seeded PRNG so the fuzz is reproducible. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDocument(rand: () => number): GradientDocument {
  const nStops = 2 + Math.floor(rand() * (MAX_STOPS - 1));
  const nDirs = 1 + Math.floor(rand() * 7);
  const hex = () =>
    "#" +
    Math.floor(rand() * 0xffffff)
      .toString(16)
      .padStart(6, "0");
  const directions = Array.from({ length: nDirs }, (_, i) => ({
    id: i + 1,
    angle: Math.floor(rand() * 360),
    weight: 1 + Math.floor(rand() * 100),
    enabled: rand() < 0.7,
  }));
  directions[0].enabled = true;
  return {
    ticks: Array.from({ length: nStops }, (_, i) => ({
      id: i + 1,
      color: hex(),
      position: Math.round(rand() * 10000) / 100,
    })),
    directions,
    blend: BLEND_MODES[Math.floor(rand() * BLEND_MODES.length)],
  };
}

describe("url codec", () => {
  it("encodes the default document readably", () => {
    expect(encodeDocument(defaultDocument())).toBe("v1;s=101b45@0,3f1d63@50,9333ea@100;d=135:100:1;b=normal");
  });

  it("round-trips the default document, with or without #", () => {
    const enc = encodeDocument(defaultDocument());
    expect(decodeDocument(enc)).toEqual(defaultDocument());
    expect(decodeDocument("#" + enc)).toEqual(defaultDocument());
  });

  it("assigns ids deterministically in position order", () => {
    const d = decodeDocument("v1;s=0000ff@100,ff0000@0;d=90:50:1,10:20:0;b=screen");
    expect(d).toEqual({
      ticks: [
        { id: 1, color: "#ff0000", position: 0 },
        { id: 2, color: "#0000ff", position: 100 },
      ],
      directions: [
        { id: 1, angle: 90, weight: 50, enabled: true },
        { id: 2, angle: 10, weight: 20, enabled: false },
      ],
      blend: "screen",
    });
  });

  it("defaults missing d and b", () => {
    expect(decodeDocument("v1;s=ff0000@0,0000ff@100")).toMatchObject({
      directions: [{ angle: 135, weight: 100, enabled: true }],
      blend: "normal",
    });
  });

  it("keeps fractional positions to two decimals", () => {
    const d = decodeDocument("v1;s=ff0000@0,00ff00@33.33,0000ff@100");
    expect(d?.ticks[1].position).toBe(33.33);
    expect(decodeDocument("v1;s=ff0000@0,00ff00@33.333,0000ff@100")).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["just #", "#"],
    ["wrong version", "v2;s=ff0000@0,0000ff@100"],
    ["no version", "s=ff0000@0,0000ff@100"],
    ["no stops", "v1;d=90:100:1"],
    ["one stop", "v1;s=ff0000@0"],
    ["11 stops", "v1;s=" + Array.from({ length: 11 }, (_, i) => `ff0000@${i * 10}`).join(",")],
    ["short hex", "v1;s=f00@0,00f@100"],
    ["hash in hex", "v1;s=#ff0000@0,0000ff@100"],
    ["position > 100", "v1;s=ff0000@0,0000ff@101"],
    ["negative position", "v1;s=ff0000@-1,0000ff@100"],
    ["NaN position", "v1;s=ff0000@NaN,0000ff@100"],
    ["angle 360", "v1;s=ff0000@0,0000ff@100;d=360:100:1"],
    ["weight 0", "v1;s=ff0000@0,0000ff@100;d=90:0:1"],
    ["weight 101", "v1;s=ff0000@0,0000ff@100;d=90:101:1"],
    ["enabled 2", "v1;s=ff0000@0,0000ff@100;d=90:100:2"],
    ["no enabled direction", "v1;s=ff0000@0,0000ff@100;d=90:100:0"],
    ["8 directions", "v1;s=ff0000@0,0000ff@100;d=" + Array(8).fill("90:100:1").join(",")],
    ["unknown blend", "v1;s=ff0000@0,0000ff@100;b=color-burn"],
    ["unknown key", "v1;s=ff0000@0,0000ff@100;x=1"],
    ["duplicate key", "v1;s=ff0000@0,0000ff@100;s=ff0000@0,0000ff@100"],
    ["oversized", "v1;s=ff0000@0,0000ff@100;b=normal" + " ".repeat(MAX_ENCODED_LENGTH)],
    ["garbage", "%%%%%"],
  ])("rejects %s", (_name, input) => {
    expect(decodeDocument(input)).toBeNull();
  });

  it("never throws on non-string input", () => {
    for (const v of [null, undefined, 42, {}, [], Symbol("x")]) expect(decodeDocument(v)).toBeNull();
  });

  it("fuzz: random valid documents round-trip exactly (seeded)", () => {
    const rand = prng(20261115);
    for (let i = 0; i < 500; i++) {
      const d = randomDocument(rand);
      const back = decodeDocument(encodeDocument(d));
      expect(back).not.toBeNull();
      expect(sameDocument(back!, d)).toBe(true);
      expect(encodeDocument(back!)).toBe(encodeDocument(d));
    }
  });

  it("fuzz: mutated encodings never throw and decode only to valid documents (seeded)", () => {
    const rand = prng(42);
    const alphabet = "v1;s=d,b@:#.-0123456789abcdefxyz% ";
    for (let i = 0; i < 2000; i++) {
      const chars = encodeDocument(randomDocument(rand)).split("");
      const edits = 1 + Math.floor(rand() * 4);
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(rand() * chars.length);
        const op = rand();
        const c = alphabet[Math.floor(rand() * alphabet.length)];
        if (op < 0.33) chars.splice(at, 1);
        else if (op < 0.66) chars.splice(at, 0, c);
        else chars[at] = c;
      }
      const d = decodeDocument(chars.join(""));
      if (d) {
        expect(d.ticks.length).toBeGreaterThanOrEqual(2);
        expect(d.ticks.length).toBeLessThanOrEqual(MAX_STOPS);
        expect(d.directions.length).toBeGreaterThanOrEqual(1);
        expect(d.directions.length).toBeLessThanOrEqual(7);
        expect(d.directions.some((x) => x.enabled)).toBe(true);
        for (const t of d.ticks) {
          expect(t.color).toMatch(/^#[0-9a-f]{6}$/);
          expect(t.position).toBeGreaterThanOrEqual(0);
          expect(t.position).toBeLessThanOrEqual(100);
        }
        expect(BLEND_MODES).toContain(d.blend);
      }
    }
  });
});
