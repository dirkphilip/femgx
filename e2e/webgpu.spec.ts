import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  cameraDistance,
  expectBoundsClippedSafely,
  projectCameraPoint,
  readNavigationState,
  requireHit,
  sweepForHit,
  targetPlanePoint,
} from "./helpers";

/**
 * Required WebGPU browser coverage (category 1 in
 * `wiki/engineering/e2e-policy.md`). WebGPU is the product's only renderer, so
 * the default e2e lane exercises the real WebGPU path. It launches Chromium
 * with software WebGPU flags (`--enable-unsafe-webgpu --enable-gpu`) so it
 * needs no GPU hardware. On an environment that genuinely cannot initialize
 * WebGPU the demo reports an explicit unsupported state and these tests skip
 * with a reason instead of failing.
 */
async function rendererMode(page: Page): Promise<string> {
  return (await page.getByTestId("view-canvas").getAttribute("data-renderer")) ?? "";
}

/** Loads the demo and skips when the environment cannot run WebGPU. */
async function loadWebGpuPage(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect
    .poll(() => rendererMode(page), { timeout: 10_000 })
    .toMatch(/^(webgpu|unsupported)$/);
  if ((await rendererMode(page)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }
}

/**
 * Captures the canvas pixels once the presented frame settles. WebGPU
 * presentation is asynchronous and the demo renders on demand, so three
 * consecutive byte-identical captures prove the swapchain has presented a
 * stable frame (and that the renderer is deterministic for a static scene).
 */
async function stableCanvasPixels(page: Page, canvas: Locator): Promise<Buffer> {
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
async function canvasRgba(page: Page, canvas: Locator): Promise<Buffer> {
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
function differingPixelCount(a: Buffer, b: Buffer, threshold = 8): number {
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
function visiblePixelCount(rgba: Buffer, threshold = 32): number {
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

/** Measures the central luminance spread across pixels changed by selection. */
function selectedLuminanceSpread(baseline: Buffer, selected: Buffer): number {
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
async function nodeContribution(page: Page): Promise<number> {
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
async function clearHover(page: Page, canvas: Locator): Promise<void> {
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
async function dragCamera(
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
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x + delta.x, y + delta.y);
  await page.mouse.up({ button: "middle" });
  if (modifier !== undefined) await page.keyboard.up(modifier);
}

/**
 * Shift-right-clicks a target to promote a node/face pick to its owning
 * element and toggles the context-menu highlight, the explicit element emphasis
 * state the renderer draws as an emissive glow.
 */
async function toggleElementHighlight(
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

test("initializes the WebGPU renderer and renders an instanced frame", async ({ page }) => {
  await loadWebGpuPage(page);
  await expect
    .poll(() => page.getByTestId("view-canvas").getAttribute("data-frames"), { timeout: 10_000 })
    .not.toBeNull();
  const frames = Number(await page.getByTestId("view-canvas").getAttribute("data-frames"));
  expect(frames, "the demo should render its first frame through WebGPU").toBeGreaterThanOrEqual(1);
});

test("drives interaction and picking through the demo path", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }

  // The fitted fixture intersects the canvas center. Clear the diagnostic first
  // so the resolved hover proves this exact point is live, rather than reusing
  // a stale key from a previous asynchronous move.
  const hoverPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await canvas.evaluate((node) => {
    (node as HTMLElement).dataset["hovered"] = "";
  });
  await page.mouse.move(hoverPoint.x - 1, hoverPoint.y);
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-hovered")).not.toBe("");

  // Click the hovered target to toggle its selection through the pick path.
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).not.toBe("");
  const selected = await canvas.getAttribute("data-selected");
  expect(selected, "clicking a target should select it").not.toBe("");

  // Clicking again deselects.
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe("");
});

test("discovers visible region targets without mutating selection", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const targets = await page.evaluate(
    async (rect) => {
      const demo = (
        window as typeof window & {
          femgxDemo?: {
            pickRegion?: (value: unknown, granularity: string) => Promise<readonly unknown[]>;
          };
        }
      ).femgxDemo;
      return demo?.pickRegion?.(rect, "part") ?? [];
    },
    { left: 0, top: 0, right: box.width, bottom: box.height, width: box.width, height: box.height },
  );
  expect(targets.length, "the full visible canvas should discover a part").toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute("data-selected", "");
});

test("keeps selection feedback visible in edge overlay mode", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }

  // Sweep until GPU pick resolves any target; the selected key encodes its
  // granularity as a prefix (n:/f:/e:/i:/p:).
  const hoverPoint = await sweepForHit(page, canvas, {
    attribute: "hovered",
    settleMs: 150,
    fresh: true,
  });

  if (hoverPoint === undefined) {
    test.skip(true, "picking is not functional in this browser environment");
    return;
  }

  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).not.toBe("");
  const selected = (await canvas.getAttribute("data-selected")) ?? "";

  // Edge overlay keeps the emphasis: the label flips and the demo still renders
  // the selected key in the next frame.
  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBeNull();
  expect(await canvas.getAttribute("data-selected")).toBe(selected);

  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  expect(await canvas.getAttribute("data-selected")).toBe(selected);
});

test("element emphasis changes the rendered pixels and toggles off again", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  await expect.poll(() => canvas.getAttribute("data-frames"), { timeout: 10_000 }).not.toBeNull();

  // Baseline: no interaction, so the canvas holds only the deterministic model.
  const baseline = await stableCanvasPixels(page, canvas);

  const hoverPoint = await sweepForHit(page, canvas, {
    attribute: "hovered",
    settleMs: 150,
    fresh: true,
  });
  if (hoverPoint === undefined) {
    test.skip(true, "picking is not functional in this browser environment");
    return;
  }

  // Emphasize the element under the pointer, then clear the hover so the
  // pixel comparison isolates the emphasis. If element emphasis ever renders
  // invisibly again (a WGSL/CPU record-layout desync like #69), the settled
  // pixels never differ from the baseline and this assertion fails.
  await toggleElementHighlight(page, hoverPoint);
  await clearHover(page, canvas);
  const emphasized = await stableCanvasPixels(page, canvas);
  expect(
    emphasized.equals(baseline),
    "element emphasis must render as visibly different pixels",
  ).toBe(false);

  // Toggling the emphasis off must visibly remove the emphasized frame.
  await toggleElementHighlight(page, hoverPoint);
  await clearHover(page, canvas);
  const restored = await stableCanvasPixels(page, canvas);
  expect(
    restored.equals(emphasized),
    "clearing the emphasis must change the emphasized frame",
  ).toBe(false);
});

