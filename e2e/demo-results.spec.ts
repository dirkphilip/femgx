import { expect, test } from "@playwright/test";
import {
  dataset,
  drawnPixels,
  pixelMetrics,
  requireHit,
  setSelectionGranularity,
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
  await expect(page.getByTestId("result-legend")).toContainText("Demo stress");
  await expect(page.getByTestId("result-legend")).toContainText("Elemental · Unit MPa");
  await expect(page.getByTestId("result-legend")).toContainText("Range 10 – 80");

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

test("switches Results and VTK between elemental and nodal scalar fields", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  const resultField = page.getByTestId("result-field");

  await page.getByTestId("model-select").selectOption("results");
  await expect(resultField.locator("option")).toHaveText([
    "Base",
    "Demo stress · Elemental",
    "Demo temperature · Nodal",
  ]);
  await expect(resultField).toHaveValue("demo-stress");
  const elemental = await pixelMetrics(canvas);
  await resultField.selectOption("demo-temperature");
  await expect(resultField).toHaveValue("demo-temperature");
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  await expect(page.getByTestId("result-legend")).toContainText("Demo temperature");
  await expect(page.getByTestId("result-legend")).toContainText("Nodal · Unit C");
  const nodal = await pixelMetrics(canvas);
  expect(nodal.hash, "switching authored scalar location must change rendered pixels").not.toBe(
    elemental.hash,
  );

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

  const canvas = page.getByTestId("view-canvas");
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
});

test("validates signed normals and sign-invariant fibers in one shared results panel", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await waitForRenderer(page);
  await page.getByTestId("model-select").selectOption("results");
  const canvas = page.getByTestId("view-canvas");
  const vectorField = page.getByTestId("vector-field");
  await expect(page.getByTestId("result-controls")).toBeVisible();
  await expect(vectorField).toHaveValue("demo-normals");
  await expect(page.getByTestId("vector-help")).toHaveText(
    "Authored vectors are normalized for display; magnitude is not displayed",
  );
  await expect(canvas).toHaveAttribute("data-vector-field", "demo-normals");

  const normals = await pixelMetrics(canvas);
  await vectorField.selectOption("demo-fibers");
  await expect(canvas).toHaveAttribute("data-vector-field", "demo-fibers");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(null);
  const fibers = await pixelMetrics(canvas);
  expect(fibers.hash, "switching authored vector fields must change the rendered glyphs").not.toBe(
    normals.hash,
  );

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

  const beforeBase = await canvas.getAttribute("data-frames");
  await page.getByTestId("result-field").selectOption("__base__");
  await expect(canvas).toHaveAttribute("data-results", "base");
  await expect(canvas).toHaveAttribute("data-vector-field", "demo-fibers");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(beforeBase);

  await setSelectionGranularity(page, "face");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "f:", fresh: true },
    "orientation fields must retain ordinary face picking",
  );
  await page.mouse.click(hit.x, hit.y);
  await expect(page.getByTestId("inspection-panel")).toContainText("Demo fiber orientations");
  await expect(page.getByTestId("inspection-panel")).toContainText(
    "authored vector normalized for display",
  );

  await page.screenshot({ path: testInfo.outputPath("orientation-results-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("result-controls")).toBeVisible();
  await expect(vectorField).toBeVisible();
  await vectorWidth.scrollIntoViewIfNeeded();
  await vectorWidth.fill("2");
  await vectorWidth.press("Enter");
  await expect(vectorWidth).toHaveValue("2");
  await expect(vectorWidth).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("orientation-results-mobile.png") });
});

test("applies one shared section plane over complete placed-volume bounds", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("section-volume");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-model", "section-volume");
  await expect(page.getByTestId("section-axis")).toHaveValue("off");

  const baseline = await pixelMetrics(canvas);
  await page.getByTestId("section-axis").selectOption("x");
  await expect(canvas).toHaveAttribute("data-section-axis", "x");
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
  const clipped = await pixelMetrics(canvas);
  expect(clipped.hash, "moving the section plane must change rendered pixels").not.toBe(
    baseline.hash,
  );

  await page.getByTestId("viewport-toggle").click();
  await expect(page.getByTestId("secondary-view-canvas")).toHaveAttribute("data-section-axis", "x");
});

test("shows distinct scalar contours and deformation in every results state", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  await page.getByTestId("model-select").selectOption("results");
  const canvas = page.getByTestId("view-canvas");
  const resultField = page.getByTestId("result-field");
  const deformationField = page.getByTestId("deformation-field");

  let frame = await canvas.getAttribute("data-frames");
  await resultField.selectOption("__base__");
  await expect(canvas).toHaveAttribute("data-results", "base");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(frame);
  const base = await pixelMetrics(canvas);
  expect(base.distinctColors, "base must render a visible neutral mesh").toBeGreaterThan(3);

  frame = await canvas.getAttribute("data-frames");
  await resultField.selectOption("demo-stress");
  await deformationField.selectOption("__off__");
  await expect(canvas).toHaveAttribute("data-results", "colored");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(frame);
  const colored = await pixelMetrics(canvas);
  expect(
    colored.distinctColors,
    "colored results must show distinct contours",
  ).toBeGreaterThanOrEqual(4);
  expect(colored.hash, "colored results must change the canvas pixels").not.toBe(base.hash);

  frame = await canvas.getAttribute("data-frames");
  await deformationField.selectOption("demo-displacement");
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(frame);
  const deformed = await pixelMetrics(canvas);
  expect(
    deformed.distinctColors,
    "deformed results must retain distinct contours",
  ).toBeGreaterThanOrEqual(4);
  expect(deformed.hash, "deformed results must change the canvas pixels").not.toBe(colored.hash);
});

test("keeps result-strip node and face picks on original ids after deformation", async ({
  page,
}) => {
  await page.goto("/");
  await waitForRenderer(page);
  await page.getByTestId("model-select").selectOption("results");
  await setSelectionGranularity(page, "node");
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
  await expect(page.getByTestId("inspection-panel")).toContainText("Demo stress (elemental, MPa):");
  expect(await canvas.getAttribute("data-pick")).toMatch(/^n:/);

  await setSelectionGranularity(page, "face");
  const faceHit = await requireHit(
    page,
    canvas,
    { prefix: "f:", reverse: true, fresh: true },
    "the deformed results strip must resolve authored face picks",
  );
  await page.mouse.click(faceHit.x, faceHit.y);
  await expect(page.getByTestId("inspection-panel")).toContainText("Face");
  await expect(page.getByTestId("inspection-panel")).toContainText("Demo stress (elemental, MPa):");
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
  await page.getByTestId("result-field").selectOption("__base__");
  await expect(page.getByTestId("result-field")).toHaveValue("__base__");

  const menuHit = await requireHit(
    page,
    canvas,
    { fresh: true },
    "GPU picking must resolve before opening the diagnostics context menu",
  );
  await page.mouse.click(menuHit.x, menuHit.y, { button: "right" });
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
  await expect(page.getByTestId("result-field")).toHaveValue("__base__");
  await expect(instance).not.toBeChecked();
  await expect(diagnostics).toBeVisible();
  await expect.poll(() => dataset(page, "selected")).toBe(beforeFitSelection);

  await page.getByTestId("reset").click();
  await expect(page.getByTestId("projection-toggle")).toHaveText("Orthographic");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("result-field")).toHaveValue("demo-stress");
  await expect(page.getByTestId("deformation-field")).toHaveValue("demo-displacement");
  await expect(instance).toBeChecked();
  await expect(diagnostics).toBeHidden();
  await expect.poll(() => dataset(page, "selected")).toBe("");
});
