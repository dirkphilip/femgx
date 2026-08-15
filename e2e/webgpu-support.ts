import { expect, type Locator, type Page } from "@playwright/test";
import { waitForRendererOrSkip } from "./demo-support";
export {
  cameraDistance,
  expectBoundsClippedSafely,
  expectDisplayedPointClippedSafely,
  projectCameraPoint,
  readNavigationState,
  requireHit,
  sweepForHit,
  targetPlanePoint,
} from "./helpers";
export { rendererMode, setSelectionGranularity, waitForRendererOrSkip } from "./demo-support";

/**
 * Required WebGPU browser coverage (category 1 in
 * `wiki/engineering/e2e-policy.md`). WebGPU is the product's only renderer, so
 * the default e2e lane exercises headless system Chrome with its hardware GPU.
 * On an environment that genuinely cannot initialize WebGPU the demo reports
 * an explicit unsupported state and these tests skip with a reason instead of
 * failing.
 */
/** Loads the demo and skips when the environment cannot run WebGPU. */
export async function loadWebGpuPage(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await waitForRendererOrSkip(page);
}

/**
 * Captures the canvas pixels once the presented frame settles. WebGPU
 * presentation is asynchronous and the demo renders on demand, so three
 * consecutive byte-identical captures prove the swapchain has presented a
 * stable frame (and that the renderer is deterministic for a static scene).
 */
export async function stableCanvasPixels(page: Page, canvas: Locator): Promise<Buffer> {
  let previous: Buffer | undefined;
  let streak = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const shot = await canvas.screenshot({
      mask: [page.locator(".toolbar, #inspection-panel, #status")],
    });
    if (previous !== undefined && shot.equals(previous)) streak += 1;
    else streak = 0;
    previous = shot;
    if (streak >= 2) return shot;
    await page.waitForTimeout(100);
  }
  throw new Error("canvas pixels never stabilized across captures");
}

/** Reads presented raw RGBA bytes from the canvas screenshot. */
export async function canvasRgba(page: Page, canvas: Locator): Promise<Buffer> {
  const encoded = (await canvas.screenshot()).toString("base64");
  const payload = await page.evaluate(async (screenshot) => {
    const encodedBytes = Uint8Array.from(atob(screenshot), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([encodedBytes], { type: "image/png" }));
    const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = offscreen.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("2d context unavailable");
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const rgbaBytes = new Uint8Array(image.data.buffer);
    let binary = "";
    for (let offset = 0; offset < rgbaBytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...rgbaBytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }, encoded);
  return Buffer.from(payload, "base64");
}

/** Counts pixels whose RGB channels differ by more than `threshold`. */
export function differingPixelCount(a: Buffer, b: Buffer, threshold = 8): number {
  const length = Math.min(a.length, b.length);
  let count = 0;
  for (let index = 0; index + 2 < length; index += 4) {
    const ar = a[index] ?? 0;
    const ag = a[index + 1] ?? 0;
    const ab = a[index + 2] ?? 0;
    const br = b[index] ?? 0;
    const bg = b[index + 1] ?? 0;
    const bb = b[index + 2] ?? 0;
    if (
      Math.abs(ar - br) > threshold ||
      Math.abs(ag - bg) > threshold ||
      Math.abs(ab - bb) > threshold
    ) {
      count += 1;
    }
  }
  return count;
}

/** Counts pixels with enough luminance to reject an all-black presented frame. */
export function visiblePixelCount(rgba: Buffer, threshold = 32): number {
  let count = 0;
  for (let index = 0; index + 2 < rgba.length; index += 4) {
    if (
      (rgba[index] ?? 0) > threshold ||
      (rgba[index + 1] ?? 0) > threshold ||
      (rgba[index + 2] ?? 0) > threshold
    ) {
      count += 1;
    }
  }
  return count;
}

/** Returns tolerant luminance statistics for a small presented-pixel patch. */
export function luminancePatch(
  rgba: Buffer,
  width: number,
  centerX: number,
  centerY: number,
  radius = 3,
): { readonly count: number; readonly mean: number; readonly spread: number } {
  const height = Math.floor(rgba.length / 4 / width);
  const luminances: number[] = [];
  for (
    let y = Math.max(0, Math.floor(centerY) - radius);
    y <= Math.min(height - 1, Math.floor(centerY) + radius);
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.floor(centerX) - radius);
      x <= Math.min(width - 1, Math.floor(centerX) + radius);
      x += 1
    ) {
      const offset = (y * width + x) * 4;
      luminances.push(
        (rgba[offset] ?? 0) * 0.2126 +
          (rgba[offset + 1] ?? 0) * 0.7152 +
          (rgba[offset + 2] ?? 0) * 0.0722,
      );
    }
  }
  const mean = luminances.reduce((sum, value) => sum + value, 0) / Math.max(1, luminances.length);
  return {
    count: luminances.length,
    mean,
    spread: Math.max(...luminances, 0) - Math.min(...luminances, 0),
  };
}

interface PixelBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Tests whether one RGBA pixel belongs to a yellow point sprite. */
export function yellowPixel(rgba: Buffer, offset: number): boolean {
  const red = rgba[offset] ?? 0;
  const green = rgba[offset + 1] ?? 0;
  const blue = rgba[offset + 2] ?? 0;
  return red > 180 && green > 120 && blue < 140 && red - blue > 70;
}

