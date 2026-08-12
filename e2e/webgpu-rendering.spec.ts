/** rendering ownership: GPU pixels, overlays, and visual contracts. */

import { expect, test } from "@playwright/test";
import {
  sweepForHit,
  stableCanvasPixels,
  canvasRgba,
  differingPixelCount,
  visiblePixelCount,
  yellowComponents,
  hasYellowPixel,
  selectedLuminanceSpread,
  nodeContribution,
  clearHover,
  dragCamera,
  toggleElementHighlight,
  rendererMode,
  loadWebGpuPage,
} from "./webgpu-support";

test("keeps selection feedback visible in edge overlay mode", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }

  // Sweep until GPU pick resolves any target; the selected key encodes its
  // granularity as a prefix (n:/f:/e:/i:/p:).
  const hoverPoint = await sweepForHit(page, canvas, {
    attribute: "hovered",
    settleMs: 150,
    fresh: true,
  });

  if (hoverPoint === undefined) {
    test.skip(true, "picking is not functional in this browser environment");
    return;
  }

  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).not.toBe("");
  const selected = (await canvas.getAttribute("data-selected")) ?? "";

  // Edge overlay keeps the emphasis: the label flips and the demo still renders
  // the selected key in the next frame.
  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBeNull();
  expect(await canvas.getAttribute("data-selected")).toBe(selected);

  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  expect(await canvas.getAttribute("data-selected")).toBe(selected);
});

test("element emphasis changes the rendered pixels and toggles off again", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  await expect.poll(() => canvas.getAttribute("data-frames"), { timeout: 10_000 }).not.toBeNull();

  // Baseline: no interaction, so the canvas holds only the deterministic model.
  const baseline = await stableCanvasPixels(page, canvas);

  const hoverPoint = await sweepForHit(page, canvas, {
    attribute: "hovered",
    settleMs: 150,
    fresh: true,
  });
  if (hoverPoint === undefined) {
    test.skip(true, "picking is not functional in this browser environment");
    return;
  }

  // Emphasize the element under the pointer, then clear the hover so the
  // pixel comparison isolates the emphasis. If element emphasis ever renders
  // invisibly again (a WGSL/CPU record-layout desync like #69), the settled
  // pixels never differ from the baseline and this assertion fails.
  await toggleElementHighlight(page, hoverPoint);
  await clearHover(page, canvas);
  const emphasized = await stableCanvasPixels(page, canvas);
  expect(
    emphasized.equals(baseline),
    "element emphasis must render as visibly different pixels",
  ).toBe(false);

  // Toggling the emphasis off must visibly remove the emphasized frame.
  await toggleElementHighlight(page, hoverPoint);
  await clearHover(page, canvas);
  const restored = await stableCanvasPixels(page, canvas);
  expect(
    restored.equals(emphasized),
    "clearing the emphasis must change the emphasized frame",
  ).toBe(false);
});

test("renders element nodes as a separate visible annotation pass", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("gallery");

  const canvas = page.getByTestId("view-canvas");
  const withNodes = await stableCanvasPixels(page, canvas);
  const nodeToggle = page.getByTestId("node-overlay");
  await nodeToggle.click();
  await expect(nodeToggle).toHaveAttribute("aria-pressed", "false");
  const withoutNodes = await stableCanvasPixels(page, canvas);
  expect(withoutNodes.equals(withNodes), "node glyphs must change the rendered pixels").toBe(false);
  const withNodesRgba = await canvasRgba(page, canvas);
  expect(
    visiblePixelCount(withNodesRgba),
    "the node pass must preserve the resolved surface instead of presenting black",
  ).toBeGreaterThan(withNodesRgba.length / 16);

  await nodeToggle.click();
  await expect(nodeToggle).toHaveAttribute("aria-pressed", "true");
  const restored = await stableCanvasPixels(page, canvas);
  expect(restored.equals(withoutNodes), "showing node glyphs must change the plain frame").toBe(
    false,
  );
});

