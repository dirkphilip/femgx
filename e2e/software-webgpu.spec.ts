/** Bounded exploratory coverage for hosted software-WebGPU environments. */

import { expect, test } from "@playwright/test";
import { canvasInteractionBox, drawnPixels, sweepForHit } from "./helpers";

test.describe.configure({ mode: "serial" });

test("starts a software WebGPU device and presents the model", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 15_000 });
  await expect.poll(() => drawnPixels(canvas), { timeout: 15_000 }).toBe(true);

  const adapter = await page.evaluate(async () => {
    const resolved = await navigator.gpu.requestAdapter();
    if (resolved === null) return null;
    const { architecture, description, device, isFallbackAdapter, vendor } = resolved.info;
    return { architecture, description, device, isFallbackAdapter, vendor };
  });
  console.log(`SOFTWARE_WEBGPU_ADAPTER ${JSON.stringify(adapter)}`);
  expect(adapter, "SwiftShader must still expose a usable WebGPU adapter").not.toBeNull();
  expect(pageErrors, "software-WebGPU startup must not raise page errors").toEqual([]);
});

test("resolves one pick through the software-WebGPU interaction path", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 15_000 });
  const box = await canvasInteractionBox(canvas);
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);

  const hit = await sweepForHit(page, canvas, {
    attribute: "pick",
    cols: 5,
    fresh: true,
    rows: 4,
    settleMs: 150,
  });
  expect(hit, "software-WebGPU must resolve one exposed canvas pick").toBeDefined();
  if (hit === undefined) return;

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => canvas.getAttribute("data-selected"), { timeout: 5_000 }).not.toBe("");
});