test("renders element nodes as a separate visible annotation pass", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("gallery");

  const canvas = page.getByTestId("view-canvas");
  const withNodes = await stableCanvasPixels(page, canvas);
  const nodeToggle = page.getByTestId("node-overlay");
  await nodeToggle.click();
  await expect(nodeToggle).toHaveAttribute("aria-pressed", "false");
  const withoutNodes = await stableCanvasPixels(page, canvas);
  expect(withoutNodes.equals(withNodes), "node glyphs must change the rendered pixels").toBe(false);
  const withNodesRgba = await canvasRgba(page, canvas);
  expect(
    visiblePixelCount(withNodesRgba),
    "the node pass must preserve the resolved surface instead of presenting black",
  ).toBeGreaterThan(withNodesRgba.length / 16);

  await nodeToggle.click();
  await expect(nodeToggle).toHaveAttribute("aria-pressed", "true");
  const restored = await stableCanvasPixels(page, canvas);
  expect(restored.equals(withoutNodes), "showing node glyphs must change the plain frame").toBe(
    false,
  );
});

test("composes the transparency fixture and picks its nearest translucent face", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("transparency");

  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-model", "transparency");
  const frame = await stableCanvasPixels(page, canvas);
  const rgba = await canvasRgba(page, canvas);
  expect(
    visiblePixelCount(rgba),
    "the transparency composite must preserve visible geometry",
  ).toBeGreaterThan(rgba.length / 16);
  expect(frame.equals(await stableCanvasPixels(page, canvas))).toBe(true);

  const hit = await sweepForHit(page, canvas, { prefix: "f:", attribute: "hovered", fresh: true });
  expect(hit, "the nearest translucent shell face must remain pickable").not.toBeUndefined();
  expect(hit?.key).toMatch(/^f:31\/1:/);
  await page.mouse.click(hit?.x ?? 0, hit?.y ?? 0);
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe(hit?.key);
});

