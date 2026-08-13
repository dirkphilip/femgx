import { expect, type Locator, type Page } from "@playwright/test";
export {
  cameraDistance,
  expectBoundsClippedSafely,
  projectCameraPoint,
  readNavigationState,
  requireHit,
  sweepForHit,
  targetPlanePoint,
} from "./helpers";
export { distinctColors, drawnPixels, pixelHash, pixelMetrics } from "./helpers";

/** Reads the stable workbench status summary. */
export async function status(page: Page): Promise<string> {
  return (await page.getByTestId("status").textContent()) ?? "";
}

/** Reads a stable data attribute from the model canvas. */
export async function dataset(page: Page, key: string): Promise<string> {
  return (await page.getByTestId("view-canvas").getAttribute(`data-${key}`)) ?? "";
}

/** Waits for the supported WebGPU renderer before feature assertions. */
export async function waitForRenderer(page: Page): Promise<void> {
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-renderer", "webgpu", {
    timeout: 10_000,
  });
}

/** Enables or disables the demo-private owning-element click policy. */
export async function setElementSelection(page: Page, enabled: boolean): Promise<void> {
  const toggle = page.getByTestId("element-select");
  if ((await toggle.getAttribute("aria-pressed")) !== String(enabled)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", String(enabled));
}

/** Drags the primary button far enough to enter box-selection mode. */
export async function primaryBoxDrag(
  page: Page,
  canvas: Locator,
  start: { readonly fx: number; readonly fy: number },
  end: { readonly fx: number; readonly fy: number },
): Promise<void> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
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
