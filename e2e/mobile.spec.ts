import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Phone-sized regression coverage for the demo layout: no horizontal page
 * overflow, touch-friendly primary controls, and a context menu that stays
 * inside the viewport when opened near an edge. The default e2e lane runs
 * the CPU renderer so layout is deterministic.
 */

const PHONE = { width: 390, height: 844 };

/** The stable pick key encoded in the canvas dataset. */
async function pickKey(page: Page): Promise<string> {
  return (await page.getByTestId("view-canvas").getAttribute("data-pick")) ?? "";
}

/** Sweeps from the bottom-right corner inward to find a pick near the edges. */
async function findEdgePick(
  page: Page,
  canvas: Locator,
): Promise<{ readonly x: number; readonly y: number } | undefined> {
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }
  for (let row = 7; row >= 0; row--) {
    for (let col = 9; col >= 0; col--) {
      const x = Math.round(box.x + ((col + 0.5) / 10) * box.width);
      const y = Math.round(box.y + ((row + 0.5) / 8) * box.height);
      await page.mouse.move(x, y);
      if ((await pickKey(page)) !== "") {
        return { x, y };
      }
    }
  }
  return undefined;
}

test("fits a phone-sized viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "the page must not scroll horizontally on a phone").toBeLessThanOrEqual(0);
});

test("keeps primary controls reachable and touch-sized on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const viewportWidth = await page.evaluate(() => window.innerWidth);

  for (const testId of [
    "model-select",
    "fit-view",
    "projection-toggle",
    "edge-overlay",
    "mode-solid",
    "reset",
    "results-play-toggle",
    "results-case-toggle",
    "results-deformed-toggle",
    "results-scalar-toggle",
  ]) {
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
});

test("keeps the context menu inside a phone-sized viewport", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await findEdgePick(page, canvas);
  if (hit === undefined) {
    test.skip(true, "picking is not functional in this environment");
    return;
  }

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();

  const menu = await page.getByTestId("context-menu").boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  if (menu === null) {
    throw new Error("context menu has no bounding box");
  }
  expect(menu.x, "menu left edge").toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width, "menu right edge").toBeLessThanOrEqual(viewport.width);
  expect(menu.y, "menu top edge").toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height, "menu bottom edge").toBeLessThanOrEqual(viewport.height);
});