/** Finds connected yellow components in a rendered RGBA image. */
export function yellowComponents(rgba: Buffer, width: number): PixelBounds[] {
  const height = Math.floor(rgba.length / 4 / width);
  const visited = new Uint8Array(width * height);
  const components: PixelBounds[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const seed = y * width + x;
      if (visited[seed] === 1 || !yellowPixel(rgba, seed * 4)) continue;
      components.push(collectYellowComponent(rgba, width, height, seed, visited));
    }
  }
  return components;
}

function collectYellowComponent(
  rgba: Buffer,
  width: number,
  height: number,
  seed: number,
  visited: Uint8Array,
): PixelBounds {
  visited[seed] = 1;
  const queue = [seed];
  let minX = seed % width;
  let minY = Math.floor(seed / width);
  let maxX = minX;
  let maxY = minY;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixel = queue[cursor] ?? seed;
    const pixelCoordinateX = pixel % width;
    const pixelY = Math.floor(pixel / width);
    minX = Math.min(minX, pixelCoordinateX);
    minY = Math.min(minY, pixelY);
    maxX = Math.max(maxX, pixelCoordinateX);
    maxY = Math.max(maxY, pixelY);
    for (const [nextX, nextY] of [
      [pixelCoordinateX - 1, pixelY],
      [pixelCoordinateX + 1, pixelY],
      [pixelCoordinateX, pixelY - 1],
      [pixelCoordinateX, pixelY + 1],
    ] as const) {
      const inBounds = nextX >= 0 && nextY >= 0 && nextX < width && nextY < height;
      const next = nextY * width + nextX;
      if (inBounds && visited[next] !== 1 && yellowPixel(rgba, next * 4)) {
        visited[next] = 1;
        queue.push(next);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Tests a canvas coordinate for a yellow sprite pixel. */
export function hasYellowPixel(rgba: Buffer, width: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width) return false;
  const offset = (y * width + x) * 4;
  return offset + 2 < rgba.length && yellowPixel(rgba, offset);
}

/** Measures the central luminance spread across pixels changed by selection. */
export function selectedLuminanceSpread(baseline: Buffer, selected: Buffer): number {
  const luminances: number[] = [];
  const length = Math.min(baseline.length, selected.length);
  for (let index = 0; index + 2 < length; index += 4) {
    const red = selected[index] ?? 0;
    const green = selected[index + 1] ?? 0;
    const blue = selected[index + 2] ?? 0;
    const change =
      Math.abs(red - (baseline[index] ?? 0)) +
      Math.abs(green - (baseline[index + 1] ?? 0)) +
      Math.abs(blue - (baseline[index + 2] ?? 0));
    if (change < 30 || red + green + blue < 180) continue;
    luminances.push(red * 0.2126 + green * 0.7152 + blue * 0.0722);
  }
  expect(
    luminances.length,
    "selected volume should cover representative surface pixels",
  ).toBeGreaterThan(200);
  luminances.sort((a, b) => a - b);
  const low = luminances[Math.floor(luminances.length * 0.1)] ?? 0;
  const high = luminances[Math.floor(luminances.length * 0.9)] ?? 0;
  return high - low;
}

/** Node-on vs node-off pixel contribution for the current camera. */
export async function nodeContribution(page: Page): Promise<number> {
  const canvas = page.getByTestId("view-canvas");
  const toggle = page.getByTestId("node-overlay");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await page.getByTestId("node-overlay").click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
  await page.waitForTimeout(50);
  const withNodes = await canvasRgba(page, canvas);
  await page.getByTestId("node-overlay").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(50);
  const withoutNodes = await canvasRgba(page, canvas);
  await page.getByTestId("node-overlay").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  return differingPixelCount(withNodes, withoutNodes);
}

/**
 * Moves the pointer to an empty canvas corner so GPU pick clears the hovered
 * state. The hover sweep used to find a pick target leaves a hovered instance,
 * whose emphasis would otherwise bleed into the pixel comparison.
 */
export async function clearHover(page: Page, canvas: Locator): Promise<void> {
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }
  const corners: ReadonlyArray<readonly [number, number]> = [
    [0.05, 0.05],
    [0.95, 0.05],
    [0.05, 0.95],
    [0.95, 0.95],
  ];
  for (const [fx, fy] of corners) {
    await page.mouse.move(box.x + fx * box.width, box.y + fy * box.height);
    await page.waitForTimeout(120);
    const hovered = await canvas.getAttribute("data-hovered");
    if (hovered === null || hovered === "") {
      return;
    }
  }
  throw new Error("could not move the pointer to an empty canvas point to clear hover");
}

/** Performs one SpaceClaim middle-button camera gesture on the actual canvas. */
export async function dragCamera(
  page: Page,
  canvas: Locator,
  delta: { readonly x: number; readonly y: number },
  modifier?: "Shift" | "Control",
): Promise<void> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  if (modifier !== undefined) await page.keyboard.down(modifier);
  const framesBefore = modifier === undefined ? await canvas.getAttribute("data-frames") : null;
  await page.mouse.down({ button: "middle" });
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("true");
  if (modifier === undefined) {
    await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(framesBefore);
  }
  await page.mouse.move(x + delta.x, y + delta.y);
  await page.mouse.up({ button: "middle" });
  if (modifier !== undefined) await page.keyboard.up(modifier);
}

/**
 * Shift-right-clicks a target to promote a node/face pick to its owning
 * element and toggles the context-menu highlight, the explicit element emphasis
 * state the renderer draws as an emissive glow.
 */
export async function toggleElementHighlight(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(120);
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.keyboard.up("Shift");
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".menu-title").first()).toHaveText(/^Element \d+$/);
  await menu.locator('button[data-action="highlight"]').click();
}
