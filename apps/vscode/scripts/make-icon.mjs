// Generate images/icon.png (128x128, what the Marketplace asks for) from the
// web app's own 512x512 icon by averaging 4x4 pixel blocks. Dependency-free:
// decodes the (non-interlaced, 8-bit) PNG with zlib and writes a new one.
//
//   node scripts/make-icon.mjs [source.png] [out.png]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] ?? resolve(here, "../../web/public/icon-512.png");
const out = process.argv[3] ?? resolve(here, "../images/icon.png");

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Decode a non-interlaced 8-bit RGB/RGBA PNG to { width, height, channels, pixels }. */
export function decodePng(file) {
  if (file.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG");
  let pos = 8;
  let ihdr;
  const idat = [];
  while (pos < file.length) {
    const len = file.readUInt32BE(pos);
    const type = file.toString("ascii", pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") ihdr = data;
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  const channels = { 2: 3, 6: 4 }[colorType];
  if (depth !== 8 || !channels || interlace !== 0) throw new Error("unsupported PNG (need 8-bit RGB/RGBA, not interlaced)");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, pixels };
}

export function encodePng({ width, height, channels, pixels }) {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Box-filter downscale by an integer factor. */
export function downscale(img, factor) {
  const width = img.width / factor;
  const height = img.height / factor;
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error("size is not a multiple of the factor");
  const { channels } = img;
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) sum += img.pixels[((y * factor + dy) * img.width + x * factor + dx) * channels + c];
        }
        pixels[(y * width + x) * channels + c] = Math.round(sum / (factor * factor));
      }
    }
  }
  return { width, height, channels, pixels };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const img = decodePng(readFileSync(source));
  const small = downscale(img, img.width / 128);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(small));
  console.log(`wrote ${out} (${small.width}x${small.height})`);
}
