import { defineConfig } from "tsdown";

// ESM only, no sourcemaps, unminified (consumers' bundlers minify). Every
// public entry is a separate subpath of the `exports` map in package.json;
// shared code lands in one hashed chunk next to them.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    color: "src/color.ts",
    names: "src/names.ts",
    css: "src/css.ts",
  },
  format: "esm",
  platform: "neutral",
  target: "es2022",
  dts: true,
  clean: true,
  outDir: "dist",
});
