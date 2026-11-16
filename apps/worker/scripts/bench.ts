// CPU benchmark of the Worker for the largest allowed inputs.
//
//   npm run bench -w opal42-mcp-worker
//
// Runs in Node (not workerd): the numbers are a proxy for CPU time. The Workers
// Free plan allows 10 ms of CPU per request; compare p95/max, not the median.
// process.hrtime.bigint() is wall time inside one synchronous call, which for
// CPU-bound code with no I/O is a fair upper bound of CPU time.

import { callTool, MAX_CSS_CHARS } from "@opal42/mcp/handlers";
import { MAX_STOPS_PER_REQUEST } from "../src/limits";
import { handleRequest, type Env } from "../src/worker";

const RUNS = Number(process.env.BENCH_RUNS ?? 300);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 30);

// Deterministic pseudo-random colours (no Math.random: repeatable inputs).
let seed = 42;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const hex = () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0")}`;

function gradientCss(stops: number): string {
  const parts = Array.from({ length: stops }, (_, i) => `${hex()} ${((i / (stops - 1)) * 100).toFixed(1)}%`);
  return `linear-gradient(${Math.floor(rnd() * 360)}deg, ${parts.join(", ")})`;
}

/** As many 32-stop gradients as fit under the css cap (the handlers examine at most 32). */
function maxCss(): string {
  let css = "";
  for (let i = 0; i < 32; i++) {
    const next = `.g${i}{background:${gradientCss(32)}}\n`;
    if (css.length + next.length > MAX_CSS_CHARS) break;
    css += next;
  }
  return css;
}

const css32 = maxCss();
const css1 = gradientCss(32);
const stops32 = Array.from({ length: 32 }, (_, i) => ({ color: hex(), position: (i / 31) * 100 }));
const hostileCss = ("linear-gradient(" + "(".repeat(50) + "red,").repeat(Math.floor(MAX_CSS_CHARS / 70)).slice(0, MAX_CSS_CHARS);
const junkCss = "linear-gradient(".repeat(Math.floor(MAX_CSS_CHARS / 16));

interface Case {
  name: string;
  run: () => unknown;
}

const direct = (tool: string, args: unknown): Case["run"] => () => callTool(tool, args);

const viaFetch = (tool: string, args: unknown, env: Env = {}): Case["run"] => () =>
  handleRequest(
    new Request("https://bench.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": tool },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: tool,
          arguments: args,
          _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "bench", version: "0" }, "io.modelcontextprotocol/clientCapabilities": {} },
        },
      }),
    }),
    env,
  );

interface BenchCase extends Case {
  runs?: number;
}

const cssAtCap = Array.from({ length: MAX_STOPS_PER_REQUEST / 32 }, () => `.g{background:${gradientCss(32)}}`).join("\n");

