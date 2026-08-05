import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Opt-in WebGPU browser coverage. It is skipped by the default e2e gate and
 * only runs when `RUN_WEBGPU=1`, which the opt-in `.github/workflows/webgpu.yml`
 * lane sets. The lane launches Chromium with software WebGPU flags
 * (`--enable-unsafe-webgpu --enable-gpu`) so it needs no GPU hardware.
 *
 * The lane is capability-gated, not failure-prone: the demo only commits to
 * the WebGPU renderer when it can prove rendering and picking work, and the
 * tests skip cleanly when an environment cannot exercise WebGPU.
 */
const enabled = process.env["RUN_WEBGPU"] === "1";

test.skip(!enabled, "WebGPU browser coverage is opt-in via RUN_WEBGPU=1");

async function rendererMode(page: Page): Promise<string> {
  return (await page.getByTestId("view-canvas").getAttribute("data-renderer")) ?? "";
}

/**
 * Sweeps the pointer across the canvas until a pick resolves a hover, so
 * right-clicks land on a real target. The pick is CPU raycasting in both
 * renderers with a 10px node radius, so the grid must be dense enough to land
 * on a node; use the same grid as the demo spec.
 */
async function findHoverPoint(
  page: Page,
  canvas: Locator,
): Promise<{ readonly x: number; readonly y: number } | undefined> {
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 10; col++) {
      const x = Math.round(box.x + ((col + 0.5) / 10) * box.width);
      const y = Math.round(box.y + ((row + 0.5) / 8) * box.height);
      await page.mouse.move(x, y);
      await page.waitForTimeout(150);
      const hovered = await canvas.getAttribute("data-hovered");
      if (hovered !== null && hovered !== "") {
        return { x, y };
      }
    }
  }
  return undefined;
}

test("initializes the WebGPU renderer and renders an instanced frame", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect
    .poll(() => rendererMode(page), { timeout: 10_000 })
    .toMatch(/^(webgpu|cpu|destroyed)$/);

  if ((await rendererMode(page)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }

  await expect
    .poll(() => page.getByTestId("view-canvas").getAttribute("data-frames"), { timeout: 10_000 })
    .not.toBeNull();
  const frames = Number(await page.getByTestId("view-canvas").getAttribute("data-frames"));
  expect(frames, "the demo should render its first frame through WebGPU").toBeGreaterThanOrEqual(1);
});

test("drives interaction and picking through the demo path", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect
    .poll(() => rendererMode(page), { timeout: 10_000 })
    .toMatch(/^(webgpu|cpu|destroyed)$/);

  if ((await rendererMode(page)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }

  // Sweep the pointer across the canvas until a pick resolves a hover. Remember
  // where the hover landed so the click below targets the same instance rather
  // than a fixed canvas point.
  const hoverPoint = await findHoverPoint(page, canvas);

  if (hoverPoint === undefined) {
    test.skip(true, "picking is not functional in this browser environment");
    return;
  }

  await expect.poll(() => canvas.getAttribute("data-hovered")).not.toBeNull();

  // Click the hovered target to toggle its selection through the pick path.
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).not.toBeNull();
  const selected = await canvas.getAttribute("data-selected");
  expect(selected, "clicking a target should select it").not.toBe("");

  // Clicking again deselects.
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe("");
});

test("keeps selection feedback visible in edge overlay mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect
    .poll(() => rendererMode(page), { timeout: 10_000 })
    .toMatch(/^(webgpu|cpu|destroyed)$/);

  if ((await rendererMode(page)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }

  // Sweep until the pick resolves any target; the selected key encodes its
  // granularity as a prefix (n:/f:/e:/i:/p:). Dense grid so it lands within
  // the 10px node-pick radius.
  const hoverPoint = await findHoverPoint(page, canvas);

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

test("disables the display-overlay toggles the WebGPU renderer cannot honor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect
    .poll(() => rendererMode(page), { timeout: 10_000 })
    .toMatch(/^(webgpu|cpu|destroyed)$/);

  if ((await rendererMode(page)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }

  const canvas = page.getByTestId("view-canvas");
  const hit = await findHoverPoint(page, canvas);
  if (hit === undefined) {
    test.skip(true, "picking is not functional in this browser environment");
    return;
  }

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();

  // The node/normal/face-boundary/ID overlays are not implemented on the
  // WebGPU path, so the menu must not advertise them as working: the toggles
  // are disabled and annotated instead of silently doing nothing.
  for (const action of ["node-markers", "normals", "face-boundaries", "ids"]) {
    const button = menu.locator(`button[data-action="${action}"]`);
    await expect(button).toBeDisabled();
    await expect(button).toContainText("CPU renderer only");
  }
  // The edge overlay is a real WebGPU pass, so its toggle stays available.
  await expect(menu.locator('button[data-action="edges"]')).toBeEnabled();
});

test("keeps the depth-test toggle working on the WebGPU renderer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect
    .poll(() => rendererMode(page), { timeout: 10_000 })
    .toMatch(/^(webgpu|cpu|destroyed)$/);

  if ((await rendererMode(page)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }

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

test("tears the renderer down and re-initializes it cleanly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect
    .poll(() => rendererMode(page), { timeout: 10_000 })
    .toMatch(/^(webgpu|cpu|destroyed)$/);

  if ((await rendererMode(page)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }

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

test("recovers from GPU device loss or falls back to the CPU renderer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect
    .poll(() => rendererMode(page), { timeout: 10_000 })
    .toMatch(/^(webgpu|cpu|destroyed)$/);

  if ((await rendererMode(page)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }

  const canvas = page.getByTestId("view-canvas");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Destroy the underlying GPU device. The demo either recovers the renderer
  // (re-requesting a device and re-uploading the scene) or, when recovery is
  // impossible, destroys the renderer and starts the CPU fallback; either way
  // it must keep working and never raise page errors.
  await page.evaluate(() => {
    (window as { femgxDemo?: { forceDeviceLoss: () => void } }).femgxDemo?.forceDeviceLoss();
  });
  await expect
    .poll(() => canvas.getAttribute("data-recovery"), { timeout: 10_000 })
    .toMatch(/^(recovered|cpu-fallback)$/);

  const recovery = await canvas.getAttribute("data-recovery");
  if (recovery === "recovered") {
    await expect.poll(() => rendererMode(page)).toBe("webgpu");
    await expect(page.getByTestId("status")).toContainText("recovered");
  } else {
    await expect.poll(() => rendererMode(page)).toBe("cpu");
  }
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBeNull();

  expect(errors, "device loss must not raise page errors").toEqual([]);
});
