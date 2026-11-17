import { defineConfig } from "tsdown";

// Zero runtime dependencies: `@opal42/gradient` is a devDependency that is
// bundled into the output. Two builds:
//  1. `index` / `define`: the library entries (shared code lands in a chunk).
//  2. `opal42-element.js`: ONE self-contained, minified file (no imports) that
//     a plain <script type="module"> can load without a bundler.
const common = {
  format: "esm" as const,
  platform: "browser" as const,
  fixedExtension: false,
  target: "es2022",
  outDir: "dist",
  deps: { alwaysBundle: [/^@opal42\//], onlyBundle: false as const },
};

export default defineConfig([
  { ...common, entry: { index: "src/index.ts", define: "src/define.ts" }, dts: true, clean: false },
  { ...common, entry: { "opal42-element": "src/standalone.ts" }, dts: false, clean: false, minify: true },
]);
