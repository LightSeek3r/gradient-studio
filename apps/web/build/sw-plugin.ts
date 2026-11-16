// Vite plugin: after the app is built, bundle src/sw/sw.ts into dist/sw.js with
// a precache manifest generated from the files that were actually emitted.
// (vite-plugin-pwa/workbox-build was tried first and rejected: it pulls in
// dependencies that fail `npm audit`.) The worker's bytes change whenever any
// precached file changes, which is what makes browsers install the update.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { build, type Plugin } from "vite";
import { buildPrecacheManifest, manifestVersion, type BuiltFile } from "../src/sw/precache.ts";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

export function serviceWorkerPlugin(): Plugin {
  let outDir = "";
  let root = "";
  return {
    name: "gradient-studio:service-worker",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const files: BuiltFile[] = walk(outDir).map((file) => ({
        path: relative(outDir, file).split(sep).join("/"),
        hash: createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16),
      }));
      const manifest = buildPrecacheManifest(files);
      const version = manifestVersion(manifest);
      await build({
        configFile: false,
        root,
        logLevel: "warn",
        define: { __PRECACHE__: JSON.stringify(manifest), __SW_VERSION__: JSON.stringify(version) },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: true,
          target: "es2020",
          reportCompressedSize: false,
          lib: { entry: resolve(root, "src/sw/sw.ts"), formats: ["iife"], name: "GradientStudioServiceWorker", fileName: () => "sw.js" },
        },
      });
      console.log(`service worker: ${manifest.length} precached files, version ${version}`);
    },
  };
}
