import { expect, test, type Locator } from "@playwright/test";
import { drawnPixels, pixelHash } from "./helpers";

/**
 * Deterministic CPU-side results demo coverage: undeformed/deformed shape,
 * scalar color mapping, configurable deformation scale, and load-case
 * stepping. The default e2e lane runs the CPU renderer, so the demo's
 * 2D canvas output is fully deterministic and comparable frame to frame.
 */

async function setScale(scale: Locator, value: number): Promise<void> {
  await scale.evaluate((element: HTMLInputElement, next: number) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("renders the undeformed scalar visualization with a legend and range", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("results-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-renderer", "cpu");
  await expect(canvas).toHaveAttribute("data-deformed", "0");
  await expect(canvas).toHaveAttribute("data-scalar", "1");

  expect(await drawnPixels(canvas)).toBe(true);

  const status = page.getByTestId("results-status");
  await expect(status).toContainText("von Mises");
  await expect(status).toContainText("MPa");
  await expect(status).toContainText("1 missing");
  await expect(status).toContainText("undeformed");
});

test("deformation changes the rendered geometry", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("results-canvas");
  await expect(canvas).toBeVisible();

  const undeformed = await pixelHash(canvas);
  await page.getByTestId("results-deformed-toggle").click();
  await expect(canvas).toHaveAttribute("data-deformed", "1");
  await expect(page.getByTestId("results-status")).toContainText("deformed");

  expect(await pixelHash(canvas), "deforming the mesh must redraw the scene").not.toBe(undeformed);
});

test("toggling the scalar overlay changes the color mapping", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("results-canvas");
  await expect(canvas).toBeVisible();

  const scalarOn = await pixelHash(canvas);
  await page.getByTestId("results-scalar-toggle").click();
  await expect(canvas).toHaveAttribute("data-scalar", "0");

  expect(await pixelHash(canvas), "turning off scalar colors must change the render").not.toBe(
    scalarOn,
  );
});

test("the deformation scale drives the deformed shape", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("results-canvas");
  await expect(canvas).toBeVisible();

  await page.getByTestId("results-deformed-toggle").click();
  await expect(canvas).toHaveAttribute("data-deformed", "1");

  const scale = page.getByTestId("results-scale");
  await setScale(scale, 0);
  await expect(canvas).toHaveAttribute("data-scale", "0");
  const flat = await pixelHash(canvas);

  await setScale(scale, 2);
  await expect(canvas).toHaveAttribute("data-scale", "2");
  expect(await pixelHash(canvas), "a larger scale must deform the mesh further").not.toBe(flat);
});

test("load-case stepping swaps the result data", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("results-canvas");
  await expect(canvas).toBeVisible();

  const caseToggle = page.getByTestId("results-case-toggle");
  await expect(caseToggle).toContainText("bending");
  const bending = await pixelHash(canvas);

  await caseToggle.click();
  await expect(canvas).toHaveAttribute("data-case", "1");
  await expect(page.getByTestId("results-status")).toContainText("twist");

  expect(await pixelHash(canvas), "switching the load case must redraw the result").not.toBe(
    bending,
  );
});

test("playback advances load cases over time with interpolated deformation", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("results-canvas");
  const play = page.getByTestId("results-play-toggle");
  await expect(canvas).toHaveAttribute("data-playing", "0");
  await expect(canvas).toHaveAttribute("data-case", "0");

  await page.getByTestId("results-deformed-toggle").click();
  await expect(canvas).toHaveAttribute("data-deformed", "1");
  const before = await pixelHash(canvas);

  await play.click();
  await expect(canvas).toHaveAttribute("data-playing", "1");
  await expect(play).toContainText("Pause");

  await expect.poll(() => canvas.getAttribute("data-case"), { timeout: 4000 }).toBe("1");
  await expect
    .poll(async () => (await canvas.getAttribute("data-blend")) !== "0.000", {
      timeout: 4000,
    })
    .toBe(true);

  expect(await pixelHash(canvas), "playback must redraw the scene").not.toBe(before);

  await play.click();
  await expect(canvas).toHaveAttribute("data-playing", "0");
  await expect(play).toContainText("Play");
});
