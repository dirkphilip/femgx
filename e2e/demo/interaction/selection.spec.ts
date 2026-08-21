import { expect, test, type Locator } from "@playwright/test";
import { canvasInteractionBox } from "../../browser-support/browser";
import {
  dataset,
  loadWebGpuPage,
  openCommandPanel,
  primaryBoxDrag,
  requireHit,
  setSelectionGranularity,
} from "../demo-support";

interface BoxFraction {
  readonly fx: number;
  readonly fy: number;
}

async function visibleRegionKeys(
  canvas: Locator,
  start: BoxFraction,
  end: BoxFraction,
): Promise<string[]> {
  const canvasBounds = await canvas.boundingBox();
  if (canvasBounds === null) throw new Error("canvas has no region-query bounds");
  const box = await canvasInteractionBox(canvas);
  const startX = Math.round(box.x + start.fx * box.width) - canvasBounds.x;
  const endX = Math.round(box.x + end.fx * box.width) - canvasBounds.x;
  const startY = Math.round(box.y + start.fy * box.height) - canvasBounds.y;
  const endY = Math.round(box.y + end.fy * box.height) - canvasBounds.y;
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  return canvas.evaluate(
    async (_element, rect) => {
      const targets = await (
        window as typeof window & {
          femgxDemo?: {
            pickRegionKeys?: (
              rect: {
                readonly left: number;
                readonly top: number;
                readonly right: number;
                readonly bottom: number;
                readonly width: number;
                readonly height: number;
              },
              granularity: string,
            ) => Promise<readonly string[]>;
          };
        }
      ).femgxDemo?.pickRegionKeys?.(rect, "element");
      return [...(targets ?? [])].sort();
    },
    { left, top, right, bottom, width: right - left, height: bottom - top },
  );
}

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

test("selects authored bodies through the selection granularity", async ({ page }) => {
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
});

test("keeps repeated partial, empty, and Control-append box selections complete", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await openCommandPanel(page, "selection");
  await page.getByTestId("box-selection-strategy").selectOption("visible-surface");
  const drag = async (
    start: BoxFraction,
    end: BoxFraction,
    expected: readonly string[],
    control = false,
  ): Promise<void> => {
    if (control) await page.keyboard.down("Control");
    await primaryBoxDrag(page, canvas, start, end);
    await page.mouse.up({ button: "left" });
    if (control) await page.keyboard.up("Control");
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error("canvas has no box-selection bounds");
    await page.mouse.move(
      Math.round(bounds.x + end.fx * bounds.width + 1),
      Math.round(bounds.y + end.fy * bounds.height + 1),
    );
    await expect
      .poll(async () => (await dataset(page, "selected")).split(",").filter(Boolean).sort())
      .toEqual(expected);
  };

  const left = [
    { fx: 0.12, fy: 0.2 },
    { fx: 0.52, fy: 0.82 },
  ] as const;
  const right = [
    { fx: 0.48, fy: 0.2 },
    { fx: 0.88, fy: 0.82 },
  ] as const;
  const expectedLeft = await visibleRegionKeys(canvas, left[0], left[1]);
  const expectedFull = await visibleRegionKeys(
    canvas,
    { fx: 0.08, fy: 0.15 },
    { fx: 0.92, fy: 0.88 },
  );
  expect(expectedLeft.length).toBeGreaterThan(1);
  expect(expectedLeft.length).toBeLessThan(expectedFull.length);
  expect(expectedLeft.some((key) => key.startsWith("e:1/1:"))).toBe(true);
  expect(expectedLeft.some((key) => key.startsWith("e:1/2:"))).toBe(true);

  const clickHit = await requireHit(
    page,
    canvas,
    { fresh: true },
    "hover must retain the exact GPU hit used by inspection",
  );
  const clickedTarget = await dataset(page, "hovered");
  expect(clickedTarget).toMatch(/^e:/);
  await expect(page.getByTestId("inspection-panel")).not.toContainText(
    "Click or right-click a visible element",
  );

  await drag(left[0], left[1], expectedLeft);
  await expect(canvas).toHaveAttribute("data-hovered", "");
  await expect(canvas).toHaveAttribute("data-pick", "");

  await page.mouse.move(clickHit.x, clickHit.y);
  await expect.poll(() => dataset(page, "hovered")).toMatch(/^e:/);
  await expect
    .poll(async () => (await dataset(page, "selected")).split(",").filter(Boolean).sort())
    .toEqual(expectedLeft);

  await page.mouse.click(clickHit.x, clickHit.y);
  await expect.poll(() => dataset(page, "selected")).toBe(clickedTarget);

  const empty = [
    { fx: 0.88, fy: 0.12 },
    { fx: 0.98, fy: 0.2 },
  ] as const;
  expect(await visibleRegionKeys(canvas, empty[0], empty[1])).toEqual([]);
  await drag(empty[0], empty[1], []);

  const repeatedLeft = await visibleRegionKeys(canvas, left[1], left[0]);
  await drag(left[1], left[0], repeatedLeft);
  const appendedRight = await visibleRegionKeys(canvas, right[0], right[1]);
  await drag(right[0], right[1], [...new Set([...repeatedLeft, ...appendedRight])].sort(), true);
});

test("keeps the Through box strategy truthful across selection granularities", async ({ page }) => {
  await loadWebGpuPage(page);
  await openCommandPanel(page, "selection");
  const canvas = page.getByTestId("view-canvas");
  const strategy = page.getByTestId("box-selection-strategy");
  await expect(strategy).toHaveValue("through-intersection");
  await expect(canvas).toHaveAttribute("data-box-selection-strategy", "through-intersection");

  await strategy.selectOption("visible-surface");
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
