import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchIo } from "../src/io";

export const here = (p: string): string => join(dirname(fileURLToPath(import.meta.url)), "..", p);
export const readText = (p: string): string => readFileSync(here(p), "utf8");

export interface MemIo extends BenchIo {
  out: () => string;
  err: () => string;
  files: Map<string, string>;
  dirs: string[];
}

/** In-memory io. `files` maps paths to text; reads of other paths reject like a missing file. */
export function memIo(files: Record<string, string> = {}, stdin = ""): MemIo {
  const map = new Map(Object.entries(files));
  const out: string[] = [];
  const err: string[] = [];
  const dirs: string[] = [];
  return {
    stdout: { write: (t) => out.push(t) },
    stderr: { write: (t) => err.push(t) },
    readFile: async (p) => {
      const v = map.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFile: async (p, t) => {
      if (p.startsWith("/readonly/")) throw new Error("EACCES");
      map.set(p, t);
    },
    mkdir: async (p) => {
      if (p.startsWith("/readonly")) throw new Error("EACCES");
      dirs.push(p);
    },
    readStdin: async () => stdin,
    out: () => out.join(""),
    err: () => err.join(""),
    files: map,
    dirs,
  };
}
