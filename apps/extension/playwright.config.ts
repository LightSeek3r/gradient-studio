import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Browser tests for the built extension. They need the Chrome build
// (`npm run build:chrome`, done by `npm run test:e2e`) and a Chromium that can
// load unpacked extensions: Chrome for Testing or Playwright's own Chromium
// (`npx playwright install chromium`). Branded Chrome 137+ ignores --load-extension.
// Set OPAL42_CHROME to a binary to override the lookup.
export function chromePath(): string | undefined {
  if (process.env.OPAL42_CHROME) return process.env.OPAL42_CHROME;
  return existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
}

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    launchOptions: { executablePath: chromePath(), args: ["--no-sandbox"] },
  },
});
