import { expect, test } from "@playwright/test";
import { activateContextAction, openCommandPanel, waitForRenderer } from "./demo-support";

test("refits cleanly after switching from a larger gallery to the bolted model", async ({
  page,
}) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await openCommandPanel(page, "view");
  await select.selectOption("gallery");
  await page.getByTestId("fit-view").click();
  await expect(page.getByTestId("fit-view")).toHaveText("Fit model");

  await select.selectOption("bolted");
  await page.getByTestId("fit-view").click();
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("fit-view")).toHaveText("Fit model");
});

test("cycles the canonical static results preset through base, colored, and deformed states", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("results");
  await openCommandPanel(page, "analysis");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-model", "results");
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  await expect(page.getByTestId("result-legend")).toContainText("Demo temperature · Snapshot 1");
  await expect(page.getByTestId("result-legend")).toContainText("Nodal · Unit C");
  await expect(page.getByTestId("result-legend")).toContainText("Range 10 – 100");

  const resultField = page.getByTestId("result-field");
  const deformationField = page.getByTestId("deformation-field");
  await expect(resultField).toHaveValue("demo-stress");
  await resultField.selectOption("__base__");
  await expect(canvas).toHaveAttribute("data-results", "base");
  await resultField.selectOption("demo-stress");
  await deformationField.selectOption("__off__");
  await expect(canvas).toHaveAttribute("data-results", "colored");
  await deformationField.selectOption("demo-displacement");
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  const scale = page.getByTestId("deformation-scale");
  await scale.fill("2");
  await scale.press("Enter");
  await expect(scale).toHaveValue("2");
});

test("steps and plays authored result snapshots from the Analysis inspector", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("results");
  await openCommandPanel(page, "analysis");

  const position = page.getByTestId("result-playback-position");
  const next = page.getByTestId("result-playback-next");
  const previous = page.getByTestId("result-playback-previous");
  const play = page.getByTestId("result-playback-play");
  await expect(position).toContainText("Snapshot 1");
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(page.getByTestId("result-playback-index")).toHaveAttribute("max", "3");

  await next.click();
  await expect(position).toContainText("Snapshot 2");
  await expect(page.getByTestId("result-legend")).toContainText("Nodal · Unit C");
  await page.getByTestId("result-playback-rate").selectOption("2");
  await play.click();
  await expect(play).toHaveText("Pause");
  await expect.poll(() => position.textContent()).not.toContain("Snapshot 2");
  await play.click();

  await page.getByTestId("result-playback-index").fill("3");
  await expect(position).toContainText("Snapshot 4");
  await expect(page.getByTestId("result-legend")).toContainText("Demo temperature · Snapshot 4");

  await expect(page.getByTestId("result-legend")).toContainText("Range 10 – 100");
  await page.setViewportSize({ width: 390, height: 844 });
  const playBox = await play.boundingBox();
  if (playBox === null) throw new Error("mobile playback control has no bounds");
  expect(playBox.height).toBeGreaterThanOrEqual(44);
});

test("switches Results and VTK between elemental and nodal scalar fields", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  const resultField = page.getByTestId("result-field");

  await page.getByTestId("model-select").selectOption("results");
  await openCommandPanel(page, "analysis");
  await expect(resultField.locator("option")).toHaveText([
    "Base",
    "Demo stress · Elemental",
    "Demo temperature · Nodal",
  ]);
  await expect(resultField).toHaveValue("demo-stress");
  await resultField.selectOption("demo-temperature");
  await expect(resultField).toHaveValue("demo-temperature");
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  await expect(page.getByTestId("result-legend")).toContainText("Demo temperature");
  await expect(page.getByTestId("result-legend")).toContainText("Nodal · Unit C");

  await page.getByTestId("model-select").selectOption("vtk");
  await expect(resultField.locator("option")).toHaveText([
    "Base",
    "stress · Elemental",
    "temperature · Nodal",
  ]);
  await expect(resultField).toHaveValue("vtk-stress");
  await resultField.selectOption("vtk-temperature");
  await expect(resultField).toHaveValue("vtk-temperature");
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  await expect(page.getByTestId("result-legend")).toContainText("temperature");
  await expect(page.getByTestId("result-legend")).toContainText("Nodal · Unit C");
});

test("keeps dependent analysis controls contextual and the legend compact", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  await page.getByTestId("model-select").selectOption("results");
  await openCommandPanel(page, "analysis");

  const canvas = page.getByTestId("view-canvas");
  const resultField = page.getByTestId("result-field");
  const scale = page.getByTestId("deformation-scale");
  const vectorField = page.getByTestId("vector-field");
  const sectionAxis = page.getByTestId("section-axis");
  await expect(scale).toBeVisible();
  await expect(page.getByTestId("vector-glyph")).toBeVisible();
  await expect(page.getByTestId("section-offset")).toBeHidden();
  await expect(page.getByTestId("result-legend")).not.toContainText("Colors #");

  await page.getByTestId("deformation-field").selectOption("__off__");
  await expect(canvas).toHaveAttribute("data-results", "colored");
  await expect(scale).toBeHidden();
  await vectorField.selectOption("__vectors_off__");
  await expect(page.getByTestId("vector-glyph")).toBeHidden();
  await expect(page.getByTestId("vector-transform")).toBeHidden();
  await expect(page.getByTestId("vector-length-scale")).toBeHidden();
  await expect(page.getByTestId("vector-help")).toBeHidden();

  await sectionAxis.selectOption("z");
  await expect(page.getByTestId("section-offset")).toBeVisible();
  await sectionAxis.selectOption("off");
  await expect(page.getByTestId("section-offset")).toBeHidden();
  await resultField.selectOption("__base__");
  await expect(page.getByTestId("deformation-section")).toBeHidden();
  await resultField.selectOption("demo-stress");
  await expect(page.getByTestId("deformation-section")).toBeVisible();
});

