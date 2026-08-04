import { defineConfig, devices } from "@playwright/test";

const webgpuEnabled = process.env["RUN_WEBGPU"] === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Keep the default lane on the deterministic CPU fallback regardless of
        // whether the host exposes a WebGPU adapter; the opt-in
        // `chromium-webgpu` project enables WebGPU explicitly.
        launchOptions: { args: ["--disable-gpu"] },
      },
      testIgnore: /webgpu\.spec\.ts/,
    },
    ...(webgpuEnabled
      ? [
          {
            name: "chromium-webgpu",
            testMatch: /webgpu\.spec\.ts/,
            use: {
              ...devices["Desktop Chrome"],
              // Software WebGPU (SwiftShader) so no GPU hardware is required.
              // The demo still capability-gates: it falls back to the CPU
              // renderer when the browser cannot present and pick.
              launchOptions: {
                args: ["--enable-unsafe-webgpu", "--enable-gpu"],
              },
            },
          },
        ]
      : []),
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env["CI"],
  },
});
