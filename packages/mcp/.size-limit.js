// Size of the MCP package's own code (core and the MCP SDK are dependencies).
export default [
  {
    name: "handlers (gzip, core and SDK excluded)",
    path: "dist/handlers.js",
    gzip: true,
    ignore: ["@opal42/gradient"],
    limit: "7.8 kB",
    modifyEsbuildConfig(config) {
      config.platform = "node";
      config.format = "esm";
      return config;
    },
  },
];