test("renders complete point sprites with authored node picks", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("gallery");
  await page.getByTestId("node-overlay").click();
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "false");

  const pointVisibility = page.locator("input[data-instance-id]");
  await expect(pointVisibility).toHaveCount(10);
  for (let index = 1; index < 10; index += 1) await pointVisibility.nth(index).uncheck();
  await page.getByTestId("fit-view").click();

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const withoutNodeOverlay = await stableCanvasPixels(page, canvas);
  await page.getByTestId("node-overlay").click();
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
  const withNodeOverlay = await stableCanvasPixels(page, canvas);
  expect(
    withNodeOverlay.equals(withoutNodeOverlay),
    "Point parts must not receive a duplicate node annotation overlay",
  ).toBe(true);
  const rgba = await canvasRgba(page, canvas);
  const width = Math.round(box.width);
  const components = yellowComponents(rgba, width);
  expect(components.length, "gallery point elements must produce separate glyphs").toBeGreaterThan(
    4,
  );
  for (const [index, bounds] of components.entries()) {
    const centerX = Math.round((bounds.minX + bounds.maxX) / 2);
    const centerY = Math.round((bounds.minY + bounds.maxY) / 2);
    expect(
      bounds.maxX - bounds.minX,
      `point ${index} must have horizontal coverage`,
    ).toBeGreaterThan(5);
    expect(bounds.maxY - bounds.minY, `point ${index} must have vertical coverage`).toBeGreaterThan(
      5,
    );
    for (const [label, x, y] of [
      ["left", bounds.minX + 2, centerY],
      ["right", bounds.maxX - 2, centerY],
      ["top", centerX, bounds.minY + 2],
      ["bottom", centerX, bounds.maxY - 2],
    ] as const) {
      expect(
        hasYellowPixel(rgba, width, x, y),
        `point ${index} must cover its ${label} cardinal`,
      ).toBe(true);
    }
  }

  const firstPoint = components[0];
  if (firstPoint === undefined) throw new Error("point sprite coverage has no first glyph");
  await canvas.evaluate((node) => {
    (node as HTMLElement).dataset["hovered"] = "";
  });
  await page.mouse.move(
    box.x + (firstPoint.minX + firstPoint.maxX) / 2,
    box.y + (firstPoint.minY + firstPoint.maxY) / 2,
  );
  await expect.poll(() => canvas.getAttribute("data-hovered"), { timeout: 2_000 }).toMatch(/^n:/);
});

test("composes the transparency fixture and picks its nearest translucent face", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("transparency");

  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-model", "transparency");
  const frame = await stableCanvasPixels(page, canvas);
  const rgba = await canvasRgba(page, canvas);
  expect(
    visiblePixelCount(rgba),
    "the transparency composite must preserve visible geometry",
  ).toBeGreaterThan(rgba.length / 16);
  expect(frame.equals(await stableCanvasPixels(page, canvas))).toBe(true);

  const hit = await sweepForHit(page, canvas, { prefix: "f:", attribute: "hovered", fresh: true });
  expect(hit, "the nearest translucent shell face must remain pickable").not.toBeUndefined();
  expect(hit?.key).toMatch(/^f:31\/1:/);
  await page.mouse.click(hit?.x ?? 0, hit?.y ?? 0);
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe(hit?.key);
});

test("removes zero-alpha shell overlays without removing their picks", async ({ page }) => {
  await loadWebGpuPage(page, "/?testAlphaZero");
  await page.getByTestId("model-select").selectOption("transparency");

  const canvas = page.getByTestId("view-canvas");
  const instanceVisibility = page.locator("input[data-instance-id]");
  await expect(instanceVisibility).toHaveCount(4);

  // The transparency fixture orders its opaque interior first, followed by
  // the shell and the two overlapping zero-alpha placements. Hiding the
  // latter gives a pixel baseline for the interior's own overlays.
  for (const index of [1, 2, 3]) await instanceVisibility.nth(index).uncheck();
  const interiorOnly = await stableCanvasPixels(page, canvas);

  for (const index of [1, 2, 3]) await instanceVisibility.nth(index).check();
  const alphaZeroFrame = await stableCanvasPixels(page, canvas);
  expect(
    alphaZeroFrame.equals(interiorOnly),
    "zero-alpha shell and overlap parts must add no edge or node pixels",
  ).toBe(true);

  const hit = await sweepForHit(page, canvas, { prefix: "f:", attribute: "hovered", fresh: true });
  expect(hit, "zero-alpha shell geometry must remain pickable").not.toBeUndefined();
  expect(hit?.key).toMatch(/^f:31\/1:/);
});

test("keeps element edges and nodes visible after orbiting", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  for (const delta of [
    { x: 90, y: 35 },
    { x: -150, y: 55 },
  ]) {
    await dragCamera(page, canvas, delta);
    const withNodes = await stableCanvasPixels(page, canvas);
    await page.getByTestId("node-overlay").click();
    const withoutNodes = await stableCanvasPixels(page, canvas);
    expect(withoutNodes.equals(withNodes), "nodes must remain visible after orbiting").toBe(false);
    await page.getByTestId("node-overlay").click();
  }
});

