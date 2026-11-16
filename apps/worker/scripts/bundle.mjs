// Bundles the Worker exactly as `wrangler deploy` would, without deploying and
// without credentials (`--dry-run`), and reports its size.
//
//   npm run build -w opal42-mcp-worker
//
// Output: apps/worker/dist/index.js (+ source map). Workers limits (docs checked
// 2026-11): 64 MiB uncompressed on all plans; the old 3 MB (Free) compressed
// limit was removed in Sept 2026.

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
rmSync(out, { recursive: true, force: true });

const run = (args) =>
  spawnSync("npx", ["wrangler", "deploy", "--dry-run", "--outdir", out, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
  });

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;

for (const [label, args] of [
  ["default", []],
  ["minified", ["--minify"]],
]) {
  const r = run(args);
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr);
    process.exit(r.status ?? 1);
  }
  const js = readFileSync(join(out, "index.js"));
  const total = /Total Upload: ([^\n]+)/.exec(r.stdout)?.[1] ?? "?";
  console.log(`${label.padEnd(9)} index.js ${kib(js.length)}, gzip ${kib(gzipSync(js, { level: 9 }).length)}   (wrangler: Total Upload ${total})`);
}
console.log("Limit: 64 MiB uncompressed (Free and Paid). Nothing was uploaded.");
