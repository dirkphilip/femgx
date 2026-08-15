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

/** Opens the responsive phone navigation drawer and waits for its controls. */
export async function openNavigation(page: Page): Promise<void> {
  const trigger = page.getByTestId("navigation-toggle");
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("navigation-drawer")).toBeVisible();
}

/** Closes the responsive phone navigation drawer when it is open. */
export async function closeNavigation(page: Page): Promise<void> {
  const trigger = page.getByTestId("navigation-toggle");
  if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

/** Opens one command-bar disclosure and waits for its controls to be reachable. */
export async function openCommandPanel(
  page: Page,
  panel: "selection" | "view" | "display" | "analysis",
): Promise<void> {
  const trigger = page.getByTestId(`command-${panel}`);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

/** Uses the existing canvas context menu for commands that are not persistent controls. */
export async function activateContextAction(page: Page, action: string): Promise<void> {
  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounds for the context action");
  await page.mouse.click(Math.round(box.x + box.width - 12), Math.round(box.y + box.height - 12), {
    button: "right",
  });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await menu.getByTestId(`context-action-${action}`).click();
}

/** Finds a canvas point that the active GPU picker reports as empty. */
export async function emptyCanvasPoint(
  page: Page,
  canvas: Locator,
): Promise<{ readonly x: number; readonly y: number }> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounds for empty-space selection");
  for (const [fx, fy] of [
    [0.05, 0.95],
    [0.95, 0.05],
    [0.05, 0.05],
    [0.95, 0.95],
  ] as const) {
    const point = { x: Math.round(box.x + fx * box.width), y: Math.round(box.y + fy * box.height) };
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(120);
    if ((await canvas.getAttribute("data-hovered")) === "") return point;
  }
  throw new Error("could not find an empty canvas point");
}

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

/** Loads the demo and gates feature assertions on the supported WebGPU path. */
export async function loadWebGpuPage(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await waitForRendererOrSkip(page);
}

/** Selects the demo-private click and box-selection granularity. */
export async function setSelectionGranularity(
  page: Page,
  granularity: "element" | "face" | "node" | "edge",
): Promise<void> {
  await openCommandPanel(page, "selection");
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
