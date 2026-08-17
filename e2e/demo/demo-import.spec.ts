import { expect, test, type Page } from "@playwright/test";
import {
  activateContextAction,
  drawnPixels,
  loadWebGpuPage,
  openCommandPanel,
  rendererMode,
  waitForRenderer,
} from "./demo-support";

const fixture = "test/io/fixtures/glb/onshape-cylinder-compressed.glb";
const phone = { width: 390, height: 844 };

async function waitForPresentedCanvas(page: Page): Promise<void> {
  await expect
    .poll(() => drawnPixels(page.getByTestId("view-canvas")), { timeout: 10_000 })
    .toBe(true);
}

test("selects an accessible background preset and preserves it across workbench transitions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadWebGpuPage(page);
  await openCommandPanel(page, "view");
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

  await activateContextAction(page, "reset");
  await openCommandPanel(page, "view");
  await expect(background).toHaveValue("dark");

  await page.getByTestId("model-file").setInputFiles(fixture);
  await expect(canvas).toHaveAttribute("data-model", "opened-model", { timeout: 10_000 });
  await expect(background).toHaveValue("dark");

  await page.evaluate(() => {
    (window as { femgxDemo?: { destroyRenderer: () => void } }).femgxDemo?.destroyRenderer();
  });
  await expect.poll(() => rendererMode(page, canvas)).toBe("destroyed");
  await page.evaluate(() => {
    void (
      window as {
        femgxDemo?: { recreateRenderer: () => Promise<void> };
      }
    ).femgxDemo?.recreateRenderer();
  });
  await waitForRenderer(page, canvas);
  await expect(background).toHaveValue("dark");
  await waitForPresentedCanvas(page);
  await page.screenshot({ path: "test-results/background-selector-desktop.png", fullPage: true });
});

test("keeps the background selector reachable without mobile toolbar overflow", async ({
  page,
}) => {
  await page.setViewportSize(phone);
  await loadWebGpuPage(page);
  await openCommandPanel(page, "view");
  const background = page.getByLabel("Background");
  await expect(background).toBeVisible();
  await background.selectOption("white");
  await expect(background).toHaveValue("white");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await waitForPresentedCanvas(page);
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

  await page.getByTestId("view-canvas").click({ button: "right", position: { x: 8, y: 500 } });
  await page.getByTestId("context-menu").getByText("Show diagnostics").click();
  await expect(page.getByTestId("stats-panel")).toContainText("PTC_onshape_metadata");

  await openCommandPanel(page, "display");
  await page.getByTestId("edge-overlay").click();
  await activateContextAction(page, "reset");
  await openCommandPanel(page, "display");
  await expect(page.getByTestId("model-select")).toHaveValue("opened-model");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-camera", /orthographic/);
  await waitForPresentedCanvas(page);
  await page.screenshot({ path: "test-results/glb-desktop.png", fullPage: true });
});

test("keeps the active model when a local model file fails to open", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-file").setInputFiles({
    name: "broken.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from("not a GLB file"),
  });

  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("model-select")).toHaveValue("bolted");
  await expect(page.getByTestId("model-feedback")).toContainText("could not be opened");
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
  await waitForPresentedCanvas(page);
  await page.screenshot({ path: "test-results/glb-mobile.png", fullPage: true });
});
