/** visibility ownership: GPU visibility and body-interface contracts. */

import { expect, test } from "@playwright/test";
import { stableCanvasPixels, differingPixelCount, loadWebGpuPage } from "./webgpu-support";

test("exposes independent body visibility and highlight controls", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("assembly-expand-5").click();
  const canvas = page.getByTestId("view-canvas");
  const body = page.getByTestId("body-vis-6-2");
  const glow = page.getByTestId("body-highlight-6-2");
  await expect(body).toBeChecked();
  await expect(glow).toHaveAttribute("data-active", "false");

  const baseline = await stableCanvasPixels(page, canvas);
  await body.uncheck();
  await expect(body).not.toBeChecked();
  const hidden = await stableCanvasPixels(page, canvas);
  expect(hidden.equals(baseline), "hiding one body must change the WebGPU frame").toBe(false);

  await body.check();
  await glow.click();
  await expect(glow).toHaveAttribute("data-active", "true");
  await expect(body).toBeChecked();
  const styled = await stableCanvasPixels(page, canvas);
  expect(styled.equals(baseline), "body highlight must change the WebGPU frame").toBe(false);
});

test("exposes and restores body interfaces in visible picking", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("assembly-expand-5").click();
  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const rect = {
    left: 0,
    top: 0,
    right: box.width,
    bottom: box.height,
    width: box.width,
    height: box.height,
  };
  const region = async (granularity: string): Promise<readonly Record<string, unknown>[]> =>
    page.evaluate(
      async ({ rect: value, granularity: level }) => {
        const demo = (
          window as typeof window & {
            femgxDemo?: {
              pickRegion?: (
                selection: typeof value,
                requested: string,
              ) => Promise<readonly Record<string, unknown>[]>;
            };
          }
        ).femgxDemo;
        return (await demo?.pickRegion?.(value, level)) ?? [];
      },
      { rect, granularity },
    );
  const baselineFaces = await region("face");
  const baselineFrame = await stableCanvasPixels(page, canvas);
  const body = page.getByTestId("body-vis-6-2");
  await body.uncheck();
  await expect(body).not.toBeChecked();
  const exposedFrame = await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(baselineFrame, exposedFrame),
    "hiding a body should change the rendered visible surface",
  ).toBeGreaterThan(200);
  const exposedFaces = await region("face");
  expect(exposedFaces.length, "hiding a body should preserve visible face coverage").toBe(
    baselineFaces.length,
  );
  expect(exposedFaces.every((target) => target["kind"] === "face")).toBe(true);

  await body.check();
  await expect(body).toBeChecked();
  const restoredFrame = await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(exposedFrame, restoredFrame),
    "restoring the body should bring the hidden surface back",
  ).toBeGreaterThan(200);
  await expect
    .poll(async () => JSON.stringify(await region("face")))
    .toBe(JSON.stringify(baselineFaces));
});
