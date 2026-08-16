import { expect, test } from "@playwright/test";
import {
  dataset,
  loadWebGpuPage,
  openCommandPanel,
  primaryBoxDrag,
  requireHit,
  setSelectionGranularity,
} from "./demo-support";
test("toggles the edge overlay", async ({ page }) => {
  await loadWebGpuPage(page);
  await openCommandPanel(page, "display");
  const overlay = page.getByTestId("edge-overlay");
  await expect(overlay).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("edge-overlay").click();
  await expect(overlay).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("edge-overlay").click();
  await expect(overlay).toHaveAttribute("aria-pressed", "true");
});

test("defaults to element selection and can switch to exact node picks", async ({ page }) => {
  await loadWebGpuPage(page);
  const select = page.getByTestId("selection-granularity");
  await expect(select).toHaveAttribute("aria-label", "Selection granularity");
  await expect(select).toHaveValue("element");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute(
    "data-selection-granularity",
    "element",
  );

  await setSelectionGranularity(page, "node");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute(
    "data-selection-granularity",
    "node",
  );
});

test("selects authored bodies and blocks through the selection granularity", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const selection = page.getByTestId("selection-granularity");
  await openCommandPanel(page, "selection");

  await selection.selectOption("body");
  await expect(selection).toHaveValue("body");
  await expect(page.getByTestId("box-selection-strategy")).toHaveValue("visible-surface");
  const bodyHit = await requireHit(
    page,
    canvas,
    { prefix: "f:" },
    "body GPU picking must resolve from authored element metadata",
  );
  await page.mouse.click(bodyHit.x, bodyHit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^body:/);

  await openCommandPanel(page, "selection");
  await page.getByTestId("clear-selection").click();
  await primaryBoxDrag(page, canvas, { fx: 0.15, fy: 0.25 }, { fx: 0.85, fy: 0.8 });
  await page.mouse.up({ button: "left" });
  await expect.poll(() => dataset(page, "selected")).toMatch(/^body:/);

  await openCommandPanel(page, "selection");
  await selection.selectOption("block");
  await expect(selection).toHaveValue("block");
  await page.getByTestId("clear-selection").click();
  const blockHit = await requireHit(
    page,
    canvas,
    { prefix: "f:", fresh: true, step: 24 },
    "block GPU picking must resolve from authored element metadata",
  );
  await page.mouse.click(blockHit.x, blockHit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^b:/);
});

test("keeps the Through box strategy truthful across selection granularities", async ({ page }) => {
  await loadWebGpuPage(page);
  await openCommandPanel(page, "selection");
  const canvas = page.getByTestId("view-canvas");
  const strategy = page.getByTestId("box-selection-strategy");
  await expect(strategy).toHaveValue("visible-surface");
  await expect(canvas).toHaveAttribute("data-box-selection-strategy", "visible-surface");

  await strategy.selectOption("through-intersection");
  await expect(strategy).toHaveValue("through-intersection");
  await expect(canvas).toHaveAttribute("data-box-selection-strategy", "through-intersection");

  await setSelectionGranularity(page, "face");
  await expect(strategy).toHaveValue("visible-surface");
  await expect(strategy.locator('option[value="through-intersection"]')).toBeDisabled();
  await expect(canvas).toHaveAttribute("data-box-selection-strategy", "visible-surface");
});

test("selects and deselects the owning element from a node context menu", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );
  const menu = page.getByTestId("context-menu");

  expect(await dataset(page, "selected")).toBe("");
  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await expect(menu).toBeVisible();
  expect(await dataset(page, "selected")).toBe("");
  await expect(menu.locator('button[data-action="select-element"]')).toHaveText("Select element");
  await expect(menu.locator('button[data-action="select"]')).toHaveText("Select node");
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await expect(menu.locator('button[data-action="select-element"]')).toHaveText("Deselect element");
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toBe("");
});

