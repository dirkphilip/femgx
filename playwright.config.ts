import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
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
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // WebGPU is the product's only renderer, so the default e2e lane
        // exercises the real WebGPU path. `--enable-unsafe-webgpu --enable-gpu`
        // selects Chromium's software SwiftShader implementation, so no GPU
        // hardware is required on CI or developer machines.
        launchOptions: { args: ["--enable-unsafe-webgpu", "--enable-gpu"] },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env["CI"],
  },
});
