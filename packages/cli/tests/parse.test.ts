import { describe, expect, it } from "vitest";
import type { ParseReport } from "../src/types";
import { cli, fixtureCopy, put, tempDir } from "./helpers";

const json = (s: string): ParseReport => JSON.parse(s) as ParseReport;

describe("parse (debug)", () => {
  it("prints each gradient with its range and stop ranges", async () => {
    const cwd = await tempDir();
    await put(cwd, "a.css", "a { background: linear-gradient(90deg, #ff0000, #0000ff 80%); }\n");
    const r = await cli(["parse", "a.css"], { cwd });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("a.css:1:17  linear-gradient  [16,");
    expect(r.stdout).toContain('direction  1:33-38  [32,37)  "90deg"');
    expect(r.stdout).toContain('stop 1  1:49-60  [48,59)  "#0000ff 80%"');
  });

  it("--json has the document and located ranges", async () => {
    const cwd = await tempDir();
    await put(cwd, "a.css", "x{background:linear-gradient(to right,red,blue)}");
    const rep = json((await cli(["parse", "--json", "a.css"], { cwd })).stdout);
    expect(rep.command).toBe("parse");
    const g = rep.files[0].gradients[0];
    expect(g.document).toMatchObject({ kind: "linear", angle: 90 });
    expect(g.angleRange).toMatchObject({ text: "to right" });
    expect(g.stopRanges.map((s) => s.text)).toEqual(["red", "blue"]);
  });

  it("lists skipped gradients with their code", async () => {
    const cwd = await tempDir();
    await put(cwd, "a.css", "a{background:linear-gradient(red,var(--x))}");
    const rep = json((await cli(["parse", "--json", "a.css"], { cwd })).stdout);
    expect(rep.files[0].gradients[0].skipped?.code).toBe("var");
    expect(rep.files[0].gradients[0].document).toBeNull();
    expect(rep.summary).toMatchObject({ gradients: 1, skipped: 1 });
  });

  it("reports parser warnings", async () => {
    const cwd = await tempDir();
    await put(cwd, "a.css", "a{background:linear-gradient(to top right,red,blue)}");
    const rep = json((await cli(["parse", "--json", "a.css"], { cwd })).stdout);
    expect(rep.files[0].gradients[0].warnings.map((w) => w.code)).toEqual(["corner-angle"]);
  });

  it("reads stdin and exits 3 on a missing file", async () => {
    const cwd = await tempDir();
    const ok = await cli(["parse", "-"], { cwd, stdin: "linear-gradient(red, blue)" });
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("<stdin>:1:1  linear-gradient");
    expect((await cli(["parse", "nope.css"], { cwd })).code).toBe(3);
  });

  it("works over the fixtures and respects --ignore", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["parse", "--json", "--ignore", "skipped.css", "."], { cwd })).stdout);
    expect(rep.files.map((f) => f.path)).not.toContain("skipped.css");
    expect(rep.summary.exitCode).toBe(0);
  });
});
