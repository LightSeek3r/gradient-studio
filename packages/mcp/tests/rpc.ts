import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const serverBin = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
export const coreDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "dist", "index.js");
export const built = existsSync(serverBin) && existsSync(coreDist);

export const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "opal42-mcp-tests", version: "0.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = any;

/** A minimal newline-delimited JSON-RPC client for the stdio server. Every wait has a timeout. */
export class StdioClient {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stderr: string[] = [];
  readonly lines: string[] = [];
  private pending = new Map<number, { resolve: (m: Msg) => void; timer: ReturnType<typeof setTimeout> }>();
  private buf = "";
  private nextId = 1;
  exited: Promise<number | null>;

  constructor(args: string[] = []) {
    this.child = spawn(process.execPath, [serverBin, ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "test" } });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
    this.exited = new Promise((res) => this.child.on("close", (code) => res(code)));
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line.trim() === "") continue;
      this.lines.push(line);
      const msg = JSON.parse(line); // a non-JSON line on stdout would corrupt the protocol: let it throw
      const waiter = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
      if (waiter) {
        clearTimeout(waiter.timer);
        this.pending.delete(msg.id);
        waiter.resolve(msg);
      }
    }
  }

  send(message: Msg): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  sendRaw(text: string): void {
    this.child.stdin.write(text);
  }

  request(method: string, params?: Msg, timeoutMs = 10_000): Promise<Msg> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs} ms waiting for ${method} (id ${id})`));
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  /** A 2026-07-28 request: no initialize, the protocol version travels in `_meta`. */
  modern(method: string, params: Msg = {}, timeoutMs?: number): Promise<Msg> {
    return this.request(method, { ...params, _meta: MODERN_META }, timeoutMs);
  }

  callTool(name: string, args: Msg): Promise<Msg> {
    return this.modern("tools/call", { name, arguments: args });
  }

  /** Closes stdin, then kills the process if it has not exited on its own. */
  async close(): Promise<void> {
    for (const w of this.pending.values()) clearTimeout(w.timer);
    this.pending.clear();
    this.child.stdin.end();
    const killer = setTimeout(() => this.child.kill("SIGKILL"), 3000);
    await this.exited;
    clearTimeout(killer);
  }
}
