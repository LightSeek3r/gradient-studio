import { defineConfig } from "tsdown";

// `@opal42/gradient` (dependency) stays external; `style-dictionary` is never imported (the user passes it to `register`).
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "node",
  fixedExtension: false,
  target: "node22",
  dts: true,
  clean: true,
  outDir: "dist",
});
