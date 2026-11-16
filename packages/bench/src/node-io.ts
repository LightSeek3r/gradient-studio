import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { BenchIo } from "./io";

async function readAll(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf8");
}

export function nodeIo(): BenchIo {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    readFile: (p) => readFile(p, "utf8"),
    writeFile: (p, t) => writeFile(p, t, "utf8"),
    mkdir: async (p) => {
      await mkdir(p, { recursive: true });
    },
    readStdin: () => readAll(process.stdin as AsyncIterable<Buffer | string>),
  };
}
