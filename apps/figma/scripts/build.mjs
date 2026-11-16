// Bundle the plugin into dist/ (what "Import plugin from manifest" loads):
//
//   dist/manifest.json   copied from ./manifest.json
//   dist/code.js         src/code.ts, one file, no imports left (sandbox)
//   dist/ui.html         src/ui.template.html with src/ui-main.ts inlined
//
// No remote code, no external fonts, no network: everything is in these three
// files. The workspace package @opal42/gradient is bundled from its TypeScript
// source (package.json `source` condition). Target ES2017 so the sandbox does
// not depend on newer syntax (that it runs the result is NOT verified).
//
//   node scripts/build.mjs                 -> dist/
//   import { build } from "./build.mjs"    (the build test does this)

import { build as esbuild } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const common = {
  absWorkingDir: root,
  bundle: true,
  format: "iife",
  target: "es2017",
  conditions: ["source"],
  legalComments: "none",
  sourcemap: false,
  write: false,
  logLevel: "warning",
};

/** `</script` inside inlined code would end the tag early. */
const safeForScriptTag = (js) => js.replace(/<\/(script)/gi, "<\\/$1");

export async function build({ outdir = resolve(root, "dist"), minify = true } = {}) {
  const [sandbox, ui] = await Promise.all([
    esbuild({ ...common, entryPoints: ["src/code.ts"], platform: "neutral", minify }),
    esbuild({ ...common, entryPoints: ["src/ui-main.ts"], platform: "browser", minify }),
  ]);
  const template = await readFile(resolve(root, "src/ui.template.html"), "utf8");
  const marker = "/*__SCRIPT__*/";
  if (!template.includes(marker)) throw new Error("ui.template.html has no script marker");
  const code = sandbox.outputFiles[0].text;
  const html = template.replace(marker, () => safeForScriptTag(ui.outputFiles[0].text));

  await mkdir(outdir, { recursive: true });
  await Promise.all([
    writeFile(resolve(outdir, "code.js"), code),
    writeFile(resolve(outdir, "ui.html"), html),
    copyFile(resolve(root, "manifest.json"), resolve(outdir, "manifest.json")),
  ]);
  return {
    outdir,
    sizes: {
      "code.js": Buffer.byteLength(code),
      "ui.html": Buffer.byteLength(html),
      "manifest.json": (await readFile(resolve(root, "manifest.json"))).length,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outdir, sizes } = await build();
  console.log(`built ${outdir}`);
  for (const [name, bytes] of Object.entries(sizes)) console.log(`  ${name.padEnd(14)} ${(bytes / 1024).toFixed(1)} KiB`);
}
