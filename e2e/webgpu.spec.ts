import { expect, test, type Locator, type Page } from "@playwright/test";
import { sweepForHit } from "./helpers";

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
async function loadWebGpuPage(page: Page): Promise<void> {
  await page.goto("/");
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
      mask: [page.locator(".toolbar, #performance-overlay, #inspection-panel, #status")],
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

/** Node-on vs node-off pixel contribution for the current camera. */
async function nodeContribution(page: Page): Promise<number> {
  const canvas = page.getByTestId("view-canvas");
  const label = page.getByTestId("node-overlay-label");
  if ((await label.textContent()) !== "On") {
    await page.getByTestId("node-overlay").click();
    await expect(label).toHaveText("On");
  }
  await page.waitForTimeout(50);
  const withNodes = await canvasRgba(page, canvas);
  await page.getByTestId("node-overlay").click();
  await expect(label).toHaveText("Off");
  await page.waitForTimeout(50);
  const withoutNodes = await canvasRgba(page, canvas);
  await page.getByTestId("node-overlay").click();
  await expect(label).toHaveText("On");
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
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("On");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBeNull();
  expect(await canvas.getAttribute("data-selected")).toBe(selected);

  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("Off");
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

  const canvas = page.getByTestId("view-canvas");
  const baseline = await stableCanvasPixels(page, canvas);
  const nodeToggle = page.getByTestId("node-overlay");
  await nodeToggle.click();
  await expect(page.getByTestId("node-overlay-label")).toHaveText("On");
  await expect(nodeToggle).toHaveText("Hide element nodes");
  const withNodes = await stableCanvasPixels(page, canvas);
  expect(withNodes.equals(baseline), "node glyphs must change the rendered pixels").toBe(false);

  await nodeToggle.click();
  await expect(page.getByTestId("node-overlay-label")).toHaveText("Off");
  const restored = await stableCanvasPixels(page, canvas);
  expect(restored.equals(withNodes), "hiding node glyphs must change the annotated frame").toBe(
    false,
  );
});

test("keeps element edges and nodes visible after orbiting", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("edge-overlay").click();
  await page.getByTestId("node-overlay").click();
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("On");
  await expect(page.getByTestId("node-overlay-label")).toHaveText("On");

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
  await page
    .getByTestId("model-select")
    .selectOption({ label: "Element gallery · all supported shapes" });
  // Hide the gallery's hardware point/line overlays so the measured delta is
  // only the center-depth node annotation pass.
  await page.getByTestId("instance-vis-0").uncheck();
  await page.getByTestId("instance-vis-1").uncheck();
  await page.getByTestId("fit-view").click();

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await page.getByTestId("node-overlay").click();
  await expect(page.getByTestId("node-overlay-label")).toHaveText("On");

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
    ).toBeGreaterThan(baseline * 0.35);
    expect(
      count,
      `node contribution must not explode from flicker/leakage (step ${index}: ${String(count)} vs ${String(baseline)})`,
    ).toBeLessThan(baseline * 3);
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

test("keeps the depth-test toggle working on the WebGPU renderer", async ({ page }) => {
  await loadWebGpuPage(page);

  // The WebGPU renderer implements depth-tested edges, so the header control
  // stays live and toggles the overlay depth compare.
  await expect(page.getByTestId("renderer-status")).toContainText("Renderer webgpu");
  const depthButton = page.getByTestId("depth-test");
  const depthLabel = page.getByTestId("depth-test-label");
  await expect(depthButton).toBeEnabled();
  await expect(depthLabel).toHaveText("On");
  await depthButton.click();
  await expect(depthLabel).toHaveText("Off");
  await depthButton.click();
  await expect(depthLabel).toHaveText("On");
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
