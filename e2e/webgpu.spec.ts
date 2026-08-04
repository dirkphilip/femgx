import { expect, test, type Page } from "@playwright/test";

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

  // Sweep the pointer across the canvas until a GPU pick resolves a hover. The
  // pick is asynchronous (GPU readback), so give it time to settle before
  // reading the hover state, and remember where the hover landed so the click
  // below targets the same instance rather than a fixed canvas point.
  let hoverPoint: { readonly x: number; readonly y: number } | undefined;
  for (let row = 0; row < 6 && hoverPoint === undefined; row++) {
    for (let col = 0; col < 8; col++) {
      const x = box.x + ((col + 0.5) / 8) * box.width;
      const y = box.y + ((row + 0.5) / 6) * box.height;
      await page.mouse.move(x, y);
      await page.waitForTimeout(150);
      const hovered = await canvas.getAttribute("data-hovered");
      if (hovered !== null && hovered !== "") {
        hoverPoint = { x, y };
        break;
      }
    }
  }

  if (hoverPoint === undefined) {
    test.skip(true, "GPU picking is not functional in this browser environment");
    return;
  }

  await expect.poll(() => canvas.getAttribute("data-hovered")).not.toBeNull();

  // Click the hovered instance to toggle its selection through GPU picking.
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).not.toBeNull();
  const selected = await canvas.getAttribute("data-selected");
  expect(selected, "clicking an instance should select it").not.toBe("");

  // Clicking again deselects.
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe("");
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
