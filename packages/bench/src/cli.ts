#!/usr/bin/env node
// Thin wrapper: wires the real process to `run` and exits with its code.
import { nodeIo } from "./node-io";
import { run } from "./run-cli";

process.exitCode = await run(process.argv.slice(2), nodeIo());
