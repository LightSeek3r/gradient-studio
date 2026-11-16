import { defineConfig } from "tsdown";

// `cli` is the executable (bin), `index` the importable server factory and
// `handlers` the transport-independent tool handlers (no SDK, no Node). The
// core package and the MCP SDK stay external: they are declared dependencies.
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts", handlers: "src/handlers.ts" },
  format: "esm",
  platform: "node",
  fixedExtension: false,
  target: "node22",
  dts: true,
  clean: true,
  outDir: "dist",
});
