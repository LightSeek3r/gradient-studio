// Everything is bundled (zero runtime dependencies), so the budgets cover the
// core code the element pulls in. Measured + about 10 %; see docs/element.md.
export default [
  {
    name: "standalone ESM file (gzip, core bundled)",
    path: "dist/opal42-element.js",
    gzip: true,
    limit: "30 kB",
  },
  {
    name: "import { defineElements } from the library entry (gzip, core bundled)",
    path: "dist/index.js",
    import: "{ defineElements }",
    gzip: true,
    limit: "30.1 kB",
  },
  {
    name: "import { analyzeCss } only, no elements (gzip, core bundled)",
    path: "dist/index.js",
    import: "{ analyzeCss }",
    gzip: true,
    limit: "25.9 kB",
  },
];
