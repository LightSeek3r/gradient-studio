// Generates public/icon/{16,32,48,96,128}.png: a rounded square filled with the
// brand gradient (the web app's --brand-from/-via/-to), interpolated in OKLAB by
// the core library. Run `npx vite-node scripts/make-icons.ts` from apps/extension
// (output is committed; this script is the source of the artwork). No dependencies:
// the PNG is encoded by hand (zlib from Node).

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sampleGradient, type GradientDocument } from "../../../packages/core/src/index";

const doc: GradientDocument = {
  kind: "linear",
  angle: 135,
  stops: [{ color: "#818cf8" }, { color: "#a855f7" }, { color: "#c084fc" }],
};

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, tail]);
}

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function png(size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const radius = size * 0.22;
  const ss = 4; // supersampling for smooth corners
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const dx = Math.max(radius - px, px - (size - radius), 0);
          const dy = Math.max(radius - py, py - (size - radius), 0);
          if (dx * dx + dy * dy <= radius * radius) cover++;
        }
      }
      const t = (x + y) / (2 * (size - 1));
      const sample = sampleGradient(doc, t);
      const [r, g, b] = sample ? hex(sample.color) : [129, 140, 248];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = Math.round((cover / (ss * ss)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = fileURLToPath(new URL("../public/icon/", import.meta.url));
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 96, 128]) writeFileSync(`${dir}${size}.png`, png(size));
console.log("wrote icons to", dir);
