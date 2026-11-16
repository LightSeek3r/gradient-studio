// Bundle src/extension.ts into dist/extension.js (CommonJS, what VS Code loads).
// `vscode` stays external (the host provides it); everything else, including
// the workspace package @opal42/gradient, is bundled so the .vsix is
// self-contained and has no runtime dependencies.
//
//   node scripts/build.mjs          -> dist/extension.js
//   import { build } from "./build.mjs"   (the smoke test does this)

import { build as esbuild } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function build({ outfile = resolve(root, "dist/extension.js"), minify = true } = {}) {
  const result = await esbuild({
    absWorkingDir: root,
    entryPoints: ["src/extension.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    // Resolve @opal42/gradient to its TypeScript source (package.json `source` condition).
    conditions: ["source"],
    minify,
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
  });
  return { outfile, metafile: result.metafile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outfile } = await build();
  console.log(`built ${outfile}`);
}
