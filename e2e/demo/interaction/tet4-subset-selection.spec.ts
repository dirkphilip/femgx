import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import {
  dataset,
  drawnPixels,
  loadWebGpuPage,
  openCommandPanel,
  pixelHash,
  requireHit,
  setSelectionGranularity,
} from "../demo-support";

const enabled = process.env["FEMGX_TET4_BOUNDARY_EVIDENCE"] === "1";

test.skip(!enabled, "dense Tet4 boundary evidence is an opt-in hardware-WebGPU lane");

for (const cells of [47, 48, 50] as const) {
  test(`keeps ${cells}-cell Tet4 element and face selection subset-resident`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loadWebGpuPage(page);
    const canvas = page.getByTestId("view-canvas");
    await page.getByTestId("performance-lab").click();
    await page.getByTestId("tet4-cells").fill(String(cells));
    await page.getByTestId("mesh-tet4").click();
    await expect(canvas).toHaveAttribute("data-model", `fe-tet4-dense-${cells}`, {
      timeout: 120_000,
    });
    await expect.poll(() => drawnPixels(canvas)).toBe(true);
    const element = await exerciseSelection(page, canvas, "element");
    const beforeOrbit = await pixelHash(canvas);
    await orbitSelectionBehind(page, canvas);
    await expect.poll(() => dataset(page, "selected")).toBe(element);
    await expect.poll(() => pixelHash(canvas)).not.toBe(beforeOrbit);
    await capture(page, testInfo, `tet4-${cells}-desktop-element-hidden.png`);

    await openCommandPanel(page, "selection");
    await page.getByTestId("clear-selection").click();
    await exerciseSelection(page, canvas, "face");
    await capture(page, testInfo, `tet4-${cells}-desktop-face-selected.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => drawnPixels(canvas)).toBe(true);
    await capture(page, testInfo, `tet4-${cells}-mobile-face-selected.png`);
  });
}

async function exerciseSelection(
  page: Page,
  canvas: Locator,
  granularity: "element" | "face",
): Promise<string> {
  await setSelectionGranularity(page, granularity);
  const prefix = granularity === "element" ? "e:" : "f:";
  const hit = await requireHit(
    page,
    canvas,
    { prefix, attribute: "hovered", fresh: true },
    `${granularity} hover must resolve on dense Tet4 geometry`,
  );
  await expect.poll(() => dataset(page, "hovered")).toBe(hit.key);
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toBe(hit.key);
  await openCommandPanel(page, "selection");
  await page.getByTestId("clear-selection").click();
  await expect.poll(() => dataset(page, "selected")).toBe("");
  await page.mouse.move(hit.x, hit.y);
  await expect.poll(() => dataset(page, "hovered")).toBe(hit.key);
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toBe(hit.key);
  return hit.key;
}

async function orbitSelectionBehind(page: Page, canvas: Locator): Promise<void> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("dense Tet4 canvas has no bounds");
  const camera = await canvas.getAttribute("data-camera");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(camera);
  await page.mouse.move(1, 1);
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
}
