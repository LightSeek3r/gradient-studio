import { defineConfig } from "tsdown";

// `cli` is the executable (bin), `index` the importable `run` function. The
// core package stays external: it is a declared dependency.
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
