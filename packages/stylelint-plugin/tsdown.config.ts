import { defineConfig } from "tsdown";

// `@opal42/gradient` (dependency) and `stylelint` (peer) stay external.
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
