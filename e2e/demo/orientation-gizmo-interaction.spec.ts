import { expect, test } from "@playwright/test";
import { waitForRenderer } from "./demo-support";

test("keeps face clicks out of the canvas and snaps the camera", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);

  const gizmo = page.locator('[data-femgx-orientation-gizmo="true"]');
  const svg = gizmo.locator("svg");
  const front = gizmo.locator('[data-view-face="front"]');
  const polygon = front.locator("polygon");
  await expect(gizmo).toHaveCSS("pointer-events", "auto");
  await expect(svg).toHaveCSS("pointer-events", "auto");
  await expect(canvas).toHaveAttribute("data-selected", "");

  const before = await polygon.getAttribute("points");
  const faceBox = await polygon.boundingBox();
  if (faceBox === null) throw new Error("front gizmo face has no bounding box");
  await page.mouse.click(faceBox.x + faceBox.width / 2, faceBox.y + faceBox.height / 2);

  await expect.poll(() => polygon.getAttribute("points")).not.toBe(before);
  await expect(canvas).toHaveAttribute("data-selected", "");
});
