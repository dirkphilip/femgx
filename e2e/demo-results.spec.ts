import { expect, test } from "@playwright/test";
import {
  dataset,
  distinctColors,
  drawnPixels,
  pixelHash,
  requireHit,
  waitForRenderer,
} from "./demo-support";

test("refits cleanly after switching from a larger gallery to the bolted model", async ({
  page,
}) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await select.selectOption("gallery");
  await page.getByTestId("fit-view").click();
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  await select.selectOption("bolted");
  await page.getByTestId("fit-view").click();
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must remain functional after history-independent fitting",
  );
  expect(hit.key).toMatch(/^(n|f|e|i|p):/);
});

test("cycles the canonical static results preset through base, colored, and deformed states", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("results");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-model", "results");
  await expect(canvas).toHaveAttribute("data-results", "deformed");

  const resultsToggle = page.getByTestId("results-toggle");
  await expect(resultsToggle).toBeEnabled();
  await resultsToggle.click();
  await expect(canvas).toHaveAttribute("data-results", "base");
  await resultsToggle.click();
  await expect(canvas).toHaveAttribute("data-results", "colored");
  await resultsToggle.click();
  await expect(canvas).toHaveAttribute("data-results", "deformed");
});

test("shows distinct scalar contours and deformation in every results state", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  await page.getByTestId("model-select").selectOption("results");
  const canvas = page.getByTestId("view-canvas");
  const resultsToggle = page.getByTestId("results-toggle");

  await resultsToggle.click();
  await expect(canvas).toHaveAttribute("data-results", "base");
  const baseHash = await pixelHash(canvas);
  expect(await distinctColors(canvas), "base must render a visible neutral mesh").toBeGreaterThan(
    3,
  );

  await resultsToggle.click();
  await expect(canvas).toHaveAttribute("data-results", "colored");
  await expect.poll(() => distinctColors(canvas), { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  const coloredHash = await pixelHash(canvas);
  expect(coloredHash, "colored results must change the canvas pixels").not.toBe(baseHash);

  await resultsToggle.click();
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  await expect.poll(() => distinctColors(canvas), { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  expect(await pixelHash(canvas), "deformed results must change the canvas pixels").not.toBe(
    coloredHash,
  );
});

test("keeps result-strip node and face picks on original ids after deformation", async ({
  page,
}) => {
  await page.goto("/");
  await waitForRenderer(page);
  await page.getByTestId("model-select").selectOption("results");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-results", "deformed");

  const nodeHit = await requireHit(
    page,
    canvas,
    { prefix: "n:", fresh: true },
    "the deformed results strip must resolve authored node picks",
  );
  await page.mouse.click(nodeHit.x, nodeHit.y);
  await expect(page.getByTestId("inspection-panel")).toContainText("Node");
  expect(await canvas.getAttribute("data-pick")).toMatch(/^n:/);

  const faceHit = await requireHit(
    page,
    canvas,
    { prefix: "f:", reverse: true, fresh: true },
    "the deformed results strip must resolve authored face picks",
  );
  await page.mouse.click(faceHit.x, faceHit.y);
  await expect(page.getByTestId("inspection-panel")).toContainText("Face");
  expect(await canvas.getAttribute("data-pick")).toMatch(/^f:/);
});

test("reset restores the complete workbench display state", async ({ page }) => {
  await page.goto("/");
  const firstPart = page.locator("#visibility-panel input[data-instance-id]").first();
  await firstPart.uncheck();
  await page.getByTestId("edge-overlay").click();
  await page.getByTestId("node-overlay").click();
  await page.getByTestId("projection-toggle").click();

  await expect(firstPart).not.toBeChecked();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("projection-toggle")).toHaveText("Perspective");

  await page.getByTestId("reset").click();
  await expect(firstPart).toBeChecked();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("projection-toggle")).toHaveText("Orthographic");
});

test("switches projection, fits to view, and resets camera controls", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  const button = page.getByTestId("projection-toggle");
  const fit = page.getByTestId("fit-view");
  const reset = page.getByTestId("reset");
  await expect(fit).toHaveText("Fit model");
  await expect(fit).toHaveAttribute("aria-label", "Fit model");
  await expect(reset).toHaveText("Reset all");
  await expect(reset).toHaveAttribute("aria-label", "Reset all");
  await expect(button).toHaveText("Orthographic");
  await page.getByTestId("projection-toggle").click();
  await expect(button).toHaveText("Perspective");

  await fit.click();
  await expect(button).toHaveText("Perspective");

  await reset.click();
  await expect(button).toHaveText("Orthographic");
});

test("Fit model preserves workbench state while Reset all restores preset defaults", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("results");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "results");

  const canvas = page.getByTestId("view-canvas");
  const instance = page.getByTestId("visibility-panel").locator("input[data-instance-id]").first();
  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve before comparing Fit model and Reset all",
  );
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).not.toBe("");

  await instance.uncheck();
  await page.getByTestId("edge-overlay").click();
  await page.getByTestId("node-overlay").click();
  await page.getByTestId("projection-toggle").click();
  await page.getByTestId("results-toggle").click();
  await expect(page.getByTestId("results-toggle")).toHaveText("Results: Base");

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu.getByText("Show diagnostics")).toBeVisible();
  await menu.getByText("Show diagnostics").click();
  const diagnostics = page.getByTestId("stats-panel");
  await expect(diagnostics).toBeVisible();

  const beforeFitSelection = await dataset(page, "selected");
  const beforeFitCamera = await canvas.getAttribute("data-camera");
  const canvasBox = await canvas.boundingBox();
  if (canvasBox === null) throw new Error("canvas has no bounding box");
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -160);
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(beforeFitCamera);
  const zoomedCamera = await canvas.getAttribute("data-camera");

  await page.getByTestId("fit-view").click();
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(zoomedCamera);
  await expect(page.getByTestId("projection-toggle")).toHaveText("Perspective");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("results-toggle")).toHaveText("Results: Base");
  await expect(instance).not.toBeChecked();
  await expect(diagnostics).toBeVisible();
  await expect.poll(() => dataset(page, "selected")).toBe(beforeFitSelection);

  await page.getByTestId("reset").click();
  await expect(page.getByTestId("projection-toggle")).toHaveText("Orthographic");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("results-toggle")).toHaveText("Results: Deformed");
  await expect(instance).toBeChecked();
  await expect(diagnostics).toBeHidden();
  await expect.poll(() => dataset(page, "selected")).toBe("");
});
