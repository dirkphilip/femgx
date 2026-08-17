import { expect, test } from "@playwright/test";
import { requireHit } from "../../browser-support/helpers";
import {
  closeNavigation,
  openCommandPanel,
  openNavigation,
  waitForRenderer,
} from "../demo-support";
import { PHONE, cameraPose } from "./support";

test("stacks the optional secondary viewport without mobile overflow", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const primary = page.getByTestId("view-canvas");
  await waitForRenderer(page, primary);
  await openCommandPanel(page, "view");
  await page.getByTestId("viewport-toggle").click();
  const secondary = page.getByTestId("secondary-view-canvas");
  await expect(secondary).toBeVisible();
  await waitForRenderer(page, secondary);
  await page.getByTestId("background-select").selectOption("dark");
  await page.getByTestId("command-view").click();
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  const primaryBox = await primary.boundingBox();
  const secondaryBox = await secondary.boundingBox();
  const toolbarBox = await page.locator(".toolbar").boundingBox();
  if (primaryBox === null || secondaryBox === null || toolbarBox === null) {
    throw new Error("viewport shell has no bounds");
  }
  expect(primaryBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height - 1);
  expect(secondaryBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height - 1);
  expect(secondaryBox.y).toBeGreaterThan(primaryBox.y + primaryBox.height - 1);
  await openNavigation(page);
  const visibilityPanel = page.getByTestId("visibility-panel");
  await expect(visibilityPanel).toBeVisible();
  const checkbox = visibilityPanel.locator('input[type="checkbox"]').first();
  await expect(checkbox).toBeVisible();
  const primaryFrames = Number((await primary.getAttribute("data-frames")) ?? "0");
  const secondaryFrames = Number((await secondary.getAttribute("data-frames")) ?? "0");
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await expect
    .poll(async () => Number((await primary.getAttribute("data-frames")) ?? "0"))
    .toBe(primaryFrames);
  await expect
    .poll(async () => Number((await secondary.getAttribute("data-frames")) ?? "0"))
    .toBeGreaterThan(secondaryFrames);
  await page.locator("#primary-scene").focus();
  const primaryCheckbox = visibilityPanel.locator('input[type="checkbox"]').first();
  await page.waitForTimeout(100);
  const primaryFramesBefore = Number((await primary.getAttribute("data-frames")) ?? "0");
  const secondaryFramesBefore = Number((await secondary.getAttribute("data-frames")) ?? "0");
  await primaryCheckbox.uncheck();
  await expect
    .poll(async () => Number((await primary.getAttribute("data-frames")) ?? "0"))
    .toBeGreaterThan(primaryFramesBefore);
  await expect
    .poll(async () => Number((await secondary.getAttribute("data-frames")) ?? "0"))
    .toBe(secondaryFramesBefore);
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(scrollHeight).toBeLessThanOrEqual(PHONE.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    PHONE.width,
  );

  await closeNavigation(page);
  await openCommandPanel(page, "view");
  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeHidden();
  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeVisible();
  await waitForRenderer(page, secondary);
  const reopenedPrimaryBox = await primary.boundingBox();
  const reopenedSecondaryBox = await secondary.boundingBox();
  if (reopenedPrimaryBox === null || reopenedSecondaryBox === null) {
    throw new Error("reopened mobile layout has no bounds");
  }
  expect(reopenedSecondaryBox.y).toBeGreaterThan(
    reopenedPrimaryBox.y + reopenedPrimaryBox.height - 1,
  );
  const toggle = await page.getByTestId("viewport-toggle").boundingBox();
  expect(toggle?.height ?? 0).toBeGreaterThanOrEqual(44);
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
    "picking must resolve near the canvas edge on the deterministic WebGPU lane",
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

test("selects the owning element from a node context menu on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:", fresh: true },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );
  const menu = page.getByTestId("context-menu");

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await expect(menu).toBeVisible();
  await expect(menu.locator('button[data-action="select-element"]')).toHaveText("Select element");
  const menuBox = await menu.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  if (menuBox === null) throw new Error("context menu has no bounding box");
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height);

  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);
});

test("selects the intended element from a real touch tap", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: PHONE,
    screen: PHONE,
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const canvas = page.getByTestId("view-canvas");
    await waitForRenderer(page, canvas);
    const hit = await requireHit(
      page,
      canvas,
      { prefix: "n:", fresh: true },
      "touch target discovery must resolve a node on the deterministic WebGPU lane",
    );

    await page.touchscreen.tap(hit.x, hit.y);
    await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);
  } finally {
    await context.close();
  }
});

test("highlights the intended element in mobile Highlight mode", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: PHONE,
    screen: PHONE,
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const canvas = page.getByTestId("view-canvas");
    await waitForRenderer(page, canvas);
    const hit = await requireHit(
      page,
      canvas,
      { prefix: "n:", fresh: true },
      "touch target discovery must resolve a node on the deterministic WebGPU lane",
    );
    const cameraBefore = cameraPose(await canvas.getAttribute("data-camera"));

    await page.getByTestId("touch-tool-hover").click();
    await expect(page.getByTestId("touch-tool-hover")).toHaveAttribute("aria-pressed", "true");
    await page.touchscreen.tap(hit.x, hit.y);

    await expect.poll(() => canvas.getAttribute("data-hovered")).toMatch(/^e:/);
    await expect(canvas).toHaveAttribute("data-selected", "");
    expect(cameraPose(await canvas.getAttribute("data-camera"))).toEqual(cameraBefore);
  } finally {
    await context.close();
  }
});

test("routes mobile box selection through the right-side touch tool rail", async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE, screen: PHONE, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const canvas = page.getByTestId("view-canvas");
    await waitForRenderer(page, canvas);

    const rail = page.getByTestId("touch-tool-rail");
    await expect(rail).toBeVisible();
    for (const testId of [
      "touch-tool-navigate",
      "touch-tool-hover",
      "touch-tool-box-select",
      "touch-tool-select-all",
    ]) {
      const box = await page.getByTestId(testId).boundingBox();
      if (box === null) throw new Error(`${testId} has no bounds`);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await expect(canvas).toHaveAttribute("data-selected", "");
    await page.getByTestId("touch-tool-box-select").click();
    await expect(page.getByTestId("touch-tool-box-select")).toHaveAttribute("aria-pressed", "true");

    const canvasBox = await canvas.boundingBox();
    if (canvasBox === null) throw new Error("mobile canvas has no bounds");
    const start = { x: canvasBox.x + 20, y: canvasBox.y + 20 };
    const end = {
      x: canvasBox.x + canvasBox.width - 20,
      y: canvasBox.y + canvasBox.height - 80,
    };
    const cameraBefore = cameraPose(await canvas.getAttribute("data-camera"));
    const chrome = await context.newCDPSession(page);
    await chrome.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 31 }],
    });
    await chrome.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...end, id: 31 }],
    });
    await expect(page.getByTestId("box-selection-overlay")).toBeVisible();
    await chrome.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect(page.getByTestId("box-selection-overlay")).toBeHidden();
    await expect(page.getByTestId("model-feedback")).toContainText("Box selection:");
    await expect(page.getByTestId("model-feedback")).not.toContainText("Box selection: 0 elements");
    await expect.poll(() => canvas.getAttribute("data-selected")).not.toBe("");
    expect(cameraPose(await canvas.getAttribute("data-camera"))).toEqual(cameraBefore);
  } finally {
    await context.close();
  }
});
