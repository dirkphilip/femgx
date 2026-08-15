import { expect, test } from "@playwright/test";
import { canvasInteractionBox, requireHit } from "../shared/helpers";
import { closeNavigation, openCommandPanel, openNavigation, waitForRenderer } from "./demo-support";

/**
 * Phone-sized regression coverage for the demo layout: no horizontal page
 * overflow, touch-friendly primary controls, and a context menu that stays
 * inside the viewport when opened near an edge. The default e2e lane runs
 * the WebGPU renderer.
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

test("uses one accessible phone drawer and keeps it exclusive of Analysis", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const trigger = page.getByTestId("navigation-toggle");
  const drawer = page.getByTestId("navigation-drawer");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(drawer).toHaveAttribute("aria-hidden", "true");

  await openCommandPanel(page, "analysis");
  await expect(page.getByTestId("analysis-controls")).toBeVisible();
  await openNavigation(page);
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByTestId("analysis-controls")).toBeHidden();
  expect(
    await page.evaluate(() =>
      document.querySelector("#navigation-drawer")?.contains(document.activeElement),
    ),
  ).toBe(true);

  await page.getByTestId("model-select").press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe(
    "navigation-toggle",
  );
  await expect(drawer).toHaveAttribute("aria-hidden", "true");
});

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
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  const primaryBox = await primary.boundingBox();
  const secondaryBox = await secondary.boundingBox();
  if (primaryBox === null || secondaryBox === null) throw new Error("viewport has no bounds");
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
    .toBeGreaterThan(primaryFrames);
  await expect
    .poll(async () => Number((await secondary.getAttribute("data-frames")) ?? "0"))
    .toBeGreaterThan(secondaryFrames);
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
    ["selection", ["selection-granularity", "hide-selected"]],
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

test("keeps the empty-scene view menu inside a phone-sized viewport", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);
  const box = await canvasInteractionBox(canvas);

  // Stay inside the canvas but above the mobile status strip, where the
  // bottom-right canvas point is covered by the status element.
  const x = Math.round(box.x + box.width - 20);
  const y = Math.round(box.y + box.height - 100);
  await page.mouse.click(x, y, { button: "right" });

  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".menu-title").first()).toHaveText("View");
  const menuBox = await menu.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  if (menuBox === null) throw new Error("context menu has no bounding box");
  expect(menuBox.x, "view menu left edge").toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width, "view menu right edge").toBeLessThanOrEqual(viewport.width);
  expect(menuBox.y, "view menu top edge").toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height, "view menu bottom edge").toBeLessThanOrEqual(viewport.height);

  await menu.getByText("Show diagnostics").click();
  const diagnostics = page.getByTestId("stats-panel");
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.locator("h2")).toHaveText("Diagnostics");
  const diagnosticsBox = await diagnostics.boundingBox();
  const sceneBox = await page.locator(".scene").boundingBox();
  if (diagnosticsBox === null || sceneBox === null) {
    throw new Error("mobile diagnostics layout has no measurable bounds");
  }
  expect(diagnosticsBox.x).toBeGreaterThanOrEqual(sceneBox.x);
  expect(diagnosticsBox.x + diagnosticsBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width);
});

test("restores hidden body and placement visibility through Show all on a phone", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await openNavigation(page);
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);

  const body = page.locator('input[data-testid^="body-vis-"]').first();
  const instance = page.locator("input[data-instance-id]").first();
  await body.uncheck();
  await instance.uncheck();
  await expect(body).not.toBeChecked();
  await expect(instance).not.toBeChecked();

  await closeNavigation(page);
  const box = await canvasInteractionBox(canvas);
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 100, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await menu.getByText("Show all").click();

  await expect(body).toBeChecked();
  await expect(body).toBeEnabled();
  await expect(instance).toBeChecked();
});

test("keeps authored block controls keyboard accessible on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await openNavigation(page);
  const block = page.locator('input[data-testid^="block-vis-"]').first();
  await expect(block).toBeVisible();
  await block.focus();
  await page.keyboard.press("Space");
  await expect(block).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(block).toBeChecked();

  const highlight = page.locator('button[data-block-highlight="true"]').first();
  await highlight.focus();
  await page.keyboard.press("Enter");
  await expect(highlight).toHaveAttribute("aria-pressed", "true");
});
