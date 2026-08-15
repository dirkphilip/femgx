import { expect, test, type Locator, type Page } from "@playwright/test";
import { canvasInteractionBox } from "../shared/helpers";
export {
  cameraDistance,
  expectBoundsClippedSafely,
  projectCameraPoint,
  readNavigationState,
  requireHit,
  sweepForHit,
  targetPlanePoint,
} from "../shared/helpers";
export { distinctColors, drawnPixels, pixelHash, pixelMetrics } from "../shared/helpers";

/** Reads the stable workbench status summary. */
export async function status(page: Page): Promise<string> {
  return (await page.getByTestId("status").textContent()) ?? "";
}

/** Reads a stable data attribute from the model canvas. */
export async function dataset(page: Page, key: string): Promise<string> {
  return (await page.getByTestId("view-canvas").getAttribute(`data-${key}`)) ?? "";
}

/** Reads the renderer lifecycle state from one canvas. */
export async function rendererMode(
  page: Page,
  canvas = page.getByTestId("view-canvas"),
): Promise<string> {
  return (await canvas.getAttribute("data-renderer")) ?? "";
}

/** Waits for the supported WebGPU renderer before feature assertions. */
export async function waitForRenderer(
  page: Page,
  canvas = page.getByTestId("view-canvas"),
): Promise<void> {
  await expect.poll(() => rendererMode(page, canvas), { timeout: 10_000 }).toBe("webgpu");
}

/** Waits for WebGPU or skips with the canonical unsupported-environment reason. */
export async function waitForRendererOrSkip(
  page: Page,
  canvas = page.getByTestId("view-canvas"),
): Promise<void> {
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => rendererMode(page, canvas), { timeout: 10_000 })
    .toMatch(/^(webgpu|unsupported)$/);
  if ((await rendererMode(page, canvas)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }
}

/** Selects the demo-private click and box-selection granularity. */
export async function setSelectionGranularity(
  page: Page,
  granularity: "element" | "face" | "node" | "edge",
): Promise<void> {
  const select = page.getByTestId("selection-granularity");
  await select.selectOption(granularity);
  await expect(select).toHaveValue(granularity);
  await expect(page.getByTestId("view-canvas")).toHaveAttribute(
    "data-selection-granularity",
    granularity,
  );
}

/** Drags the primary button far enough to enter box-selection mode. */
export async function primaryBoxDrag(
  page: Page,
  canvas: Locator,
  start: { readonly fx: number; readonly fy: number },
  end: { readonly fx: number; readonly fy: number },
): Promise<void> {
  const box = await canvasInteractionBox(canvas);
  await page.mouse.move(
    Math.round(box.x + start.fx * box.width),
    Math.round(box.y + start.fy * box.height),
  );
  await page.mouse.down({ button: "left" });
  await page.mouse.move(
    Math.round(box.x + end.fx * box.width),
    Math.round(box.y + end.fy * box.height),
  );
}