test("removes zero-alpha shell overlays without removing their picks", async ({ page }) => {
  await loadWebGpuPage(page, "/?testAlphaZero");
  await page.getByTestId("model-select").selectOption("transparency");

  const canvas = page.getByTestId("view-canvas");
  const instanceVisibility = page.locator("input[data-instance-id]");
  await expect(instanceVisibility).toHaveCount(4);

  // The transparency fixture orders its opaque interior first, followed by
  // the shell and the two overlapping zero-alpha placements. Hiding the
  // latter gives a pixel baseline for the interior's own overlays.
  for (const index of [1, 2, 3]) await instanceVisibility.nth(index).uncheck();
  const interiorOnly = await stableCanvasPixels(page, canvas);

  for (const index of [1, 2, 3]) await instanceVisibility.nth(index).check();
  const alphaZeroFrame = await stableCanvasPixels(page, canvas);
  expect(
    alphaZeroFrame.equals(interiorOnly),
    "zero-alpha shell and overlap parts must add no edge or node pixels",
  ).toBe(true);

  const hit = await sweepForHit(page, canvas, { prefix: "f:", attribute: "hovered", fresh: true });
  expect(hit, "zero-alpha shell geometry must remain pickable").not.toBeUndefined();
  expect(hit?.key).toMatch(/^f:31\/1:/);
});

test("keeps element edges and nodes visible after orbiting", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  for (const delta of [
    { x: 90, y: 35 },
    { x: -150, y: 55 },
  ]) {
    await dragCamera(page, canvas, delta);
    const withNodes = await stableCanvasPixels(page, canvas);
    await page.getByTestId("node-overlay").click();
    const withoutNodes = await stableCanvasPixels(page, canvas);
    expect(withoutNodes.equals(withNodes), "nodes must remain visible after orbiting").toBe(false);
    await page.getByTestId("node-overlay").click();
  }
});

test("keeps depth-tested node annotations stable across fine zoom steps", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption({ label: "Supported element gallery" });
  // Hide the gallery's hardware point/line overlays so the measured delta is
  // only the depth-tested node annotation pass.
  await page.getByTestId("instance-vis-0").uncheck();
  await page.getByTestId("instance-vis-1").uncheck();
  await page.getByTestId("fit-view").click();

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  const contributions: number[] = [];
  for (let step = 0; step < 8; step++) {
    contributions.push(await nodeContribution(page));
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(50);
  }

  const baseline = contributions[0];
  expect(contributions.length).toBeGreaterThan(0);
  expect(baseline).toBeGreaterThan(40);
  if (baseline === undefined) return;

  for (const [index, count] of contributions.entries()) {
    expect(count, `node contribution must stay visible at zoom step ${index}`).toBeGreaterThan(40);
    expect(
      count,
      `node contribution must not collapse across zoom (step ${index}: ${String(count)} vs ${String(baseline)})`,
    ).toBeGreaterThan(baseline * 0.05);
    expect(
      count,
      `node contribution must not explode from flicker/leakage (step ${index}: ${String(count)} vs ${String(baseline)})`,
    ).toBeLessThan(baseline * 12);
  }
});

