/** Files larger than this are skipped with a notice (also the parser's input cap). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** How many bytes of a file are inspected for a NUL byte to call it binary. */
export const BINARY_SNIFF_BYTES = 8192;

/** Extensions searched when a directory is walked. Explicitly named files are always read. */
export const EXTENSIONS: readonly string[] = [
  ".css", ".scss", ".sass", ".less",
  ".html", ".htm", ".vue", ".svelte", ".astro",
  ".jsx", ".tsx", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts",
  ".md", ".mdx",
];

/** Directory names never entered while walking (a root named on the command line is searched). */
export const IGNORED_DIRS: readonly string[] = ["node_modules", ".git", "dist", "build", "coverage"];
