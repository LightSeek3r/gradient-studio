#!/usr/bin/env node
// opal42-mcp: serves the tools over stdio. No options besides --help/--version;
// anything on stdout would corrupt the protocol, so nothing else writes there.

import { readFileSync } from "node:fs";
import { serve } from "./server";

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === "string" ? v : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const HELP = `opal42-mcp ${readVersion()}

MCP server (stdio) for CSS gradient smoothness scoring. Stateless and local:
no network, no files written, no telemetry.

Usage: opal42-mcp            serve the tools on stdin/stdout
       opal42-mcp --help | --version

Tools: score_gradient, refine_gradient, complement, render_preview
Docs:  https://github.com/LightSeek3r/gradient-studio/blob/master/docs/mcp.md
`;

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${readVersion()}\n`);
} else if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
} else if (args.length > 0) {
  process.stderr.write(`opal42-mcp: unknown argument ${JSON.stringify(args[0])}\n\n${HELP}`);
  process.exitCode = 2;
} else {
  serve(readVersion());
}