test("keeps every supported gallery occurrence inside clip planes while orbiting", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption({ label: "Supported element gallery" });
  await page.getByTestId("fit-view").click();

  const canvas = page.getByTestId("view-canvas");
  await expect(page.getByTestId("status")).toContainText("10 visible");
  const initialNavigation = await readNavigationState(canvas);
  expectBoundsClippedSafely(initialNavigation.camera, initialNavigation.bounds);

  for (const delta of [
    { x: 160, y: 60 },
    { x: -280, y: 90 },
    { x: 200, y: -140 },
  ]) {
    await dragCamera(page, canvas, delta);
    const navigation = await readNavigationState(canvas);
    expectBoundsClippedSafely(navigation.camera, navigation.bounds);
    await expect(page.getByTestId("status")).toContainText("10 visible");
    expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(200);
  }
});

test("uses SpaceClaim middle-button spin, pan, and zoom gestures", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  const cameraKey = async (): Promise<string | null> => canvas.getAttribute("data-camera");

  const beforeSpin = await cameraKey();
  await dragCamera(page, canvas, { x: 90, y: 35 });
  await expect.poll(cameraKey).not.toBe(beforeSpin);

  await page.getByTestId("reset").click();
  const beforePan = await cameraKey();
  await dragCamera(page, canvas, { x: 90, y: 35 }, "Shift");
  await expect.poll(cameraKey).not.toBe(beforePan);

  await page.getByTestId("reset").click();
  const beforeZoom = await cameraKey();
  await dragCamera(page, canvas, { x: 0, y: -90 }, "Control");
  await expect.poll(cameraKey).not.toBe(beforeZoom);
});

test("shows a camera-oriented rotation-origin widget only during orbit", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { attribute: "hovered", prefix: "f:", fresh: true },
    "GPU picking must resolve an orbit pivot for the widget test",
  );
  const x = hit.x;
  const y = hit.y;

  const before = await stableCanvasPixels(page, canvas);
  const framesBefore = await canvas.getAttribute("data-frames");
  await page.mouse.down({ button: "middle" });
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("true");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(framesBefore);
  const during = await stableCanvasPixels(page, canvas);
  expect(during.equals(before), "the active orbit widget must affect the rendered frame").toBe(
    false,
  );

  await page.mouse.move(x + 90, y + 35);
  await page.waitForTimeout(100);

  await page.mouse.up({ button: "middle" });
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("false");
});

test("keeps depth ordering and picking after deep zoom in and out", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.getByTestId("fit-view").click();
  await page.mouse.move(x, y);
  const fitted = await readNavigationState(canvas);
  expectBoundsClippedSafely(fitted.camera, fitted.bounds);

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, 200);
  }
  await stableCanvasPixels(page, canvas);
  const zoomedOut = await readNavigationState(canvas);
  expect(cameraDistance(zoomedOut.camera)).toBeGreaterThan(cameraDistance(fitted.camera));
  expectBoundsClippedSafely(zoomedOut.camera, zoomedOut.bounds);

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -200);
  }
  await stableCanvasPixels(page, canvas);
  const restored = await readNavigationState(canvas);
  expect(restored.camera.position[0]).toBeCloseTo(fitted.camera.position[0], 3);
  expect(restored.camera.position[1]).toBeCloseTo(fitted.camera.position[1], 3);
  expect(restored.camera.position[2]).toBeCloseTo(fitted.camera.position[2], 3);
  expect(restored.camera.near).toBeCloseTo(fitted.camera.near, 3);
  expect(restored.camera.far).toBeCloseTo(fitted.camera.far, 3);

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -800);
  }
  const zoomedIn = await stableCanvasPixels(page, canvas);
  const closest = await readNavigationState(canvas);
  expectBoundsClippedSafely(closest.camera, closest.bounds);
  expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(200);
  expect(cameraDistance(closest.camera)).toBeLessThan(cameraDistance(fitted.camera));
  expect(zoomedIn.length).toBeGreaterThan(0);

  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must still resolve after the bounds-safe close zoom",
  );
  expect(hit.key).toMatch(/^(n|f|e|i|p):/);

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, 800);
  }
  const zoomedOutAgain = await readNavigationState(canvas);
  expectBoundsClippedSafely(zoomedOutAgain.camera, zoomedOutAgain.bounds);
  expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(20);
});

