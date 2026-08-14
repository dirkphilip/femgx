import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drawnPixels, waitForRenderer } from "./demo-support";
import { loadWebGpuPage } from "./webgpu-support";

const fixture = "test/io/fixtures/glb/onshape-cylinder-compressed.glb";
const vtkFixture = readFileSync(join(process.cwd(), "demo/fixture/sample-block.vtk"));
const phone = { width: 390, height: 844 };

test("selects an accessible background preset and preserves it across workbench transitions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const background = page.getByLabel("Background");

  await expect(background).toHaveValue("studio");
  await expect(background.locator("option")).toHaveText(["Studio", "White", "Dark"]);
  await expect(page.locator('label[for="background-select"]')).toContainText("Background");

  await background.selectOption("dark");
  await expect(background).toHaveValue("dark");
  await expect(canvas).toHaveAttribute("data-background", "dark");

  await page.getByTestId("model-select").selectOption("gallery");
  await expect(canvas).toHaveAttribute("data-model", "gallery");
  await expect(background).toHaveValue("dark");

  await page.getByTestId("reset").click();
  await expect(background).toHaveValue("dark");

  await page.getByTestId("model-file").setInputFiles(fixture);
  await expect(canvas).toHaveAttribute("data-model", "opened-model", { timeout: 10_000 });
  await expect(background).toHaveValue("dark");

  await page.evaluate(() => {
    (window as { femgxDemo?: { destroyRenderer: () => void } }).femgxDemo?.destroyRenderer();
  });
  await expect(canvas).toHaveAttribute("data-renderer", "destroyed");
  await page.evaluate(() => {
    void (
      window as {
        femgxDemo?: { recreateRenderer: () => Promise<void> };
      }
    ).femgxDemo?.recreateRenderer();
  });
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu");
  await expect(background).toHaveValue("dark");
  await page.screenshot({ path: "test-results/background-selector-desktop.png", fullPage: true });
});

test("keeps the background selector reachable without mobile toolbar overflow", async ({
  page,
}) => {
  await page.setViewportSize(phone);
  await loadWebGpuPage(page);
  const background = page.getByLabel("Background");
  await expect(background).toBeVisible();
  await background.selectOption("white");
  await expect(background).toHaveValue("white");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/background-selector-mobile.png", fullPage: true });
});

test("opens a Draco-compressed GLB and resets the imported model in desktop Chrome", async ({
  page,
}) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  const fileInput = page.getByTestId("model-file");
  await fileInput.setInputFiles(fixture);

  await expect
    .poll(() => canvas.getAttribute("data-model"), { timeout: 10_000 })
    .toBe("opened-model");
  await expect(page.getByTestId("model-select")).toHaveValue("opened-model");
  await expect(page.getByTestId("model-select")).toContainText(
    "Opened · onshape-cylinder-compressed.glb",
  );
  await expect(page.getByTestId("status")).toContainText("onshape-cylinder-compressed.glb");
  await expect(page.getByTestId("status")).toContainText("4 parts");
  await expect(page.getByTestId("visibility-panel")).toContainText("Part 1");
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  await page.getByTestId("view-canvas").click({ button: "right", position: { x: 8, y: 500 } });
  await page.getByTestId("context-menu").getByText("Show diagnostics").click();
  await expect(page.getByTestId("stats-panel")).toContainText("PTC_onshape_metadata");

  await page.getByTestId("edge-overlay").click();
  await page.getByTestId("reset").click();
  await expect(page.getByTestId("model-select")).toHaveValue("opened-model");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-camera", /orthographic/);
  await page.screenshot({ path: "test-results/glb-desktop.png", fullPage: true });
});

test("opens a local VTK mesh through the canonical workbench path", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-file").setInputFiles({
    name: "sample.vtk",
    mimeType: "text/plain",
    buffer: vtkFixture,
  });

  await expect
    .poll(() => canvas.getAttribute("data-model"), { timeout: 10_000 })
    .toBe("opened-model");
  await expect(page.getByTestId("model-select")).toHaveValue("opened-model");
  await expect(page.getByTestId("model-select")).toContainText("Opened · sample.vtk");
  await expect(page.getByTestId("status")).toContainText("1 parts");
  await expect(page.getByTestId("result-controls")).toBeVisible();
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  await page.getByTestId("model-select").selectOption("gallery");
  await expect(canvas).toHaveAttribute("data-model", "gallery");
  await page.screenshot({ path: "test-results/vtk-open-desktop.png", fullPage: true });
});

test("keeps the active model when a local model file fails to open", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-file").setInputFiles({
    name: "broken.vtk",
    mimeType: "text/plain",
    buffer: Buffer.from("not a VTK file"),
  });

  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("model-select")).toHaveValue("bolted");
  await expect(page.getByTestId("model-feedback")).toContainText("could not be opened");
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
});

test("keeps the GLB source action usable on a 390px viewport", async ({ page }) => {
  await page.setViewportSize(phone);
  await page.goto("/");
  await waitForRenderer(page);
  const fileInput = page.getByTestId("model-file");
  await fileInput.setInputFiles(fixture);

  await expect(page.getByTestId("open-model")).toBeVisible();
  await expect(page.getByTestId("model-select")).toHaveValue("opened-model");
  await expect(page.getByTestId("model-feedback")).toContainText("Opened");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "opened-model");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/glb-mobile.png", fullPage: true });
});
