import { expect, test } from "@playwright/test";
import { readNavigationState } from "../browser-support/camera";
import { openCommandPanel, requireHit, waitForRenderer } from "./demo-support";

test("centres selection fits in the canvas independently of inspection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("bolted");
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);
  const hit = await requireHit(page, canvas, { fresh: true }, "selection fit requires a target");
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);

  await openCommandPanel(page, "view");
  await page.getByTestId("fit-view").click();
  await page.waitForTimeout(500);
  const withInspection = (await readNavigationState(canvas)).camera;

  await page.addStyleTag({ content: ".inspection { display: none !important; }" });
  await openCommandPanel(page, "view");
  await page.getByTestId("fit-view").click();
  await page.waitForTimeout(500);
  const withoutInspection = (await readNavigationState(canvas)).camera;

  for (let axis = 0; axis < 3; axis += 1) {
    expect(withoutInspection.position[axis]).toBeCloseTo(withInspection.position[axis] ?? 0, 5);
    expect(withoutInspection.target[axis]).toBeCloseTo(withInspection.target[axis] ?? 0, 5);
  }
});
