import { describe, expect, it } from "vitest";
import { nodeFs } from "../src/node-io";
import { discover, displayPath } from "../src/walk";
import { failingFs, put, tempDir } from "./helpers";
import { symlink } from "node:fs/promises";
import { join } from "node:path";

const paths = (r: Awaited<ReturnType<typeof discover>>): string[] => r.files.map((f) => f.path);

describe("discover", () => {
  it("walks a directory recursively in sorted order and filters by extension", async () => {
    const d = await tempDir();
    for (const f of ["b.css", "a.scss", "z/deep/x.vue", "z/y.html", "notes.txt", "img.png", "c.md", "d.mdx", "e.tsx", "f.json"]) {
      await put(d, f, "x");
    }
    const r = await discover(["."], d, nodeFs, []);
    expect(paths(r)).toEqual(["a.scss", "b.css", "c.md", "d.mdx", "e.tsx", "z/deep/x.vue", "z/y.html"]);
    expect(r.problems).toEqual([]);
  });

  it("covers every documented extension (and is case-insensitive)", async () => {
    const d = await tempDir();
    const exts = [".css", ".scss", ".sass", ".less", ".html", ".htm", ".vue", ".svelte", ".astro", ".jsx", ".tsx", ".js", ".mjs", ".ts", ".md", ".mdx"];
    for (const e of exts) await put(d, `f${e}`, "x");
    await put(d, "UP.CSS", "x");
    const r = await discover(["."], d, nodeFs, []);
    expect(r.files).toHaveLength(exts.length + 1);
  });

  it("skips node_modules, .git, dist, build and coverage at any depth", async () => {
    const d = await tempDir();
    for (const dir of ["node_modules", ".git", "dist", "build", "coverage", "src/node_modules", "src/dist"]) {
      await put(d, `${dir}/x.css`, "x");
    }
    await put(d, "src/ok.css", "x");
    await put(d, "builder/ok.css", "x");
    expect(paths(await discover(["."], d, nodeFs, []))).toEqual(["builder/ok.css", "src/ok.css"]);
  });

  it("searches an ignored directory name when it is named on the command line", async () => {
    const d = await tempDir();
    await put(d, "dist/x.css", "x");
    expect(paths(await discover(["dist"], d, nodeFs, []))).toEqual(["dist/x.css"]);
  });

  it("reads an explicitly named file whatever its extension", async () => {
    const d = await tempDir();
    await put(d, "styles.txt", "x");
    const r = await discover(["styles.txt"], d, nodeFs, []);
    expect(r.files).toMatchObject([{ path: "styles.txt", explicit: true, ignored: false }]);
  });

  it("applies --ignore to walked files and directories", async () => {
    const d = await tempDir();
    await put(d, "a.css", "x");
    await put(d, "a.min.css", "x");
    await put(d, "vendor/v.css", "x");
    await put(d, "src/gen/g.css", "x");
    await put(d, "src/keep.css", "x");
    const r = await discover(["."], d, nodeFs, ["*.min.css", "vendor", "src/gen/**"]);
    expect(paths(r)).toEqual(["a.css", "src/keep.css"]);
  });

  it("marks an ignored explicit file instead of dropping it", async () => {
    const d = await tempDir();
    await put(d, "a.min.css", "x");
    const r = await discover(["a.min.css"], d, nodeFs, ["*.min.css"]);
    expect(r.files).toMatchObject([{ path: "a.min.css", ignored: true }]);
  });

  it("lists a file once however it is reached", async () => {
    const d = await tempDir();
    await put(d, "a.css", "x");
    const r = await discover([".", "a.css", "./a.css"], d, nodeFs, []);
    expect(paths(r)).toEqual(["a.css"]);
  });

  it("reports a missing path as a problem and keeps going", async () => {
    const d = await tempDir();
    await put(d, "a.css", "x");
    const r = await discover(["nope.css", "a.css"], d, nodeFs, []);
    expect(paths(r)).toEqual(["a.css"]);
    expect(r.problems).toEqual([{ path: "nope.css", code: "ENOENT", message: "no such file or directory" }]);
  });

  it("reports an unreadable directory and still walks its siblings", async () => {
    const d = await tempDir();
    await put(d, "locked/a.css", "x");
    await put(d, "open/b.css", "x");
    const fs = failingFs((p) => p.endsWith("locked"), "EACCES", ["readdir"]);
    const r = await discover(["."], d, fs, []);
    expect(paths(r)).toEqual(["open/b.css"]);
    expect(r.problems).toMatchObject([{ path: "locked", code: "EACCES" }]);
  });

  it("follows symbolic links to files but not to directories", async () => {
    const d = await tempDir();
    await put(d, "real.css", "x");
    await put(d, "sub/inner.css", "x");
    await symlink(join(d, "real.css"), join(d, "link.css"));
    await symlink(join(d, "sub"), join(d, "linkdir"));
    await symlink(join(d, "missing.css"), join(d, "dangling.css"));
    expect(paths(await discover(["."], d, nodeFs, []))).toEqual(["link.css", "real.css", "sub/inner.css"]);
  });
});

describe("displayPath", () => {
  it("is relative to the working directory with / separators", () => {
    expect(displayPath("/w", "/w/a/b.css")).toBe("a/b.css");
  });
  it("keeps the absolute path outside the working directory", () => {
    expect(displayPath("/w/x", "/w/other/b.css")).toBe("/w/other/b.css");
  });
});
