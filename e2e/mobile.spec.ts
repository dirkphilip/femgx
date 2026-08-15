import { expect, test } from "@playwright/test";
import { canvasInteractionBox, distinctColors, requireHit } from "./helpers";
import { dataset, primaryBoxDrag, waitForRenderer } from "./demo-support";

const BASE_URL = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:5173";

/**
 * Phone-sized regression coverage for the demo layout: no horizontal page
 * overflow, touch-friendly primary controls, and a context menu that stays
 * inside the viewport when opened near an edge. The default e2e lane runs
 * the WebGPU renderer.
 */

const PHONE = { width: 390, height: 844 };

test("keeps CSS size, device-pixel size, and pick coordinates consistent on a high-DPI phone", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: PHONE,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await waitForRenderer(page, canvas);

  // The canvas backing store is sized in device pixels while the CSS size is
  // device pixels / deviceScaleFactor; pick coordinates must align with the
  // drawn frame on a high-DPI screen.
  const sizing = await canvas.evaluate((element: HTMLCanvasElement) => ({
    cssWidth: element.getBoundingClientRect().width,
    cssHeight: element.getBoundingClientRect().height,
    deviceWidth: element.width,
    deviceHeight: element.height,
  }));
  expect(sizing.deviceWidth).toBeCloseTo(sizing.cssWidth * 3, 0);
  expect(sizing.deviceHeight).toBeCloseTo(sizing.cssHeight * 3, 0);

  // Picking must resolve at the same CSS point on a high-DPI canvas.
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node raycast picking must resolve on the deterministic WebGPU lane at high DPI",
  );
  expect(hit.x).toBeGreaterThan(0);
  expect(hit.y).toBeGreaterThan(0);

  await context.close();
});

test("fits a phone-sized viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "the page must not scroll horizontally on a phone").toBeLessThanOrEqual(0);
});

test("stacks the optional secondary viewport without mobile overflow", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const primary = page.getByTestId("view-canvas");
  await waitForRenderer(page, primary);
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
  const sidebar = page.locator(".sidebar");
  const sidebarBox = await sidebar.boundingBox();
  if (sidebarBox === null) throw new Error("visibility sidebar has no bounds");
  expect(sidebarBox.y).toBeGreaterThanOrEqual(secondaryBox.y + secondaryBox.height - 1);

  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
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
  expect(scrollHeight).toBeGreaterThan(secondaryBox.y + secondaryBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    PHONE.width,
  );

  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeHidden();
  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeVisible();
  await waitForRenderer(page, secondary);
  const reopenedPrimaryBox = await primary.boundingBox();
  const reopenedSecondaryBox = await secondary.boundingBox();
  const reopenedSidebarBox = await sidebar.boundingBox();
  if (reopenedPrimaryBox === null || reopenedSecondaryBox === null || reopenedSidebarBox === null) {
    throw new Error("reopened mobile layout has no bounds");
  }
  expect(reopenedSecondaryBox.y).toBeGreaterThan(
    reopenedPrimaryBox.y + reopenedPrimaryBox.height - 1,
  );
  expect(reopenedSidebarBox.y).toBeGreaterThanOrEqual(
    reopenedSecondaryBox.y + reopenedSecondaryBox.height - 1,
  );
  const toggle = await page.getByTestId("viewport-toggle").boundingBox();
  expect(toggle?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("renders the bolted showcase with distinct part colors on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await waitForRenderer(page, canvas);

  await expect
    .poll(async () => distinctColors(canvas), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);

  const screenshot = await canvas.screenshot();
  expect(
    screenshot,
    "the bolted showcase must produce a non-empty phone screenshot",
  ).not.toHaveLength(0);
});

test("fits the element tessellation and mapping gallery into a phone-sized viewport", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-select").selectOption("gallery");
  await expect(canvas).toHaveAttribute("data-model", "gallery");
  await expect(page.getByTestId("status")).toContainText("15 visible");
  await waitForRenderer(page, canvas);
  await expect.poll(() => distinctColors(canvas), { timeout: 10_000 }).toBeGreaterThanOrEqual(6);

  const screenshot = await canvas.screenshot();
  expect(
    screenshot,
    "the element gallery must produce a non-empty phone screenshot",
  ).not.toHaveLength(0);
});

test("keeps primary controls reachable and touch-sized on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const viewportWidth = await page.evaluate(() => window.innerWidth);

  for (const testId of [
    "model-select",
    "fit-view",
    "selection-granularity",
    "hide-selected",
    "show-all",
    "projection-toggle",
    "edge-overlay",
    "reset",
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

test("keeps section-plane controls usable on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("section-volume");
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

test("reports box-selected FE element granularity on a phone-sized viewport", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);
  await primaryBoxDrag(page, canvas, { fx: 0.2, fy: 0.15 }, { fx: 0.8, fy: 0.85 });
  await page.mouse.up({ button: "left" });

  await expect(page.getByTestId("model-feedback")).toHaveText(/^Box selection: \d+ FE elements?$/);
  await expect.poll(() => dataset(page, "selected")).toContain("e:");
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
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);

  const body = page.locator('input[data-testid^="body-vis-"]').first();
  const instance = page.locator("input[data-instance-id]").first();
  await body.uncheck();
  await instance.uncheck();
  await expect(body).not.toBeChecked();
  await expect(instance).not.toBeChecked();

  const box = await canvasInteractionBox(canvas);
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 100, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await menu.getByText("Show all").click();

  await expect(body).toBeChecked();
  await expect(body).toBeEnabled();
  await expect(instance).toBeChecked();
});