test("keeps empty-canvas wheel zoom anchored at the cursor", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("fit-view").click();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");

  const candidates = [
    [0.05, 0.05],
    [0.95, 0.05],
    [0.05, 0.95],
    [0.95, 0.95],
  ] as const;
  let empty: readonly [number, number] | undefined;
  for (const [fx, fy] of candidates) {
    const point = [box.x + box.width * fx, box.y + box.height * fy] as const;
    await page.mouse.move(point[0], point[1]);
    await page.waitForTimeout(120);
    if ((await canvas.getAttribute("data-hovered")) === "") {
      empty = point;
      break;
    }
  }
  if (empty === undefined) throw new Error("could not find an empty canvas corner");

  const local = [empty[0] - box.x, empty[1] - box.y] as const;
  const before = await readNavigationState(canvas);
  const anchor = targetPlanePoint(before.camera, local[0], local[1]);
  for (let step = 0; step < 2; step += 1) await page.mouse.wheel(0, -180);
  await stableCanvasPixels(page, canvas);
  await page.waitForTimeout(500);

  const zoomed = await readNavigationState(canvas);
  const projected = projectCameraPoint(zoomed.camera, anchor);
  expect(projected).toBeDefined();
  expect(
    Math.hypot((projected?.[0] ?? 0) - local[0], (projected?.[1] ?? 0) - local[1]),
  ).toBeLessThan(1);
  expect(cameraDistance(zoomed.camera)).toBeLessThan(cameraDistance(before.camera));
  expect(
    Math.hypot(
      zoomed.camera.target[0] - before.camera.target[0],
      zoomed.camera.target[1] - before.camera.target[1],
      zoomed.camera.target[2] - before.camera.target[2],
    ),
  ).toBeGreaterThan(0.01);
  expectBoundsClippedSafely(zoomed.camera, zoomed.bounds);

  for (let step = 0; step < 2; step += 1) await page.mouse.wheel(0, 180);
  await stableCanvasPixels(page, canvas);
  await page.waitForTimeout(500);
  const restored = await readNavigationState(canvas);
  const restoredProjection = projectCameraPoint(restored.camera, anchor);
  expect(restoredProjection).toBeDefined();
  expect(
    Math.hypot(
      (restoredProjection?.[0] ?? 0) - local[0],
      (restoredProjection?.[1] ?? 0) - local[1],
    ),
  ).toBeLessThan(1);
  expect(cameraDistance(restored.camera)).toBeCloseTo(cameraDistance(before.camera), 4);
});

test("keeps depth-tested edges behind the single edges control", async ({ page }) => {
  await loadWebGpuPage(page);

  await expect(page.getByTestId("renderer-status")).toContainText("Renderer webgpu");
  await expect(page.getByTestId("depth-test")).toHaveCount(0);
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
});

test("does not advertise CPU-only overlay toggles in the context menu", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  const hit = await sweepForHit(page, canvas, {
    attribute: "hovered",
    settleMs: 150,
    fresh: true,
  });
  if (hit === undefined) {
    test.skip(true, "picking is not functional in this browser environment");
    return;
  }

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();

  // The node/normal/face-boundary/ID overlays were CPU-renderer-only and are
  // gone with it; the menu must not advertise them at all.
  for (const action of ["node-markers", "normals", "face-boundaries", "ids"]) {
    await expect(menu.locator(`button[data-action="${action}"]`)).toHaveCount(0);
  }
  // The edge overlay and diagnostics are real workbench display controls.
  await expect(menu.locator('button[data-action="edges"]')).toBeEnabled();
  await expect(menu.locator('button[data-action="diagnostics"]')).toBeEnabled();
});

test("tears the renderer down and re-initializes it cleanly", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.evaluate(() => {
    (window as { femgxDemo?: { destroyRenderer: () => void } }).femgxDemo?.destroyRenderer();
  });
  await expect.poll(() => rendererMode(page)).toBe("destroyed");

  await page.evaluate(() => {
    void (
      window as {
        femgxDemo?: { recreateRenderer: () => Promise<void> };
      }
    ).femgxDemo?.recreateRenderer();
  });
  await expect.poll(() => rendererMode(page)).toBe("webgpu");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBeNull();

  expect(errors, "teardown and re-initialization must not raise page errors").toEqual([]);
});

