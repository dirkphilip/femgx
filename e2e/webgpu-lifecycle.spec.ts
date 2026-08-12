/** lifecycle ownership: WebGPU startup, interaction, and lifecycle contracts. */

import { expect, test } from "@playwright/test";
import { rendererMode, loadWebGpuPage } from "./webgpu-support";

test("uses a hardware adapter for the authoritative WebGPU lane", async ({ page }) => {
  await loadWebGpuPage(page);

  const adapter = await page.evaluate(async () => {
    const resolved = await navigator.gpu.requestAdapter();
    if (resolved === null) return null;
    const { architecture, description, device, isFallbackAdapter, vendor } = resolved.info;
    return { architecture, description, device, isFallbackAdapter, vendor };
  });

  expect(adapter, "the WebGPU lane must resolve an adapter").not.toBeNull();
  expect(
    adapter?.isFallbackAdapter,
    `expected a hardware adapter, received ${JSON.stringify(adapter)}`,
  ).toBe(false);
  expect(
    [adapter?.vendor, adapter?.architecture, adapter?.device, adapter?.description].join(" "),
    `expected a hardware adapter, received ${JSON.stringify(adapter)}`,
  ).not.toMatch(/swiftshader|software/i);
});

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
  await expect(page.getByTestId("status")).toBeVisible();
  await expect(page.getByTestId("status")).toContainText("femgx requires a usable WebGPU renderer");
  await expect(page.getByTestId("status")).toContainText("navigator.gpu is not exposed");

  // Failed WebGPU startup never creates a 2D CPU renderer for the model view.
  expect(await rendererMode(page)).toBe("unsupported");
});
