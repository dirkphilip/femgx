import { expect, test, type Locator, type Page } from "@playwright/test";
import { requireHit } from "./helpers";

/**
 * Visual regression for the WebGPU renderer: solid, edge, and selection modes
 * must each produce stable, mode-distinct pixel output. WebGPU presentation is
 * asynchronous, so each capture settles on several consecutive byte-identical
 * frames before being compared. On an environment that cannot initialize
 * WebGPU the demo reports an explicit unsupported state and these tests skip.
 */

async function rendererMode(page: Page): Promise<string> {
  return (await page.getByTestId("view-canvas").getAttribute("data-renderer")) ?? "";
}

/** Loads the demo and skips when the environment cannot run WebGPU. */
async function loadVisualPage(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect
    .poll(() => rendererMode(page), { timeout: 10_000 })
    .toMatch(/^(webgpu|unsupported)$/);
  if ((await rendererMode(page)) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }
}

/** Captures the canvas pixels once the presented frame settles. */
async function stableCanvasPixels(page: Page, canvas: Locator): Promise<Buffer> {
  let previous: Buffer | undefined;
  let streak = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const shot = await canvas.screenshot();
    if (previous !== undefined && shot.equals(previous)) streak += 1;
    else streak = 0;
    previous = shot;
    if (streak >= 2) return shot;
    await page.waitForTimeout(100);
  }
  throw new Error("canvas pixels never stabilized across captures");
}

test("solid mode renders deterministically across page loads", async ({ page }) => {
  await loadVisualPage(page);
  const canvas = page.getByTestId("view-canvas");
  const first = await stableCanvasPixels(page, canvas);
  await page.reload();
  await expect.poll(() => rendererMode(page)).toBe("webgpu");
  const second = await stableCanvasPixels(page, canvas);
  expect(first.equals(second), "solid mode pixel output must be deterministic").toBe(true);
});

test("edge overlay differs from solid mode", async ({ page }) => {
  await loadVisualPage(page);

  const canvas = page.getByTestId("view-canvas");
  const solid = await stableCanvasPixels(page, canvas);

  await page.getByTestId("edge-overlay").click();
  await expect(canvas).toHaveAttribute("data-mode", "solid");
  const edge = await stableCanvasPixels(page, canvas);

  expect(edge.equals(solid), "edge mode must render different pixels than solid").toBe(false);
});

test("selection changes the rendered pixels and stays stable", async ({ page }) => {
  await loadVisualPage(page);

  const canvas = page.getByTestId("view-canvas");

  // Pick before settled screenshots: screenshots can stall GPU pick readback.
  const hoverPoint = await requireHit(
    page,
    canvas,
    { attribute: "hovered" },
    "a hoverable instance must resolve on the WebGPU renderer",
  );
  const before = await stableCanvasPixels(page, canvas);

  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).not.toBe("");

  const selected = await stableCanvasPixels(page, canvas);
  expect(selected.equals(before), "selecting an instance must change the rendered pixels").toBe(
    false,
  );

  const again = await stableCanvasPixels(page, canvas);
  expect(again.equals(selected), "the selected state must render deterministically").toBe(true);
});
