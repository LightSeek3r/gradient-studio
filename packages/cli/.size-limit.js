// Size of the CLI's own code (the core package is a dependency, measured in
// packages/core). Bundled for Node so the node: imports resolve.
export default [
  {
    name: "CLI own code (gzip, core excluded)",
    path: "dist/cli.js",
    gzip: true,
    ignore: ["@opal42/gradient"],
    limit: "10.5 kB",
    modifyEsbuildConfig(config) {
      config.platform = "node";
      config.format = "esm";
      return config;
    },
  },
];
