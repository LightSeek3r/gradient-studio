// Turning command-line paths into the files to read. No glob dependency: the
// walker is a plain recursive readdir with an extension filter.

import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CliFs } from "./io";
import { compileIgnore, type IgnoreMatcher } from "./glob";
import { EXTENSIONS, IGNORED_DIRS } from "./limits";

export interface Discovered {
  /** Display path: relative to the working directory when inside it, always `/`-separated. */
  path: string;
  /** Path to open. */
  fsPath: string;
  /** Named on the command line (as opposed to found by walking a directory). */
  explicit: boolean;
  /** Matched an --ignore pattern. Only ever set for explicit files; walked files are just dropped. */
  ignored: boolean;
}

export interface Problem {
  path: string;
  code: string;
  message: string;
}

const MAX_DEPTH = 100;

export function displayPath(cwd: string, fsPath: string): string {
  const rel = relative(cwd, fsPath);
  const p = rel === "" ? "." : rel.startsWith("..") || isAbsolute(rel) ? fsPath : rel;
  return sep === "/" ? p : p.split(sep).join("/");
}

export function errorInfo(e: unknown): { code: string; message: string } {
  const code = e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string" ? (e as { code: string }).code : "EIO";
  const raw = e instanceof Error ? e.message : String(e);
  // Node's messages repeat the code and quote the path ("ENOENT: no such file or directory, open '/x'").
  const message = raw.replace(/^[A-Z0-9_]+:\s*/, "").replace(/,\s*(?:open|stat|scandir|lstat|read|write)\s+'[^']*'$/, "");
  return { code, message };
}

const hasWantedExtension = (name: string): boolean => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && EXTENSIONS.includes(name.slice(dot).toLowerCase());
};

export async function discover(
  inputs: readonly string[],
  cwd: string,
  fs: CliFs,
  ignorePatterns: readonly string[],
): Promise<{ files: Discovered[]; problems: Problem[] }> {
  const ignore: IgnoreMatcher = compileIgnore(ignorePatterns);
  const files: Discovered[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();

  const add = (fsPath: string, explicit: boolean): void => {
    if (seen.has(fsPath)) return;
    seen.add(fsPath);
    const path = displayPath(cwd, fsPath);
    const ignored = ignore.matches(path);
    if (ignored && !explicit) return;
    files.push({ path, fsPath, explicit, ignored });
  };

  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (e) {
      problems.push({ path: displayPath(cwd, dir), ...errorInfo(e) });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      let isDir = entry.isDirectory;
      let isFile = entry.isFile;
      if (entry.isSymbolicLink) {
        // Symbolic links to files are read; links to directories are not followed (no cycles).
        try {
          const s = await fs.stat(full);
          isFile = s.isFile;
          isDir = false;
        } catch {
          continue; // dangling link
        }
      }
      if (isDir) {
        if (IGNORED_DIRS.includes(entry.name)) continue;
        if (ignore.matches(displayPath(cwd, full))) continue;
        if (depth < MAX_DEPTH) await walk(full, depth + 1);
      } else if (isFile && hasWantedExtension(entry.name)) {
        add(full, false);
      }
    }
  };

  for (const input of inputs) {
    const fsPath = isAbsolute(input) ? resolve(input) : resolve(cwd, input);
    let st;
    try {
      st = await fs.stat(fsPath);
    } catch (e) {
      problems.push({ path: displayPath(cwd, fsPath), ...errorInfo(e) });
      continue;
    }
    if (st.isDirectory) await walk(fsPath, 0);
    else if (st.isFile) add(fsPath, true);
    else problems.push({ path: displayPath(cwd, fsPath), code: "ENOTSUP", message: "not a regular file or directory" });
  }
  return { files, problems };
}