test("promotes face and element context targets to the exact element", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const menu = page.getByTestId("context-menu");
  const faceHit = await requireHit(
    page,
    canvas,
    { prefix: "f:", fresh: true },
    "face GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(faceHit.x, faceHit.y, { button: "right" });
  await expect(menu.locator(".menu-title").first()).toHaveText(/^Face /);
  await expect(menu.locator('button[data-action="select-element"]')).toHaveText("Select element");
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);

  await page.mouse.click(faceHit.x, faceHit.y, { button: "right" });
  await expect(menu.locator('button[data-action="select-element"]')).toHaveText("Deselect element");
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toBe("");

  const nodeHit = await requireHit(
    page,
    canvas,
    { prefix: "n:", fresh: true },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );
  await page.keyboard.down("Shift");
  await page.mouse.click(nodeHit.x, nodeHit.y, { button: "right" });
  await page.keyboard.up("Shift");
  await expect(menu.locator(".menu-title").first()).toHaveText(/^Element /);
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);
});

test("selects an authored block from an element context menu", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const menu = page.getByTestId("context-menu");
  const candidates = [
    { prefix: "f:", fresh: true },
    { prefix: "f:", fresh: true, reverse: true },
    { prefix: "f:", fresh: true, step: 24 },
  ] as const;
  let blockHit: { readonly x: number; readonly y: number } | undefined;
  for (const options of candidates) {
    const hit = await requireHit(
      page,
      canvas,
      options,
      "element GPU picking must resolve before selecting an authored block",
    );
    await page.mouse.click(hit.x, hit.y, { button: "right" });
    await expect(menu).toBeVisible();
    if ((await menu.locator('button[data-action="select-block"]').count()) > 0) {
      blockHit = hit;
      break;
    }
    await page.keyboard.press("Escape");
  }
  if (blockHit === undefined)
    throw new Error("Could not resolve a plate element with authored block metadata");

  await expect(menu.locator('button[data-action="select-block"]')).toHaveText("Select block");
  await menu.locator('button[data-action="select-block"]').click();
  await expect.poll(() => dataset(page, "selected")).toMatch(/^b:/);
  const [, instanceId, blockId] = (await dataset(page, "selected")).split(":");
  if (instanceId === undefined || blockId === undefined)
    throw new Error("block selection is malformed");

  const visibilityPanel = page.getByTestId("visibility-panel");
  await visibilityPanel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  const block = page.locator(
    `input[data-block-instance-id="${instanceId}"][data-block-id="${blockId}"]`,
  );
  await expect(block).toBeVisible();
  await block.uncheck();
  await expect(block).not.toBeChecked();
  await expect.poll(() => dataset(page, "selected")).toBe(`b:${instanceId}:${blockId}`);
  void blockHit;
});
test("picks and selects a node, exposing adjacency and neighbors", async ({ page }) => {
  await loadWebGpuPage(page);
  await setSelectionGranularity(page, "node");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^n:/);
  const hideSelected = page.getByTestId("hide-selected");
  await expect(hideSelected).toBeDisabled();
  await expect(hideSelected).toHaveAttribute(
    "title",
    "Select one or more visible elements to hide.",
  );
  await expect(page.getByTestId("inspection-panel")).toContainText("Adjacent elements");
  await expect(page.getByTestId("inspection-panel")).toContainText("Neighbors");
});
test("picks and selects a face, exposing its normal and ownership", async ({ page }) => {
  await loadWebGpuPage(page);
  await setSelectionGranularity(page, "face");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "f:" },
    "face GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^f:/);
  await expect(page.getByTestId("inspection-panel")).toContainText("Normal");
  await expect(page.getByTestId("inspection-panel")).toContainText("Adjacent elements");
});

test("picks and selects an authored edge without requiring the wireframe overlay", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  await setSelectionGranularity(page, "edge");
  await openCommandPanel(page, "display");
  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "ed:" },
    "authored edge GPU picking must remain available with the overlay disabled",
  );

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toBe(hit.key);
  await expect(page.getByTestId("inspection-panel")).toContainText("Authored nodes");
  await expect(page.getByTestId("inspection-panel")).toContainText("Incident elements");
  await expect(page.getByTestId("interaction-help")).toContainText("Edge selects authored");
});
