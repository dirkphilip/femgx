import { expect, test } from "@playwright/test";
import { drawnPixels, requireHit } from "../../browser-support/helpers";
import { emptyCanvasPoint, loadWebGpuPage } from "../demo-support";
import { PHONE } from "../mobile/support";

test("adds one reusable mesh then instances its shared part through the context menu", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const empty = await emptyCanvasPoint(page, canvas);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await menu.getByTestId("context-action-add-mesh").click();
  const dialog = page.getByTestId("live-part-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("live-part-copies").fill("2");
  await dialog.getByTestId("live-part-apply").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("status")).toContainText("17 parts");
  await canvas.focus();
  await page.keyboard.press("z");
  await expect.poll(async () => drawnPixels(canvas)).toBe(true);

  const hit = await requireHit(page, canvas, {}, "the added occurrence must be pickable");
  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await menu.getByTestId("context-action-instance-part").click();
  await expect(dialog).toContainText("Instance this part");
  await dialog.getByTestId("live-part-copies").fill("3");
  await dialog.getByTestId("live-part-apply").click();
  await expect(page.getByTestId("status")).toContainText("17 parts");
});

test("keeps the live part dialog inside the phone workbench", async ({ page }) => {
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
});
