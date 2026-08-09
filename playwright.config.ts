import { defineConfig, devices } from "@playwright/test";

/**
 * E2E browser projects:
 * - `chrome` — system Google Chrome (hardware WebGPU). Default local lane.
 * - `chromium` — Playwright Chromium, used by CI for the no-GPU unsupported
 *   contract only. Full WebGPU pick/pixel coverage is local (or a future GPU
 *   runner), not SwiftShader.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  // `list` marks skipped tests with `-`; the custom reporter groups the skip
  // reasons at the end so capability-gated skips stay visible and reviewable
  // (see `wiki/engineering/e2e-policy.md`).
  reporter: [["list"], ["./e2e/skip-summary-reporter.ts"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    // Failure artifacts (in `playwright-report`/CI) include a screenshot even
    // on the first failure, so smoke-contract failures are diagnosable.
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome",
      // Multiple headed WebGPU contexts compete for the same physical device
      // and can produce blank captures or stalled readbacks under load.
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        // Headless Chrome injects `--enable-unsafe-swiftshader`, which is not a
        // faithful WebGPU stand-in. Headed system Chrome uses the real GPU.
        headless: false,
      },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env["CI"],
  },
});
