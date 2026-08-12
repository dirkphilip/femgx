import { expect, test } from "@playwright/test";
import { drawnPixels, waitForRenderer } from "./demo-support";

const fixture = "test/io/fixtures/glb/onshape-cylinder-uncompressed.glb";
const phone = { width: 390, height: 844 };

test("opens an uncompressed GLB and resets the imported model in desktop Chrome", async ({
  page,
}) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  const fileInput = page.getByTestId("glb-file");
  await fileInput.setInputFiles(fixture);

  await expect(canvas).toHaveAttribute("data-model", "opened-glb");
  await expect(page.getByTestId("model-select")).toHaveValue("opened-glb");
  await expect(page.getByTestId("model-select")).toContainText(
    "Opened · onshape-cylinder-uncompressed.glb",
  );
  await expect(page.getByTestId("status")).toContainText("onshape-cylinder-uncompressed.glb");
  await expect(page.getByTestId("status")).toContainText("4 parts");
  await expect(page.getByTestId("visibility-panel")).toContainText("Part 1");
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  await page.getByTestId("view-canvas").click({ button: "right", position: { x: 8, y: 500 } });
  await page.getByTestId("context-menu").getByText("Show diagnostics").click();
  await expect(page.getByTestId("stats-panel")).toContainText("PTC_onshape_metadata");

  await page.getByTestId("edge-overlay").click();
  await page.getByTestId("reset").click();
  await expect(page.getByTestId("model-select")).toHaveValue("opened-glb");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-camera", /perspective/);
  await page.screenshot({ path: "test-results/glb-desktop.png", fullPage: true });
});

test("keeps the GLB source action usable on a 390px viewport", async ({ page }) => {
  await page.setViewportSize(phone);
  await page.goto("/");
  await waitForRenderer(page);
  const fileInput = page.getByTestId("glb-file");
  await fileInput.setInputFiles(fixture);

  await expect(page.getByTestId("open-glb")).toBeVisible();
  await expect(page.getByTestId("model-select")).toHaveValue("opened-glb");
  await expect(page.getByTestId("model-feedback")).toContainText("Opened");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "opened-glb");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/glb-mobile.png", fullPage: true });
});
