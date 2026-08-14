import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:5173";
const softwareWebGpuArgs = [
  "--disable-dev-shm-usage",
  "--disable-gpu-sandbox",
  "--enable-features=Vulkan",
  "--enable-accelerated-2d-canvas",
  "--enable-gpu",
  "--enable-unsafe-webgpu",
  "--use-gpu-in-tests",
  "--use-angle=swiftshader",
  "--use-gl=angle",
  "--use-webgpu-adapter=swiftshader",
  "--use-vulkan=swiftshader",
];

/**
 * E2E browser projects:
 * - `chrome` — system Google Chrome (hardware WebGPU). Default local lane.
 * - `chrome-software` — a bounded manual smoke lane using SwiftShader WebGPU.
 * - `chrome-unsupported` — system Google Chrome, used by CI for the no-GPU
 *   unsupported contract only. Full WebGPU pick/pixel coverage is local (or a
 *   future GPU runner), not SwiftShader.
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
    baseURL,
    trace: "on-first-retry",
    // Failure artifacts (in `playwright-report`/CI) include a screenshot even
    // on the first failure, so smoke-contract failures are diagnosable.
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome",
      // Multiple WebGPU contexts compete for the same physical device and can
      // produce blank captures or stalled readbacks under load.
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        // Branded Chrome's current headless mode uses the regular browser. Let
        // it select the system GPU and remove Playwright's software fallback.
        headless: true,
        launchOptions: {
          args: ["--enable-gpu"],
          ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
        },
      },
    },
    {
      name: "chrome-software",
      testMatch: /software-webgpu\.spec\.ts/,
      retries: 0,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        headless: true,
        // This opt-in smoke lane probes hosted CI's SwiftShader path. It is
        // exploratory evidence, never the authoritative hardware lane.
        launchOptions: { args: softwareWebGpuArgs },
      },
    },
    {
      name: "chrome-software-interaction",
      testMatch: /(mobile|webgpu-glb|smoke)\.spec\.ts/,
      retries: 0,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        headless: true,
        launchOptions: { args: softwareWebGpuArgs },
      },
    },
    {
      name: "chrome-software-rendering",
      testMatch: /(demo-results|demo-visibility|webgpu-rendering|webgpu-visibility)\.spec\.ts/,
      retries: 0,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        headless: true,
        launchOptions: { args: softwareWebGpuArgs },
      },
    },
    {
      name: "chrome-unsupported",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        headless: true,
        // This project only runs the explicit unsupported-contract smoke. Keep
        // browser launch independent of Playwright's bundled Chromium and
        // software-WebGPU fallback.
        launchOptions: {
          ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${new URL(baseURL).port || "5173"}`,
    url: baseURL,
    reuseExistingServer: !process.env["CI"],
  },
});
