// Size of the package's own code (the core package is a dependency, measured in
// packages/core; style-dictionary is a peer dependency and is never imported).
export default [
  {
    name: "style-dictionary adapter own code (gzip, core excluded)",
    path: "dist/index.js",
    gzip: true,
    ignore: ["@opal42/gradient"],
    limit: "4.6 kB",
    modifyEsbuildConfig(config) {
      config.platform = "node";
      config.format = "esm";
      return config;
    },
  },
];