test("reports the WebGPU-only contract instead of a CPU fallback when WebGPU is unavailable", async ({
  page,
}) => {
  // Simulate a browser without WebGPU by hiding `navigator.gpu` before any
  // page script runs. The demo must report an explicit unsupported state with
  // the probe diagnostic and must never start a 2D CPU renderer for the model.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "gpu", {
      configurable: true,
      get: () => undefined,
    });
  });
  await page.goto("/");

  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => rendererMode(page), { timeout: 10_000 }).toBe("unsupported");

  // The page clearly reports that femgx requires a usable WebGPU renderer,
  // including the capability-probe diagnostic.
  await expect(page.getByTestId("renderer-status")).toHaveText("Renderer unsupported");
  await expect(page.getByTestId("status")).toContainText("femgx requires a usable WebGPU renderer");
  await expect(page.getByTestId("status")).toContainText("navigator.gpu is not exposed");

  // Failed WebGPU startup never creates a 2D CPU renderer for the model view.
  expect(await rendererMode(page)).toBe("unsupported");
});

test("keeps the solid frame deterministic across page loads", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const first = await stableCanvasPixels(page, canvas);

  await page.reload();
  await expect.poll(() => rendererMode(page)).toBe("webgpu");
  const second = await stableCanvasPixels(page, canvas);

  expect(first.equals(second), "base pixel output must be deterministic").toBe(true);
});

test("renders a distinct edge-overlay frame", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const solid = await stableCanvasPixels(page, canvas);

  await page.getByTestId("edge-overlay").click();
  const edge = await stableCanvasPixels(page, canvas);

  expect(edge.equals(solid), "edge mode must render different pixels than solid").toBe(false);
});

test("keeps selected volume faces lit, distinct, and reversible with overlays", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-select").selectOption("results");
  await expect(canvas).toHaveAttribute("data-model", "results");
  await page.getByTestId("results-toggle").click();
  await expect(page.getByTestId("results-toggle")).toHaveText("Results: Base");
  await dragCamera(page, canvas, { x: 64, y: 24 });
  const hoverPoint = await sweepForHit(page, canvas, {
    attribute: "hovered",
    settleMs: 150,
    fresh: true,
  });
  if (hoverPoint === undefined) {
    test.skip(true, "picking is not functional in this browser environment");
    return;
  }

  await clearHover(page, canvas);
  const before = await stableCanvasPixels(page, canvas);
  const baselineRgba = await canvasRgba(page, canvas);
  await page.keyboard.down("Shift");
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);
  await clearHover(page, canvas);
  const selected = await stableCanvasPixels(page, canvas);
  const selectedRgba = await canvasRgba(page, canvas);

  expect(selected.equals(before), "selecting an instance must change the rendered pixels").toBe(
    false,
  );
  expect(
    (await stableCanvasPixels(page, canvas)).equals(selected),
    "the selected state must render deterministically",
  ).toBe(true);
  expect(
    selectedLuminanceSpread(baselineRgba, selectedRgba),
    "differently oriented selected volume faces must retain useful lighting contrast",
  ).toBeGreaterThan(18);

  await page.keyboard.down("Shift");
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe("");
  await clearHover(page, canvas);
  expect(
    (await stableCanvasPixels(page, canvas)).equals(before),
    "deselection must restore the ordinary surface appearance",
  ).toBe(true);

  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
  const overlaid = await stableCanvasPixels(page, canvas);
  await page.keyboard.down("Shift");
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);
  await clearHover(page, canvas);
  const selectedOverlaid = await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(overlaid, selectedOverlaid),
    "selected volume must remain clear when edges and nodes are enabled",
  ).toBeGreaterThan(200);
});

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
