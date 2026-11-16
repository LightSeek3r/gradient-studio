// The real file system, stdin and process streams.

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import type { CliFs, CliIo } from "./io";

export const nodeFs: CliFs = {
  async stat(path) {
    const s = await stat(path);
    return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size };
  },
  async readdir(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDirectory: e.isDirectory(),
      isSymbolicLink: e.isSymbolicLink(),
    }));
  },
  async readFile(path) {
    return new Uint8Array(await readFile(path));
  },
  async writeFile(path, data) {
    await writeFile(path, data);
  },
};

/** Reads up to `limit` bytes of standard input, then stops reading. */
export async function readProcessStdin(limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    chunks.push(buf);
    total += buf.length;
    if (total >= limit) break;
  }
  return new Uint8Array(Buffer.concat(chunks).subarray(0, limit));
}

export function colorEnabled(env: NodeJS.ProcessEnv, isTTY: boolean | undefined): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;
  return Boolean(isTTY) && env.TERM !== "dumb";
}

export function nodeIo(version: string): CliIo {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    fs: nodeFs,
    readStdin: readProcessStdin,
    cwd: process.cwd(),
    color: colorEnabled(process.env, process.stdout.isTTY),
    version,
  };
}
