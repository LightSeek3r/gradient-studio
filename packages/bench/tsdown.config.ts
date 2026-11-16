import { defineConfig } from "tsdown";

// `cli` is the executable (bin), `index` the importable library. The core
// package stays external: it is a declared dependency. The default brief set
// and package.json are JSON imports and get inlined.
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: "esm",
  platform: "node",
  fixedExtension: false,
  target: "node22",
  dts: true,
  clean: true,
  outDir: "dist",
});
