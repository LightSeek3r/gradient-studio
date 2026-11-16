import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colorEnabled, nodeIo, readProcessStdin } from "../src/node-io";
import { tempDir, put } from "./helpers";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const coreDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "dist", "index.js");

describe("colorEnabled", () => {
  it("honours NO_COLOR, FORCE_COLOR and the terminal", () => {
    expect(colorEnabled({ NO_COLOR: "1" }, true)).toBe(false);
    expect(colorEnabled({ NO_COLOR: "" }, true)).toBe(true);
    expect(colorEnabled({ FORCE_COLOR: "1" }, false)).toBe(true);
    expect(colorEnabled({ FORCE_COLOR: "0" }, false)).toBe(false);
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({}, false)).toBe(false);
    expect(colorEnabled({ TERM: "dumb" }, true)).toBe(false);
  });
});

describe("nodeIo", () => {
  it("wires the process streams and the given version", () => {
    const io = nodeIo("9.9.9");
    expect(io.version).toBe("9.9.9");
    expect(io.cwd).toBe(process.cwd());
    expect(io.stdout).toBe(process.stdout);
    expect(typeof readProcessStdin).toBe("function");
  });
});

// These run the built executable; they are skipped before `npm run build`.
describe.skipIf(!existsSync(dist) || !existsSync(coreDist))("built executable", () => {
  const exec = (args: string[], opts: { cwd?: string; input?: string } = {}) =>
    spawnSync(process.execPath, [dist, ...args], { cwd: opts.cwd, input: opts.input, encoding: "utf8" });

  it("--version prints the package version", () => {
    const r = exec(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("scores standard input and exits with the right code", () => {
    const r = exec(["score", "--min-score", "90", "-"], { input: "a{background:linear-gradient(90deg,#ff0000,#00ff00 50%,#0000ff)}" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("<stdin>:1:14  smoothness score 58/100");
  });

  it("exits 2 on a usage error and 3 on a missing file", async () => {
    const dir = await tempDir();
    expect(exec(["score", "--bogus", "x"]).status).toBe(2);
    expect(exec(["score", "missing.css"], { cwd: dir }).status).toBe(3);
  });

  it("scores a file on disk", async () => {
    const dir = await tempDir();
    await put(dir, "a.css", "a{background:linear-gradient(#003366,#99ccff)}");
    const r = exec(["score", "--json", "a.css"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).files[0].gradients[0].score).toBe(95);
  });
});
