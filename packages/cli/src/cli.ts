#!/usr/bin/env node
// Thin wrapper: wires the real process to `run` and exits with its code.

import { readFileSync } from "node:fs";
import { nodeIo } from "./node-io";
import { run } from "./run";

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === "string" ? v : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

process.exitCode = await run(process.argv.slice(2), nodeIo(readVersion()));
