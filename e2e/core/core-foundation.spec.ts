import { expect, test } from "@playwright/test";
import { drawnPixels } from "../shared/helpers";

const HOST = "/e2e/core/core-host.html";

test("creates, presents a nonblank frame, and destroys one public viewport", async ({ page }) => {
  await page.goto(HOST);
  const canvas = page.locator("#core-canvas");
  const status = page.locator("#core-status");
  await expect(status).toHaveAttribute("data-result", "ready");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await expect.poll(() => drawnPixels(canvas)).toBe(true);
  await expect(canvas).toHaveAttribute("data-frames", /[1-9]/);

  await page.evaluate(() => {
    (window as typeof window & { femgxCore?: { destroy: () => void } }).femgxCore?.destroy();
  });
  await expect(status).toHaveAttribute("data-result", "destroyed");
});

test("reports typed unsupported behavior without a CPU renderer", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "gpu", {
      configurable: true,
      get: () => undefined,
    });
  });
  await page.goto(HOST);
  await expect(page.locator("#core-status")).toHaveAttribute("data-result", "unsupported");
  await expect(page.locator("#core-status")).toHaveText("WebGpuUnsupportedError:no-webgpu");
  await expect(page.locator("#core-canvas")).not.toHaveAttribute("data-ready", "true");
});
