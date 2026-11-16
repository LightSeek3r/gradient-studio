// CLI: checks .output/chrome-mv3 and .output/firefox-mv3 against the allow-list.
// Exit 1 and print the problems when a build asks for anything not allow-listed.
// Run by `npm run build` (after both builds) and in CI.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFiles, checkManifest, type Allowlist } from "./manifest-check.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const allow = JSON.parse(readFileSync(join(root, "tests/permissions-allowlist.json"), "utf8")) as Allowlist;

function list(base: string, dir = base, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) list(base, path, out);
    else out.push(relative(base, path));
  }
  return out;
}

let failed = false;
for (const [dirName, browser] of [
  ["chrome-mv3", "chrome"],
  ["firefox-mv3", "firefox"],
] as const) {
  const dir = join(root, ".output", dirName);
  if (!existsSync(dir)) {
    console.error(`missing build output: ${dir} (run the build first)`);
    failed = true;
    continue;
  }
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
  const problems = [...checkManifest(manifest, allow, browser), ...checkFiles(list(dir), allow)];
  if (problems.length > 0) {
    failed = true;
    console.error(`${dirName}: manifest/permission check FAILED`);
    for (const p of problems) console.error(`  - ${p}`);
  } else {
    console.log(`${dirName}: permissions = [] (host_permissions = []), manifest and files match the allow-list`);
  }
}
process.exit(failed ? 1 : 0);
