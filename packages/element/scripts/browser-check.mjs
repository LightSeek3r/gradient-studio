// Real-browser check of the built ESM (run locally, not in CI):
//   npm run build -w @opal42/gradient && npm run build -w @opal42/element
//   npm run browser -w @opal42/element
// Serves packages/element with python3 on a fresh port, loads demo/index.html in
// Chromium (light, dark, forced colours, narrow), fails on console errors,
// network requests off the local server and swatches without a gradient, runs
// axe-core WITH colour contrast against the live page and saves screenshots.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 4203);
const out = join(root, "demo", "screenshots");
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);
await new Promise((r) => setTimeout(r, 800));

const executablePath = process.env.OPAL42_CHROME ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const problems = [];
const origin = `http://127.0.0.1:${port}`;

for (const [name, opts, viewport] of [
  ["light", { colorScheme: "light" }, { width: 960, height: 1500 }],
  ["dark", { colorScheme: "dark" }, { width: 960, height: 1500 }],
  ["forced-colors", { colorScheme: "light", forcedColors: "active" }, { width: 960, height: 1500 }],
  ["narrow", { colorScheme: "light" }, { width: 360, height: 1800 }],
]) {
  const ctx = await browser.newContext({ ...opts, viewport });
  const page = await ctx.newPage();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && problems.push(`${name} console ${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  await page.goto(`${origin}/demo/index.html`);
  await page.waitForSelector("html[data-ready]");
  await page.waitForTimeout(300);

  const off = requests.filter((u) => !u.startsWith(origin) && !u.startsWith("data:"));
  if (off.length) problems.push(`${name}: requests off the local server: ${off.join(", ")}`);

  // Swatches really painted something, and the page's `display:none !important` did not leak in.
  const swatches = await page.evaluate(() =>
    [...document.querySelectorAll("opal42-gradient-score, opal42-gradient-preview")].flatMap((host) =>
      [...host.shadowRoot.querySelectorAll(".swatch")].map((s) => {
        const cs = getComputedStyle(s);
        const r = s.getBoundingClientRect();
        return { host: host.id, image: cs.backgroundImage.slice(0, 40), display: cs.display, w: Math.round(r.width), h: Math.round(r.height) };
      }),
    ),
  );
  for (const s of swatches) {
    if (!s.image.includes("gradient")) problems.push(`${name}: swatch of #${s.host} has no gradient (${s.image})`);
    if (s.display === "none" || s.w < 20 || s.h < 10) problems.push(`${name}: swatch of #${s.host} not visible (${JSON.stringify(s)})`);
  }
  console.log(`${name}: ${swatches.length} swatches, e.g. ${JSON.stringify(swatches[0])}`);

  // axe with colour contrast against the real rendering.
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => (await window.axe.run(document, { rules: { region: { enabled: false } } })).violations.map((v) => ({ id: v.id, n: v.nodes.length, sample: v.nodes[0].html.slice(0, 120) })));
  // The demo's own textarea label etc. are in scope; forced-colors contrast is the UA's job.
  for (const v of violations) if (!(name === "forced-colors" && v.id === "color-contrast")) problems.push(`${name} axe ${v.id} x${v.n}: ${v.sample}`);
  console.log(`${name}: axe violations ${violations.length}`);

  // Keyboard: the first findings summary is reachable by Tab.
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.shadowRoot?.activeElement?.tagName ?? document.activeElement?.tagName);
  console.log(`${name}: first Tab focuses ${focused}`);

  // Live update: typing changes the score and fires an event.
  await page.fill("#src", "linear-gradient(90deg, #ffffff, #fefefe)");
  await page.waitForTimeout(200);
  const logText = await page.textContent("#log");
  if (!logText.includes("opal42-score")) problems.push(`${name}: no opal42-score event after typing (${logText})`);

  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  await ctx.close();
}

await browser.close();
stop();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`\nOK. Screenshots in ${out}`);
