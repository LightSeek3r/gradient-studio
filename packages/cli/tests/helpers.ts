import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import type { CliFs, CliIo } from "../src/io";
import { nodeFs } from "../src/node-io";
import { run } from "../src/run";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
export const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "golden");
export const TEST_VERSION = "0.0.0-test";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

/** A fresh empty temp directory, removed after the test. */
export async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "opal42-test-"));
  dirs.push(d);
  return d;
}

/** A temp directory holding a copy of the fixture files. */
export async function fixtureCopy(): Promise<string> {
  const d = await tempDir();
  await cp(FIXTURES, d, { recursive: true });
  return d;
}

export async function put(dir: string, rel: string, content: string | Uint8Array): Promise<string> {
  const full = join(dir, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}

export const read = (dir: string, rel: string): Promise<string> => readFile(join(dir, rel), "utf8");

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd: string;
  stdin?: string | Uint8Array;
  fs?: CliFs;
  color?: boolean;
}

export async function cli(args: string[], opts: RunOptions): Promise<Result> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: { write: (t) => void (stdout += t) },
    stderr: { write: (t) => void (stderr += t) },
    fs: opts.fs ?? nodeFs,
    readStdin: async (limit) => {
      const d = opts.stdin ?? "";
      const b = typeof d === "string" ? new TextEncoder().encode(d) : d;
      return b.subarray(0, limit);
    },
    cwd: opts.cwd,
    color: opts.color ?? false,
    version: TEST_VERSION,
  };
  const code = await run(args, io);
  return { code, stdout, stderr };
}

/** A file system whose operations on matching paths fail like the OS would. */
export function failingFs(match: (path: string) => boolean, code: string, ops: ("stat" | "readdir" | "readFile" | "writeFile")[]): CliFs {
  const guard =
    <A extends unknown[], R>(op: (typeof ops)[number], fn: (path: string, ...a: A) => Promise<R>) =>
    async (path: string, ...a: A): Promise<R> => {
      if (ops.includes(op) && match(path)) {
        throw Object.assign(new Error(`${code}: operation failed, ${op} '${path}'`), { code });
      }
      return fn(path, ...a);
    };
  return {
    stat: guard("stat", nodeFs.stat),
    readdir: guard("readdir", nodeFs.readdir),
    readFile: guard("readFile", nodeFs.readFile),
    writeFile: guard("writeFile", nodeFs.writeFile),
  };
}

/** Compare with tests/golden/<name>; `UPDATE_GOLDEN=1 npx vitest run` rewrites the files. */
export async function golden(name: string, actual: string): Promise<{ actual: string; expected: string }> {
  const file = join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN) {
    await mkdir(GOLDEN, { recursive: true });
    await writeFile(file, actual);
  }
  return { actual, expected: await readFile(file, "utf8") };
}
