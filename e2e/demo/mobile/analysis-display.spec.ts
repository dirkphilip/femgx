import { expect, test } from "@playwright/test";

import {
  closeNavigation,
  openCommandPanel,
  openNavigation,
  waitForRenderer,
} from "../demo-support";
import { PHONE } from "./support";

test("fits the element tessellation and mapping gallery into a phone-sized viewport", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await openNavigation(page);
  await page.getByTestId("model-select").selectOption("gallery");
  await closeNavigation(page);
  await expect(canvas).toHaveAttribute("data-model", "gallery");
  await expect(page.getByTestId("status")).toContainText("15 visible");
  await waitForRenderer(page, canvas);
});

test("keeps primary controls reachable and touch-sized on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const viewportWidth = await page.evaluate(() => window.innerWidth);

  const controlsByPanel = [
    ["selection", ["selection-granularity", "hide-selected", "clear-selection", "show-all"]],
    ["view", ["fit-view", "projection-toggle"]],
    ["display", ["edge-overlay"]],
  ] as const;
  for (const [panel, testIds] of controlsByPanel) {
    await openCommandPanel(page, panel);
    for (const testId of testIds) {
      const control = page.getByTestId(testId);
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      if (box === null) {
        throw new Error(`${testId} has no bounding box`);
      }
      expect(box.x, `${testId} left edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${testId} right edge`).toBeLessThanOrEqual(viewportWidth);
      expect(box.height, `${testId} hit area`).toBeGreaterThanOrEqual(44);
    }
  }
  await openNavigation(page);
  await expect(page.getByTestId("model-select")).toBeVisible();
});

test("keeps section-plane controls usable on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await openNavigation(page);
  await page.getByTestId("model-select").selectOption("section-volume");
  await closeNavigation(page);
  await openCommandPanel(page, "analysis");
  await page.getByTestId("section-axis").selectOption("z");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-section-axis", "z");
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  for (const testId of ["section-axis", "section-offset"]) {
    const control = page.getByTestId(testId);
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    if (box === null) throw new Error(`${testId} has no bounding box`);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
    expect(box.height).toBeGreaterThanOrEqual(40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewportWidth,
  );
});

test("opens a bounded body element detail route and restores focus on a phone", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await openNavigation(page);
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);

  const trigger = page.locator('button[data-testid^="body-elements-"]').first();
  await expect(trigger).toBeVisible();
  const triggerBox = await trigger.boundingBox();
  if (triggerBox === null) throw new Error("body element detail trigger has no bounds");
  expect(triggerBox.height).toBeGreaterThanOrEqual(44);
  await trigger.focus();
  const triggerTestId = await trigger.getAttribute("data-testid");
  await trigger.click();

  const detail = page.getByTestId("element-detail");
  await expect(detail).toBeVisible();
  const options = detail.locator('[role="option"]');
  expect(await options.count()).toBeLessThan(100);
  const first = options.first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);
  await expect(first).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("element-detail-back").click();
  await expect(detail).toBeHidden();
  if (triggerTestId === null) throw new Error("detail trigger has no stable test id");
  await expect(page.getByTestId(triggerTestId)).toBeFocused();
});