test("validates signed normals and sign-invariant fibers in one shared results panel", async ({
  page,
}) => {
  await page.goto("/");
  await waitForRenderer(page);
  await page.getByTestId("model-select").selectOption("results");
  await openCommandPanel(page, "analysis");
  const canvas = page.getByTestId("view-canvas");
  const vectorField = page.getByTestId("vector-field");
  await expect(page.getByTestId("result-controls")).toBeVisible();
  await expect(vectorField).toHaveValue("demo-normals");
  await expect(page.getByTestId("vector-help")).toHaveText(
    "Authored vectors are normalized for display; magnitude is not displayed",
  );
  await expect(canvas).toHaveAttribute("data-vector-field", "demo-normals");

  await vectorField.selectOption("demo-fibers");
  await expect(canvas).toHaveAttribute("data-vector-field", "demo-fibers");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(null);

  await page.getByTestId("vector-glyph").selectOption("axis");
  await page.getByTestId("vector-transform").selectOption("direction");
  await page.getByTestId("vector-length-scale").fill("1.6");
  await page.getByTestId("vector-length-scale").press("Enter");
  const vectorWidth = page.getByTestId("vector-width-pixels");
  await expect(vectorWidth).toHaveAttribute("aria-label", "Vector glyph width in CSS pixels");
  await vectorWidth.fill("1");
  await vectorWidth.press("Enter");
  await expect(canvas).toHaveAttribute("data-vector-glyph", "axis");
  await expect(canvas).toHaveAttribute("data-vector-transform", "direction");
  await expect(page.getByTestId("vector-length-scale")).toHaveValue("1.6");
  await expect(vectorWidth).toHaveValue("1");
  await expect(page.getByTestId("result-legend")).toContainText(
    "Authored vectors normalized for display",
  );
  await expect(page.getByTestId("result-legend")).toContainText("Magnitude not displayed");
  await expect(page.getByTestId("result-legend-orientation")).toContainText("Axis / Direction");
  await expect(page.getByTestId("result-legend-deformation")).toContainText("Scale 1");

  const beforeBase = await canvas.getAttribute("data-frames");
  await page.getByTestId("result-field").selectOption("__base__");
  await expect(canvas).toHaveAttribute("data-results", "base");
  await expect(canvas).toHaveAttribute("data-vector-field", "demo-fibers");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(beforeBase);

  await page.setViewportSize({ width: 390, height: 844 });
  await openCommandPanel(page, "analysis");
  await expect(page.getByTestId("result-controls")).toBeVisible();
  await expect(vectorField).toBeVisible();
  await vectorWidth.scrollIntoViewIfNeeded();
  await vectorWidth.fill("2");
  await vectorWidth.press("Enter");
  await expect(vectorWidth).toHaveValue("2");
  await expect(vectorWidth).toBeVisible();
});

test("applies one shared section plane over complete placed-volume bounds", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("section-volume");
  await openCommandPanel(page, "analysis");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-model", "section-volume");
  await expect(page.getByTestId("section-axis")).toHaveValue("off");

  await page.getByTestId("section-axis").selectOption("x");
  await expect(canvas).toHaveAttribute("data-section-axis", "x");
  await expect(page.getByTestId("result-legend-section")).toContainText("Keep +X");
  await expect(page.getByTestId("section-offset")).toBeEnabled();
  await expect(page.getByTestId("section-offset")).toHaveAttribute("max", /.+/);
  await page.getByTestId("section-offset").evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("section slider missing");
    element.value = element.max;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(canvas).toHaveAttribute(
    "data-section-offset",
    await page.getByTestId("section-offset").inputValue(),
  );
  await openCommandPanel(page, "view");
  await page.getByTestId("viewport-toggle").click();
  await expect(page.getByTestId("secondary-view-canvas")).toHaveAttribute("data-section-axis", "x");
});

test("reset restores the complete workbench display state", async ({ page }) => {
  await page.goto("/");
  const firstPart = page.locator("#visibility-panel input[data-instance-id]").first();
  await firstPart.uncheck();
  await openCommandPanel(page, "display");
  await page.getByTestId("edge-overlay").click();
  await page.getByTestId("node-overlay").click();
  await openCommandPanel(page, "view");
  await page.getByTestId("projection-toggle").click();

  await expect(firstPart).not.toBeChecked();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("projection-toggle")).toHaveText("Perspective");

  await activateContextAction(page, "reset");
  await openCommandPanel(page, "display");
  await openCommandPanel(page, "view");
  await expect(firstPart).toBeChecked();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("projection-toggle")).toHaveText("Orthographic");
});

test("switches projection, fits to view, and resets camera controls", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  await openCommandPanel(page, "view");
  const button = page.getByTestId("projection-toggle");
  const fit = page.getByTestId("fit-view");
  await expect(fit).toHaveText("Fit model");
  await expect(fit).toHaveAttribute("aria-label", "Fit model");
  await expect(fit).toHaveAttribute("aria-keyshortcuts", "Z");
  await expect(page.getByTestId("interaction-help")).toContainText("Press Z");
  await expect(button).toHaveText("Orthographic");
  await page.getByTestId("projection-toggle").click();
  await expect(button).toHaveText("Perspective");

  await fit.click();
  await expect(button).toHaveText("Perspective");

  await activateContextAction(page, "reset");
  await expect(button).toHaveText("Orthographic");
});