const cases: BenchCase[] = [
  // A. The tool handlers alone, at their own maximum inputs (no Worker guard): why the guard exists.
  { name: `handlers  score_gradient  css ${css32.length} chars, 32 x 32 stops`, run: direct("score_gradient", { css: css32 }) },
  { name: "handlers  score_gradient  1 gradient, 32 stops", run: direct("score_gradient", { css: css1 }) },
  { name: "handlers  refine_gradient 1 gradient, 2 stops", run: direct("refine_gradient", { css: gradientCss(2) }) },
  { name: "handlers  refine_gradient 1 gradient, 3 stops", run: direct("refine_gradient", { css: gradientCss(3) }) },
  { name: "handlers  refine_gradient 1 gradient, 8 stops", run: direct("refine_gradient", { css: gradientCss(8) }) },
  { name: "handlers  refine_gradient 1 gradient, 16 stops", run: direct("refine_gradient", { css: gradientCss(16) }), runs: 40 },
  { name: "handlers  refine_gradient 1 gradient, 32 stops", run: direct("refine_gradient", { css: css1 }), runs: 12 },
  { name: `handlers  refine_gradient css ${css32.length} chars, 32 x 32 stops`, run: direct("refine_gradient", { css: css32 }), runs: 2 },
  { name: "handlers  render_preview  32 stops, oklch, 2048 x 2048", run: direct("render_preview", { stops: stops32, interpolation: "oklch", width: 2048, height: 2048 }) },
  { name: "handlers  complement", run: direct("complement", { color: "oklch(70% 0.2 30)" }) },
  { name: "handlers  score_gradient  hostile nested css (20 KB)", run: direct("score_gradient", { css: hostileCss }) },
  { name: "handlers  score_gradient  junk css (20 KB of 'linear-gradient(')", run: direct("score_gradient", { css: junkCss }) },
  // B. The whole Worker (routing, body cap, JSON parse, SDK, guard, tool), largest requests the guard lets through.
  { name: `WORKER    score_gradient  ${MAX_STOPS_PER_REQUEST / 32} x 32 stops (guard maximum, ${MAX_STOPS_PER_REQUEST})`, run: viaFetch("score_gradient", { css: cssAtCap }) },
  { name: "WORKER    score_gradient  1 x 32 stops", run: viaFetch("score_gradient", { css: css1 }) },
  { name: "WORKER    refine_gradient 3 stops (Free-plan setting), REFINE_MAX_STOPS=3", run: viaFetch("refine_gradient", { css: gradientCss(3) }, { REFINE_MAX_STOPS: "3" }) },
  { name: "WORKER    refine_gradient 16 stops (default maximum)", run: viaFetch("refine_gradient", { css: gradientCss(16) }), runs: 40 },
  { name: `WORKER    render_preview  ${MAX_STOPS_PER_REQUEST / 32} gradients x 32 stops (css, guard maximum)`, run: viaFetch("render_preview", { css: cssAtCap }) },
  { name: "WORKER    render_preview  32 stops, oklch, 2048 x 2048", run: viaFetch("render_preview", { stops: stops32, interpolation: "oklch", width: 2048, height: 2048 }) },
  { name: "WORKER    complement (SDK overhead only)", run: viaFetch("complement", { color: "tomato" }) },
  { name: "WORKER    refused: score_gradient 32 x 32 stops (over the guard)", run: viaFetch("score_gradient", { css: css32 }) },
  { name: "WORKER    refused: refine_gradient 32 stops (over the guard)", run: viaFetch("refine_gradient", { css: css1 }) },
];

const ms = (ns: bigint): number => Number(ns) / 1e6;

async function time(run: Case["run"]): Promise<number> {
  const t0 = process.hrtime.bigint();
  await run();
  return ms(process.hrtime.bigint() - t0);
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
}

const rows: string[] = [];
for (const c of cases as BenchCase[]) {
  if (process.env.BENCH_VERBOSE) console.error("running", c.name);
  if (c.name.startsWith("WORKER")) {
    // Make sure we measure real work, not a refusal.
    const text = await ((await c.run()) as Response).text();
    const refused = text.includes('"isError":true');
    if (refused !== c.name.includes("refused:")) throw new Error(`unexpected ${refused ? "refusal" : "success"} for: ${c.name}`);
  }
  const first = await time(c.run); // includes JIT warm-up of this path: closest to a cold isolate
  for (let i = 0; i < Math.min(WARMUP, c.runs ?? WARMUP); i++) await c.run();
  const samples: number[] = [];
  for (let i = 0; i < (c.runs ?? RUNS); i++) samples.push(await time(c.run));
  samples.sort((a, b) => a - b);
  rows.push(`${c.name.padEnd(66)} first ${first.toFixed(2).padStart(7)}  p50 ${pct(samples, 50).toFixed(2).padStart(6)}  p95 ${pct(samples, 95).toFixed(2).padStart(6)}  max ${(samples.at(-1) as number).toFixed(2).padStart(6)}  (ms)`);
}

console.log(`Node ${process.version}, ${RUNS} runs after ${WARMUP} warm-up runs; 'first' is the very first call of that path in this process.`);
console.log("Workers Free plan CPU limit: 10 ms per request.\n");
for (const r of rows) console.log(r);
