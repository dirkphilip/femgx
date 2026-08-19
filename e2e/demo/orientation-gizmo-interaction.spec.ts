import { expect, test, type Page } from "@playwright/test";
import { waitForRenderer } from "./demo-support";

async function expectGizmoPointerActivation(page: Page): Promise<void> {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);

  const gizmo = page.locator('[data-femgx-orientation-gizmo="true"]');
  const svg = gizmo.locator("svg");
  const polygon = gizmo.locator('[data-view-face="front"] polygon');
  const overlappingCorner = gizmo.locator('[data-view-corner="+++"] circle');
  await expect(gizmo).toHaveCSS("pointer-events", "auto");
  await expect(svg).toHaveCSS("pointer-events", "auto");
  await expect(canvas).toHaveAttribute("data-selected", "");

  const before = await polygon.getAttribute("points");
  const cornerBox = await overlappingCorner.boundingBox();
  if (cornerBox === null) throw new Error("overlapping gizmo corner has no bounding box");
  await page.mouse.click(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2);

  await expect.poll(() => polygon.getAttribute("points")).not.toBe(before);
  const inFlight = await polygon.getAttribute("points");
  await expect.poll(() => polygon.getAttribute("points")).not.toBe(inFlight);
  await expect(overlappingCorner).toHaveCSS("fill-opacity", "0");
  await expect(canvas).toHaveAttribute("data-selected", "");
}

test("keeps overlapping face clicks out of the canvas and animates the camera", async ({
  page,
}) => {
  await expectGizmoPointerActivation(page);
});

test("keeps the same gizmo interaction contract at the mobile breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expectGizmoPointerActivation(page);
});
