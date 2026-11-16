// Size of the bench's own code (the core package is a dependency, measured in
// packages/core). The default brief set is inlined, so it is part of the budget.
export default [
  {
    name: "bench own code (gzip, core excluded)",
    path: "dist/cli.js",
    gzip: true,
    ignore: ["@opal42/gradient"],
    limit: "28 kB",
    modifyEsbuildConfig(config) {
      config.platform = "node";
      config.format = "esm";
      return config;
    },
  },
];
