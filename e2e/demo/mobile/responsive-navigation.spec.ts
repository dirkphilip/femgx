import { expect, test } from "@playwright/test";
import { canvasInteractionBox } from "../../browser-support/helpers";
import {
  closeNavigation,
  openCommandPanel,
  openNavigation,
  waitForRenderer,
} from "../demo-support";
import { PHONE } from "./support";

test("fits a phone-sized viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "the page must not scroll horizontally on a phone").toBeLessThanOrEqual(0);
});

test("uses one accessible phone drawer and keeps it exclusive of Analysis", async ({
  page,
}, testInfo) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const trigger = page.getByTestId("navigation-toggle");
  const drawer = page.getByTestId("navigation-drawer");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(drawer).toHaveAttribute("aria-hidden", "true");
  const closedGeometry = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) return undefined;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        right: box.right,
        y: box.y,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        text: element.textContent,
      };
    };
    return {
      trigger: read('[data-testid="navigation-toggle"]'),
      commandBar: read(".command-bar"),
      commandTarget: read(".command-target"),
    };
  });
  if (
    closedGeometry.trigger === undefined ||
    closedGeometry.commandBar === undefined ||
    closedGeometry.commandTarget === undefined
  ) {
    throw new Error("mobile navigation geometry is missing");
  }
  expect(closedGeometry.trigger.right).toBeLessThanOrEqual(closedGeometry.commandBar.x);
  expect(closedGeometry.trigger.y).toBeLessThan(closedGeometry.commandBar.bottom);
  expect(closedGeometry.trigger.width).toBe(44);
  expect(closedGeometry.trigger.height).toBe(44);
  expect(
    Math.abs(
      closedGeometry.trigger.y +
        closedGeometry.trigger.height / 2 -
        (closedGeometry.commandTarget.y + closedGeometry.commandTarget.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  expect(closedGeometry.trigger.text.trim()).toBe("");
  await expect(trigger.locator("path")).toHaveAttribute("d", "M4 5h16v14H4zM9 5v14");
  await expect(trigger).toHaveAttribute("aria-label", "Open navigation");
  await page.screenshot({
    path: testInfo.outputPath("mobile-navigation-closed.png"),
    fullPage: true,
  });

  await openCommandPanel(page, "analysis");
  await expect(page.getByTestId("analysis-controls")).toBeVisible();
  await openNavigation(page);
  await expect(trigger).toHaveAttribute("aria-label", "Close navigation");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByTestId("analysis-controls")).toBeHidden();
  await expect(drawer).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await page.screenshot({
    path: testInfo.outputPath("mobile-navigation-open.png"),
    fullPage: true,
  });
  const openGeometry = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) return undefined;
      const box = element.getBoundingClientRect();
      return { y: box.y, bottom: box.bottom };
    };
    return {
      trigger: read('[data-testid="navigation-toggle"]'),
      visibility: read("#visibility-panel"),
    };
  });
  if (openGeometry.trigger === undefined || openGeometry.visibility === undefined) {
    throw new Error("open mobile navigation geometry is missing");
  }
  expect(openGeometry.trigger.bottom).toBeLessThanOrEqual(openGeometry.visibility.y);
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

test("keeps the navigation trigger mobile-only", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.getByTestId("navigation-toggle")).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("desktop-navigation-absent.png"),
    fullPage: true,
  });
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
