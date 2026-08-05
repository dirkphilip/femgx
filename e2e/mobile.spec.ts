import { expect, test } from "@playwright/test";
import { requireHit } from "./helpers";

/**
 * Phone-sized regression coverage for the demo layout: no horizontal page
 * overflow, touch-friendly primary controls, and a context menu that stays
 * inside the viewport when opened near an edge. The default e2e lane runs
 * the CPU renderer so layout is deterministic.
 */

const PHONE = { width: 390, height: 844 };

test("fits a phone-sized viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "the page must not scroll horizontally on a phone").toBeLessThanOrEqual(0);
});

test("renders the bolted showcase with distinct part colors on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.getAttribute("data-renderer")).toBe("cpu");

  const drawn = await canvas.evaluate((el: HTMLCanvasElement) => {
    const context = el.getContext("2d");
    if (context === null) {
      return false;
    }
    const { data } = context.getImageData(0, 0, el.width, el.height);
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      colors.add((data[i] ?? 0) | ((data[i + 1] ?? 0) << 8) | ((data[i + 2] ?? 0) << 16));
      if (colors.size >= 4) return true;
    }
    return false;
  });
  expect(drawn, "the bolted view must render distinct part colors on a phone").toBe(true);

  const screenshot = await canvas.screenshot();
  expect(
    screenshot,
    "the bolted showcase must produce a non-empty phone screenshot",
  ).not.toHaveLength(0);
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
  // Sweep from the bottom-right corner inward so the right-click lands near the
  // viewport edges, which is what forces the menu-clamping behavior.
  const hit = await requireHit(
    page,
    canvas,
    { reverse: true },
    "picking must resolve near the canvas edge on the deterministic CPU lane",
  );

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
