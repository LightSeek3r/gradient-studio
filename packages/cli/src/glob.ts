// A tiny glob matcher for --ignore. Supported: `*` (any run of characters
// except `/`), `**` (any run, including `/`), `?` (one character except `/`).
// Everything else is literal. No character classes, no braces, no negation.

const MAX_PATTERN = 256;
const MAX_GLOBSTARS = 4;

/** Regular-expression source for one glob. Linear-time: consecutive `**` collapse. */
export function globToRegExpSource(glob: string): string {
  const g = glob.slice(0, MAX_PATTERN);
  let out = "";
  let globstars = 0;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        while (g[i + 1] === "*") i++;
        // More than a few `**` in one pattern would make matching super-linear;
        // the rest degrade to a plain `*`.
        if (++globstars > MAX_GLOBSTARS) {
          out += "[^/]*";
        } else if (g[i + 1] === "/") {
          i++;
          // `**/` matches zero or more directories; `**/**/` is the same thing.
          while (g[i + 1] === "*" && g[i + 2] === "*" && g[i + 3] === "/") i += 3;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
    }
  }
  return out;
}

export interface IgnoreMatcher {
  /** True when the posix-style relative path (or any of its parent directories) is ignored. */
  matches(relPath: string): boolean;
}

/**
 * Compile `--ignore` patterns.
 *  - A pattern without `/` matches any single path segment (`vendor`,
 *    `*.min.css`), like a .gitignore entry.
 *  - A pattern with `/` is anchored at the working directory
 *    (`src/legacy/**`, `**` + `/fixtures/*.css`); a leading `./` is dropped and
 *    a trailing `/` means "this directory and everything below".
 * A path is ignored when the pattern matches the path itself or one of its
 * parent directories.
 */
export function compileIgnore(patterns: readonly string[]): IgnoreMatcher {
  const segment: RegExp[] = [];
  const anchored: RegExp[] = [];
  for (const raw of patterns) {
    let p = raw.trim().replace(/\\/g, "/");
    while (p.startsWith("./")) p = p.slice(2);
    if (p === "" || p === "." || p === "/") continue;
    if (p.endsWith("/")) p = p.replace(/\/+$/, "");
    if (p === "") continue;
    if (p.includes("/")) {
      if (p.startsWith("/")) p = p.slice(1);
      anchored.push(new RegExp(`^${globToRegExpSource(p)}$`));
    } else {
      segment.push(new RegExp(`^${globToRegExpSource(p)}$`));
    }
  }
  return {
    matches(relPath: string): boolean {
      if (segment.length === 0 && anchored.length === 0) return false;
      const parts = relPath.split("/").filter((s) => s !== "" && s !== ".");
      for (let i = 0; i < parts.length; i++) {
        if (segment.some((re) => re.test(parts[i]))) return true;
        const prefix = parts.slice(0, i + 1).join("/");
        if (anchored.some((re) => re.test(prefix))) return true;
      }
      return false;
    },
  };
}
