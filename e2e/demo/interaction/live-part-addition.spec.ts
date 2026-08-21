import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { drawnPixels, requireHit } from "../../browser-support/helpers";
import { emptyCanvasPoint, loadWebGpuPage } from "../demo-support";
import { PHONE } from "../mobile/support";

test("adds one reusable mesh then instances its shared part through the context menu", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const empty = await emptyCanvasPoint(page, canvas);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await menu.getByTestId("context-action-add-mesh").click();
  const dialog = page.getByTestId("live-part-dialog");
  await expect(dialog).toBeVisible();
  await capture(page, testInfo, "live-part-addition-desktop-dialog.png");
  await dialog.getByTestId("live-part-copies").fill("4");
  await dialog.getByTestId("live-part-apply").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("status")).toContainText("17 parts");
  await expect(page.getByTestId("model-feedback")).toContainText("Added 4 placements of Part 17");
  await expect(page.getByTestId("model-feedback")).toContainText("20 occurrences total");
  await canvas.focus();
  await page.keyboard.press("z");
  await expect.poll(async () => drawnPixels(canvas)).toBe(true);

  const hit = await requireHit(
    page,
    canvas,
    { attribute: "hovered", fresh: true, prefix: "e:1/live-17-1" },
    "the generated Part 17 occurrence live-17-1 must be pickable",
  );
  await expect(canvas).toHaveAttribute("data-hovered", hit.key);
  await capture(page, testInfo, "live-part-addition-desktop-grid.png");
  await page.keyboard.down("Alt");
  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await page.keyboard.up("Alt");
  await menu.getByTestId("context-action-instance-part").click();
  await expect(dialog).toContainText("Instance this part");
  await expect(dialog).toContainText("Part 17 · Live Hex8 box");
  await dialog.getByTestId("live-part-copies").fill("3");
  await dialog.getByTestId("live-part-apply").click();
  await expect(page.getByTestId("status")).toContainText("17 parts");
  await expect(page.getByTestId("model-feedback")).toContainText(
    "Instanced 3 placements of Part 17",
  );
  await expect(page.getByTestId("model-feedback")).toContainText("23 occurrences total");
});

test("keeps the live part dialog inside the phone workbench", async ({ page }, testInfo) => {
  await page.setViewportSize(PHONE);
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const empty = await emptyCanvasPoint(page, canvas);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await page.getByTestId("context-action-add-mesh").click();
  const box = await page.getByTestId("live-part-dialog").boundingBox();
  if (box === null) throw new Error("live part dialog has no bounds");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  await capture(page, testInfo, "live-part-addition-mobile-dialog.png");
});

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}