test("keeps depth-tested node annotations stable across fine zoom steps", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption({ label: "Supported element gallery" });
  // Hide the gallery's hardware point/line overlays so the measured delta is
  // only the depth-tested node annotation pass.
  await page.getByTestId("instance-vis-0").uncheck();
  await page.getByTestId("instance-vis-1").uncheck();
  await page.getByTestId("fit-view").click();

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  const contributions: number[] = [];
  for (let step = 0; step < 8; step++) {
    contributions.push(await nodeContribution(page));
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(50);
  }

  const baseline = contributions[0];
  expect(contributions.length).toBeGreaterThan(0);
  expect(baseline).toBeGreaterThan(40);
  if (baseline === undefined) return;

  for (const [index, count] of contributions.entries()) {
    expect(count, `node contribution must stay visible at zoom step ${index}`).toBeGreaterThan(40);
    expect(
      count,
      `node contribution must not collapse across zoom (step ${index}: ${String(count)} vs ${String(baseline)})`,
    ).toBeGreaterThan(baseline * 0.05);
    expect(
      count,
      `node contribution must not explode from flicker/leakage (step ${index}: ${String(count)} vs ${String(baseline)})`,
    ).toBeLessThan(baseline * 12);
  }
});

test("keeps depth-tested edges behind the single edges control", async ({ page }) => {
  await loadWebGpuPage(page);

  await expect(page.getByTestId("renderer-status")).toContainText("Renderer webgpu");
  await expect(page.getByTestId("depth-test")).toHaveCount(0);
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
});

test("keeps the solid frame deterministic across page loads", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const first = await stableCanvasPixels(page, canvas);

  await page.reload();
  await expect.poll(() => rendererMode(page)).toBe("webgpu");
  const second = await stableCanvasPixels(page, canvas);

  expect(first.equals(second), "base pixel output must be deterministic").toBe(true);
});

test("renders a distinct edge-overlay frame", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const solid = await stableCanvasPixels(page, canvas);

  await page.getByTestId("edge-overlay").click();
  const edge = await stableCanvasPixels(page, canvas);

  expect(edge.equals(solid), "edge mode must render different pixels than solid").toBe(false);
});

test("keeps selected volume faces lit, distinct, and reversible with overlays", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-select").selectOption("results");
  await expect(canvas).toHaveAttribute("data-model", "results");
  await page.getByTestId("results-toggle").click();
  await expect(page.getByTestId("results-toggle")).toHaveText("Results: Base");
  await dragCamera(page, canvas, { x: 64, y: 24 });
  const hoverPoint = await sweepForHit(page, canvas, {
    attribute: "hovered",
    settleMs: 150,
    fresh: true,
  });
  if (hoverPoint === undefined) {
    test.skip(true, "picking is not functional in this browser environment");
    return;
  }

  await clearHover(page, canvas);
  const before = await stableCanvasPixels(page, canvas);
  const baselineRgba = await canvasRgba(page, canvas);
  await page.keyboard.down("Shift");
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);
  await clearHover(page, canvas);
  const selected = await stableCanvasPixels(page, canvas);
  const selectedRgba = await canvasRgba(page, canvas);

  expect(selected.equals(before), "selecting an instance must change the rendered pixels").toBe(
    false,
  );
  expect(
    (await stableCanvasPixels(page, canvas)).equals(selected),
    "the selected state must render deterministically",
  ).toBe(true);
  expect(
    selectedLuminanceSpread(baselineRgba, selectedRgba),
    "differently oriented selected volume faces must retain useful lighting contrast",
  ).toBeGreaterThan(18);

  await page.keyboard.down("Shift");
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe("");
  await clearHover(page, canvas);
  expect(
    (await stableCanvasPixels(page, canvas)).equals(before),
    "deselection must restore the ordinary surface appearance",
  ).toBe(true);

  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
  const overlaid = await stableCanvasPixels(page, canvas);
  await page.keyboard.down("Shift");
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);
  await clearHover(page, canvas);
  const selectedOverlaid = await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(overlaid, selectedOverlaid),
    "selected volume must remain clear when edges and nodes are enabled",
  ).toBeGreaterThan(200);
});
