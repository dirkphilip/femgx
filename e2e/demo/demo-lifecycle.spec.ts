import { expect, test } from "@playwright/test";
import {
  activateContextAction,
  dataset,
  primaryBoxDrag,
  requireHit,
  openCommandPanel,
  scrollVisibilityToEnd,
  setSelectionGranularity,
  waitForRenderer,
} from "./demo-support";

test("draws a normalized box rectangle during a primary drag and clears it on release", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);
  const overlay = page.getByTestId("box-selection-overlay");
  await expect(overlay).toBeHidden();
  expect(await dataset(page, "selected")).toBe("");

  await primaryBoxDrag(page, canvas, { fx: 0.2, fy: 0.35 }, { fx: 0.65, fy: 0.6 });
  await page.waitForTimeout(50);
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox, "the box rectangle must be visible while the button is held").not.toBeNull();
  expect(overlayBox?.width ?? 0).toBeGreaterThan(0);
  expect(overlayBox?.height ?? 0).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await page.mouse.up({ button: "left" });
  await expect(overlay).toBeHidden();
  expect(await dataset(page, "selected")).toBe("");
});
test("cancels a box selection with Escape and never changes selection", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);
  const overlay = page.getByTestId("box-selection-overlay");

  await primaryBoxDrag(page, canvas, { fx: 0.25, fy: 0.4 }, { fx: 0.7, fy: 0.65 });
  await page.waitForTimeout(50);
  await expect(overlay).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  expect(await dataset(page, "selected")).toBe("");

  await page.mouse.up({ button: "left" });
  expect(await dataset(page, "selected")).toBe("");
  await expect(overlay).toBeHidden();
});
test("reports the active model, renderer, instances, parts, and batches", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("status")).toHaveText(
    /Bolted plate assembly · webgpu · \d+ visible · 4 parts · \d+ batches · orthographic camera/,
  );
  await expect(page.getByTestId("renderer-status")).toHaveText(/Renderer webgpu/);
  await expect(page.getByTestId("stats-panel")).toBeHidden();
});
test("defaults to the bolted plate assembly showcase", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("model-select")).toHaveValue("bolted");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("status")).toContainText("Bolted plate assembly");
  await expect(page.getByTestId("status")).toContainText("34 visible");
});
test("keeps toolbar commands bound to the deliberately active viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const primary = page.getByTestId("view-canvas");
  const secondary = page.getByTestId("secondary-view-canvas");
  const primaryPane = page.getByRole("region", { name: "Primary viewport" });
  const secondaryPane = page.getByRole("region", { name: "Secondary viewport" });
  await waitForRenderer(page, primary);

  await openCommandPanel(page, "view");
  await page.getByTestId("viewport-toggle").click();
  await waitForRenderer(page, secondary);
  await expect(secondaryPane).toHaveAttribute("data-active", "true");
  await expect(secondaryPane).toHaveCSS("outline-color", "rgb(96, 165, 250)");
  await expect(secondaryPane).toHaveCSS("outline-width", "2px");
  await expect(primaryPane).toHaveCSS("outline-width", "1px");

  const primaryBox = await primary.boundingBox();
  if (primaryBox === null) throw new Error("primary canvas has no bounding box");
  await page.mouse.move(primaryBox.x + primaryBox.width / 2, primaryBox.y + primaryBox.height / 2);
  await expect(secondaryPane).toHaveAttribute("data-active", "true");

  await page.getByTestId("background-select").selectOption("dark");
  await expect(secondary).toHaveAttribute("data-background", "dark");
  await expect(primary).toHaveAttribute("data-background", "studio");

  await page.mouse.click(primaryBox.x + primaryBox.width / 2, primaryBox.y + primaryBox.height / 2);
  await expect(primaryPane).toHaveAttribute("data-active", "true");
  await expect(primaryPane).toHaveCSS("outline-color", "rgb(96, 165, 250)");
});
test("opens isolated viewports and keeps teardown state deterministic", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const primary = page.getByTestId("view-canvas");
  const secondary = page.getByTestId("secondary-view-canvas");
  await waitForRenderer(page, primary);

  await openCommandPanel(page, "view");
  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeVisible();
  await waitForRenderer(page, secondary);
  await expect(page.getByRole("region", { name: "Primary viewport" })).toHaveAttribute(
    "data-active",
    "false",
  );
  await expect(primary).toHaveAttribute("data-selection-granularity", "element");
  await expect(secondary).toHaveAttribute("data-selection-granularity", "element");
  await page.getByTestId("background-select").selectOption("dark");
  await expect(secondary).toHaveAttribute("data-background", "dark");
  await expect(primary).toHaveAttribute("data-background", "studio");
  await page.getByRole("region", { name: "Primary viewport" }).focus();
  await page.getByTestId("background-select").selectOption("white");
  await expect(primary).toHaveAttribute("data-background", "white");
  await expect(secondary).toHaveAttribute("data-background", "dark");

  await page.getByRole("region", { name: "Secondary viewport" }).focus();
  await openCommandPanel(page, "selection");
  await page.getByTestId("selection-granularity").selectOption("node");
  await expect(page.getByTestId("selection-granularity")).toHaveValue("node");
  await expect(primary).toHaveAttribute("data-selection-granularity", "element");
  await expect(secondary).toHaveAttribute("data-selection-granularity", "node");

  await page.getByRole("region", { name: "Primary viewport" }).focus();
  await setSelectionGranularity(page, "face");
  await expect(primary).toHaveAttribute("data-selection-granularity", "face");
  await expect(secondary).toHaveAttribute("data-selection-granularity", "node");

  await page.getByRole("region", { name: "Secondary viewport" }).focus();
  const firstInstance = page.locator("input[data-instance-id]").first();
  await expect(firstInstance).toBeChecked();
  await firstInstance.uncheck();
  await expect(page.getByTestId("status")).toContainText("33 visible");
  await expect(primary).toHaveAttribute("data-visible-instances", "34");
  await expect(secondary).toHaveAttribute("data-visible-instances", "33");
  await page.getByRole("region", { name: "Primary viewport" }).focus();
  await expect(page.getByRole("region", { name: "Primary viewport" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("status")).toContainText("34 visible");

  await page.getByTestId("model-select").selectOption("results");
  await expect(primary).toHaveAttribute("data-model", "results");
  await expect(secondary).toHaveAttribute("data-model", "results");
  await expect(primary).toHaveAttribute("data-results", "deformed");
  await expect(secondary).toHaveAttribute("data-results", "deformed");
  await expect(primary).toHaveAttribute("data-selected", "");
  await expect(secondary).toHaveAttribute("data-selected", "");
  await openCommandPanel(page, "analysis");
  await page.getByTestId("result-field").selectOption("__base__");
  await expect(primary).toHaveAttribute("data-results", "base");
  await expect(secondary).toHaveAttribute("data-results", "deformed");
  await page.getByTestId("command-analysis").click();

  await openCommandPanel(page, "view");
  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeHidden();
  await expect(page.getByTestId("viewport-toggle")).toHaveText("Add viewport");
  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeVisible();
  await expect(page.locator('[data-femgx-orientation-gizmo="true"]')).toHaveCount(2);
  await expect(secondary).toHaveAttribute("data-results", "base");
});
test("shows diagnostics from target and empty-scene context menus", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const diagnostics = page.getByTestId("stats-panel");
  await expect(diagnostics).toBeHidden();

  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve before opening the target diagnostics menu",
  );
  await page.mouse.click(hit.x, hit.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Show diagnostics")).toBeVisible();
  await menu.getByText("Show diagnostics").click();

  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.locator("h2")).toHaveText("Diagnostics");
  await expect(diagnostics).toContainText("Visible instances");
  const panelBox = await diagnostics.boundingBox();
  const sceneBox = await page.locator(".scene").boundingBox();
  const toolbarBox = await page.locator(".toolbar").boundingBox();
  expect(panelBox).not.toBeNull();
  expect(sceneBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  if (panelBox === null || sceneBox === null || toolbarBox === null) {
    throw new Error("diagnostics layout has no measurable bounds");
  }
  expect(panelBox.x).toBeGreaterThanOrEqual(sceneBox.x);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width);
  expect(panelBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);

  const beforeVisibility = await diagnostics.textContent();
  const partCheckbox = page
    .getByTestId("visibility-panel")
    .locator("input[data-instance-id]")
    .first();
  await partCheckbox.uncheck();
  await expect.poll(() => diagnostics.textContent()).not.toBe(beforeVisibility);

  const canvasBox = await canvas.boundingBox();
  if (canvasBox === null) throw new Error("canvas has no bounding box");
  await page.mouse.click(
    Math.round(canvasBox.x + canvasBox.width - 12),
    Math.round(canvasBox.y + canvasBox.height - 12),
    { button: "right" },
  );
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Hide diagnostics")).toBeVisible();
  await menu.getByText("Hide diagnostics").click();
  await expect(diagnostics).toBeHidden();

  await activateContextAction(page, "reset");
  await page.mouse.click(
    Math.round(canvasBox.x + canvasBox.width - 12),
    Math.round(canvasBox.y + canvasBox.height - 12),
    { button: "right" },
  );
  await expect(menu.getByText("Show diagnostics")).toBeVisible();
});
test("shows an accessible interactive view cube", async ({ page }) => {
  await page.goto("/");
  const gizmo = page.locator('[data-femgx-orientation-gizmo="true"]');
  await expect(gizmo).toBeVisible();
  await expect(gizmo).toHaveAttribute("role", "group");
  await expect(gizmo.locator("[data-view-face]")).toHaveCount(6);
  await expect(gizmo.locator("[data-view-corner]")).toHaveCount(8);
  await expect(gizmo.locator("[data-rotate]")).toHaveCount(6);
  await expect(gizmo.locator("circle")).toHaveCount(9);
  await expect(gizmo.locator("text")).toHaveCount(9);
  await expect(gizmo).toContainText("XY");
  await expect(gizmo).toContainText("YZ");
  await expect(gizmo).toContainText("XZ");
  await expect(gizmo.locator("[data-view-axis-triad]")).toHaveAttribute("aria-hidden", "true");
  await expect(gizmo.locator('[data-view-face="right"]')).toHaveAttribute(
    "aria-label",
    "View Right · YZ plane (+X)",
  );
});
test("updates existing view-cube nodes after camera movement", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const front = page.locator('[data-femgx-orientation-gizmo="true"] [data-view-face="front"]');
  await waitForRenderer(page, canvas);
  const before = await front.locator("polygon").getAttribute("points");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down({ button: "middle" });
  await expect(canvas).toHaveAttribute("data-dragging", "true");
  await page.waitForTimeout(100);
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.42);
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => front.locator("polygon").getAttribute("points")).not.toBe(before);
});
test("lists the bolted assembly hierarchy in the visibility panel", async ({ page }) => {
  await page.goto("/");
  const visibility = page.getByTestId("visibility-panel");
  for (const name of [
    "Bolted joint",
    "Plate stack",
    "Steel plates",
    "Plate row A",
    "Plate row B",
  ]) {
    await expect(visibility).toContainText(name);
  }
  await scrollVisibilityToEnd(page);
  await expect(visibility).toContainText("Fasteners");
});
test("renders the helper and mapping examples in the gallery grid", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-select").selectOption("gallery");
  await expect(canvas).toHaveAttribute("data-model", "gallery");
  await expect(page.getByTestId("status")).toContainText("15 visible");
});
test("switches between deterministic model presets", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await openCommandPanel(page, "display");
  await expect(select).toHaveValue("bolted");
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  for (const id of ["gallery", "hex20-cylinder", "results", "transparency", "bolted"]) {
    await page.getByTestId("edge-overlay").click();
    await page.getByTestId("node-overlay").click();
    await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "false");
    await select.selectOption(id);
    await expect(canvas).toHaveAttribute("data-model", id);
    await expect(canvas).toHaveAttribute("data-edges", "true");
    await expect(canvas).toHaveAttribute("data-nodes", "true");
    await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute(
      "data-results",
      id === "results" || id === "hex20-cylinder" ? "deformed" : "base",
    );
  }
});
