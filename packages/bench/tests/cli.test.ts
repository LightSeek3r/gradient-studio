import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF_SET } from "../src/briefs";
import { CAVEAT } from "../src/constants";
import { run } from "../src/run-cli";
import { memIo, readText } from "./helpers";

const results = readText("examples/synthetic-results.jsonl");
const line = (o: object) => JSON.stringify(o) + "\n";
const ok = line({ briefId: "saas-hero-01", model: "m", condition: "baseline", output: "linear-gradient(135deg,#7f00ff,#e100ff,#00c6ff)" }) + line({ briefId: "saas-hero-01", model: "m", condition: "with-skill", output: "linear-gradient(135deg,#4f46e5,#4f8ae5,#5ec3e8)" });

describe("opal42-bench help and usage", () => {
  it("no command: usage on stderr, exit 2", async () => {
    const io = memIo();
    expect(await run([], io)).toBe(2);
    expect(io.err()).toMatch(/Usage:/);
    expect(io.out()).toBe("");
  });

  it("--help prints usage and the caveat, exit 0", async () => {
    const io = memIo();
    expect(await run(["--help"], io)).toBe(0);
    expect(io.out()).toMatch(/validate-briefs/);
    expect(io.out()).toContain(CAVEAT);
    expect(await run(["score", "--help"], memIo())).toBe(0);
  });

  it("--version", async () => {
    const io = memIo();
    expect(await run(["--version"], io)).toBe(0);
    expect(io.out()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.each([
    [["frobnicate"]],
    [["score"]],
    [["score", "--nope", "x"]],
    [["score", "--out"]],
    [["report", "a.json"]],
    [["report", "--out", "d"]],
    [["prompts", "extra"]],
    [["prompts", "--condition", "mine"]],
    [["validate-briefs", "a", "b"]],
    [["score", "--strict=1", "x"]],
  ])("usage errors exit 2: %j", async (argv) => {
    const io = memIo();
    expect(await run(argv, io)).toBe(2);
    expect(io.err()).toMatch(/opal42-bench:/);
  });
});

describe("validate-briefs", () => {
  it("accepts the shipped set", async () => {
    const io = memIo();
    expect(await run(["validate-briefs"], io)).toBe(0);
    expect(io.out()).toMatch(/^ok: 100 briefs in 10 categories, hash [0-9a-f]{16}\n$/);
  });

  it("accepts a file and rejects invalid ones with exit 1", async () => {
    const good = JSON.stringify(DEFAULT_BRIEF_SET);
    expect(await run(["validate-briefs", "b.json"], memIo({ "b.json": good }))).toBe(0);
    const bad = JSON.stringify({ ...DEFAULT_BRIEF_SET, briefs: [{ id: "x", category: "y", brief: "short" }] });
    const io = memIo({ "b.json": bad });
    expect(await run(["validate-briefs", "b.json"], io)).toBe(1);
    expect(io.err()).toMatch(/problem/);
    expect(await run(["validate-briefs", "missing.json"], memIo())).toBe(1);
    expect(await run(["validate-briefs", "b.json"], memIo({ "b.json": "{" }))).toBe(1);
  });
});

describe("prompts", () => {
  const parse = (s: string) => s.trim().split("\n").map((l) => JSON.parse(l) as { briefId: string; category: string; condition: string; prompt: string });

  it("emits one baseline prompt per brief by default", async () => {
    const io = memIo();
    expect(await run(["prompts"], io)).toBe(0);
    const lines = parse(io.out());
    expect(lines).toHaveLength(100);
    expect(lines.every((l) => l.condition === "baseline")).toBe(true);
    expect(lines[0]!.prompt).toContain(DEFAULT_BRIEF_SET.briefs[0]!.brief);
    expect(lines[0]!.prompt).not.toMatch(/SKILL\.md/);
  });

  it("--with-skill adds the with-skill condition pointing at the skill file", async () => {
    const io = memIo();
    expect(await run(["prompts", "--condition", "baseline", "--with-skill"], io)).toBe(0);
    const lines = parse(io.out());
    expect(lines).toHaveLength(200);
    const skill = lines.filter((l) => l.condition === "with-skill");
    expect(skill).toHaveLength(100);
    expect(skill.every((l) => l.prompt.includes("skills/gradient-quality/SKILL.md"))).toBe(true);
    expect(lines.filter((l) => l.condition === "baseline").every((l) => !l.prompt.includes("SKILL.md"))).toBe(true);
  });

  it("renders constraints and brand colours", async () => {
    const io = memIo();
    await run(["prompts"], io);
    const l = parse(io.out()).find((x) => x.briefId === "brand-constrained-01")!;
    expect(l.prompt).toMatch(/Constraints:\n- Use only the brand colours/);
    expect(l.prompt).toContain("Brand colours: #0b3d91, #f2b705");
    expect(l.prompt).not.toContain("{{");
  });

  it("supports custom conditions, a prefix, a template and --out", async () => {
    const io = memIo({ "extra.txt": "Think step by step.", "pre.txt": "SYSTEM {{id}}", "tpl.txt": "Brief: {{brief}}" });
    expect(await run(["prompts", "--condition", "cot=extra.txt", "--prefix", "pre.txt", "--template", "tpl.txt", "--out", "p.jsonl"], io)).toBe(0);
    const lines = parse(io.files.get("p.jsonl")!);
    expect(lines[0]).toMatchObject({ condition: "cot", briefId: "saas-hero-01" });
    expect(lines[0]!.prompt).toBe(`SYSTEM saas-hero-01\n\nBrief: ${DEFAULT_BRIEF_SET.briefs[0]!.brief}\n\nThink step by step.`);
    expect(io.out()).toBe("");
  });

  it("is deterministic", async () => {
    const a = memIo();
    const b = memIo();
    await run(["prompts", "--with-skill"], a);
    await run(["prompts", "--with-skill"], b);
    expect(a.out()).toBe(b.out());
  });

  it("reports unreadable inputs with exit 1", async () => {
    expect(await run(["prompts", "--briefs", "nope.json"], memIo())).toBe(1);
    expect(await run(["prompts", "--prefix", "nope.txt"], memIo())).toBe(1);
    expect(await run(["prompts", "--condition", "x=nope.txt"], memIo())).toBe(1);
  });
});

describe("score", () => {
  it("scores a results file to stdout as summary JSON", async () => {
    const io = memIo({ "r.jsonl": ok });
    expect(await run(["score", "r.jsonl"], io)).toBe(0);
    const s = JSON.parse(io.out());
    expect(s.schemaVersion).toBe(1);
    expect(s.caveat).toBe(CAVEAT);
    expect(s.records).toHaveLength(2);
    expect(s.provenance.sources).toEqual(["r.jsonl"]);
  });

  it("writes --out and keeps stdout empty", async () => {
    const io = memIo({ "r.jsonl": ok });
    expect(await run(["score", "r.jsonl", "--out", "s.json"], io)).toBe(0);
    expect(io.out()).toBe("");
    expect(JSON.parse(io.files.get("s.json")!).records).toHaveLength(2);
  });

  it("reads stdin with -", async () => {
    const io = memIo({}, ok);
    expect(await run(["score", "-"], io)).toBe(0);
    expect(JSON.parse(io.out()).provenance.sources).toEqual(["<stdin>"]);
  });

  it("merges several files", async () => {
    const io = memIo({ "a.jsonl": ok, "b.jsonl": ok.replaceAll('"m"', '"n"') });
    expect(await run(["score", "a.jsonl", "b.jsonl"], io)).toBe(0);
    expect(JSON.parse(io.out()).records).toHaveLength(4);
  });

  it("warns about bad lines but succeeds; --strict turns warnings into exit 1", async () => {
    const files = { "r.jsonl": ok + "{broken\n" + line({ briefId: "nope-01", model: "m", condition: "c", output: "" }) };
    const io = memIo(files);
    expect(await run(["score", "r.jsonl"], io)).toBe(0);
    expect(io.err()).toMatch(/r\.jsonl:3 invalid-json/);
    expect(io.err()).toMatch(/unknown-brief/);
    expect(JSON.parse(io.out()).diagnostics).toHaveLength(2);
    expect(await run(["score", "r.jsonl", "--strict"], memIo(files))).toBe(1);
    expect(await run(["score", "r.jsonl", "--strict"], memIo({ "r.jsonl": ok }))).toBe(0);
  });

  it("exit 1 when nothing can be scored or a file is unreadable", async () => {
    expect(await run(["score", "missing.jsonl"], memIo())).toBe(1);
    expect(await run(["score", "e.jsonl"], memIo({ "e.jsonl": "" }))).toBe(1);
    expect(await run(["score", "e.jsonl"], memIo({ "e.jsonl": "{x\n" }))).toBe(1);
    expect(await run(["score", "r.jsonl", "--briefs", "missing.json"], memIo({ "r.jsonl": ok }))).toBe(1);
    expect(await run(["score", "r.jsonl", "--out", "/readonly/x.json"], memIo({ "r.jsonl": ok }))).toBe(1);
  });

  it("uses --tailwind-palette to resolve palette classes", async () => {
    const tw = line({ briefId: "saas-hero-01", model: "m", condition: "baseline", output: '<div class="bg-gradient-to-r from-indigo-500 to-purple-600">' });
    const without = JSON.parse((await (async () => { const io = memIo({ "r.jsonl": tw }); await run(["score", "r.jsonl"], io); return io.out(); })()));
    expect(without.records[0].gradients[0]).toMatchObject({ status: "skipped", code: "tailwind-palette-colour" });
    const io = memIo({ "r.jsonl": tw, "p.json": JSON.stringify({ "indigo-500": "#6366f1", "purple-600": "#9333ea", bad: "nope" }) });
    expect(await run(["score", "r.jsonl", "--tailwind-palette", "p.json"], io)).toBe(0);
    const s = JSON.parse(io.out());
    expect(s.records[0].gradients[0].status).toBe("scored");
    expect(s.provenance.extraction.tailwindPaletteEntries).toBe(2);
    expect(s.diagnostics.map((d: { code: string }) => d.code)).toContain("invalid-palette-entry");
    expect(await run(["score", "r.jsonl", "--tailwind-palette", "q.json"], memIo({ "r.jsonl": tw }))).toBe(1);
    expect(await run(["score", "r.jsonl", "--tailwind-palette", "p.json"], memIo({ "r.jsonl": tw, "p.json": "[]" }))).toBe(1);
  });

  it("matches the committed example summary byte for byte", async () => {
    const io = memIo({ "synthetic-results.jsonl": results });
    expect(await run(["score", "synthetic-results.jsonl"], io)).toBe(0);
    expect(io.out()).toBe(readText("examples/synthetic-report/summary.json"));
  });
});

describe("report", () => {
  it("writes summary.json, report.md and leaderboard.html", async () => {
    const io = memIo({ "synthetic-results.jsonl": results });
    await run(["score", "synthetic-results.jsonl", "--out", "s.json"], io);
    expect(await run(["report", "s.json", "--out", "out/"], io)).toBe(0);
    expect(io.dirs).toEqual(["out"]);
    expect(io.files.get("out/summary.json")).toBe(readText("examples/synthetic-report/summary.json"));
    expect(io.files.get("out/report.md")).toBe(readText("examples/synthetic-report/report.md"));
    expect(io.files.get("out/leaderboard.html")).toBe(readText("examples/synthetic-report/leaderboard.html"));
  });

  it("merges summaries; rejects other brief sets, junk and unwritable directories", async () => {
    const io = memIo({ "r.jsonl": ok });
    await run(["score", "r.jsonl", "--out", "a.json"], io);
    await run(["score", "r.jsonl", "--out", "b.json"], io);
    expect(await run(["report", "a.json", "b.json", "--out", "o"], io)).toBe(0);
    expect(JSON.parse(io.files.get("o/summary.json")!).diagnostics.some((d: { code: string }) => d.code === "duplicate-record")).toBe(true);

    const other = JSON.parse(io.files.get("a.json")!);
    other.provenance.briefSet.hash = "0000000000000000";
    io.files.set("c.json", JSON.stringify(other));
    expect(await run(["report", "a.json", "c.json", "--out", "o2"], io)).toBe(1);
    expect(io.err()).toMatch(/brief-set hash/);

    io.files.set("junk.json", "{}");
    expect(await run(["report", "junk.json", "--out", "o3"], io)).toBe(1);
    io.files.set("nojson.json", "{");
    expect(await run(["report", "nojson.json", "--out", "o3"], io)).toBe(1);
    expect(await run(["report", "missing.json", "--out", "o3"], io)).toBe(1);
    expect(await run(["report", "a.json", "--out", "/readonly/x"], io)).toBe(1);
  });

  it("has no flag that removes the caveat", async () => {
    const io = memIo({ "r.jsonl": ok });
    await run(["score", "r.jsonl", "--out", "a.json"], io);
    expect(await run(["report", "a.json", "--out", "o", "--no-caveat"], io)).toBe(2);
    expect(io.files.get("o/report.md")).toBeUndefined();
  });
});

describe("robustness", () => {
  it("never throws, even when io misbehaves", async () => {
    const io = memIo({ "r.jsonl": ok });
    io.stdout.write = () => {
      throw new Error("EPIPE");
    };
    expect(await run(["score", "r.jsonl"], io)).toBe(0);
    const bad = memIo();
    bad.readFile = () => {
      throw new Error("sync boom");
    };
    expect(await run(["score", "x"], bad)).toBe(1);
    const worse = memIo();
    worse.stderr.write = () => {
      throw new Error("closed");
    };
    expect(await run(["nope"], worse)).toBe(2);
  });
});
