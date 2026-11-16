// Size of the plugin's own code (the core package is a dependency, measured in
// packages/core; stylelint is a peer dependency).
export default [
  {
    name: "stylelint plugin own code (gzip, core and stylelint excluded)",
    path: "dist/index.js",
    gzip: true,
    ignore: ["@opal42/gradient", "stylelint"],
    limit: "4.5 kB",
    modifyEsbuildConfig(config) {
      config.platform = "node";
      config.format = "esm";
      return config;
    },
  },
];
