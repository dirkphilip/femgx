import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  closeNavigation,
  openCommandPanel,
  openNavigation,
  requireHit,
  waitForRenderer,
} from "./demo-support";

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;
type LayoutBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
};

test("keeps the global analysis summary compact and scrollable when expanded", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await loadResults(page);
  const summary = page.getByTestId("result-legend");
  const toggle = page.getByTestId("result-legend-toggle");
  const details = page.getByTestId("result-legend-details");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute("aria-controls", "result-legend-details");
  await expect(details).toBeHidden();
  await expect(toggle).toContainText("Demo stress");
  const compact = await requireBox(summary);
  expect(compact.height).toBeLessThan(100);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(details).toBeVisible();
  const detailsStyle = await details.evaluate((element) => {
    const style = getComputedStyle(element);
    return { maxHeight: style.maxHeight, overflowY: style.overflowY };
  });
  expect(detailsStyle.maxHeight).not.toBe("none");
  expect(detailsStyle.overflowY).toBe("auto");
  const expanded = await requireBox(summary);
  const workspace = await requireBox(page.locator("#viewport-workspace"));
  expect(expanded.right).toBeLessThanOrEqual(workspace.right + 1);
  expect(expanded.bottom).toBeLessThanOrEqual(workspace.bottom + 1);
});

test("anchors one summary to the workspace when two desktop viewports are open", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await loadResults(page);
  await openCommandPanel(page, "view");
  await page.getByTestId("viewport-toggle").click();
  await expect(page.getByTestId("secondary-view-canvas")).toBeVisible();

  const summaries = page.getByTestId("result-legend");
  await expect(summaries).toHaveCount(1);
  const summary = await requireBox(summaries);
  const workspace = await requireBox(page.locator("#viewport-workspace"));
  expect(summary.right).toBeLessThanOrEqual(workspace.right + 1);
  expect(summary.bottom).toBeLessThanOrEqual(workspace.bottom + 1);
  expect(workspace.right - summary.right).toBeLessThanOrEqual(20);
});

test("keeps the summary beside visible inspection instead of overlapping it", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await loadResults(page);
  const canvas = page.getByTestId("view-canvas");
  const summary = page.getByTestId("result-legend");
  const hit = await requireHit(page, canvas, { fresh: true }, "results inspection needs a GPU hit");

  await page.mouse.click(hit.x, hit.y);
  const inspection = page.getByTestId("inspection-panel");
  await expect(inspection).toBeVisible();
  await assertNoOverlap(summary, inspection);
});

test("keeps the collapsed and expanded summary inside the phone controls budget", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await loadResults(page);
  const summary = page.getByTestId("result-legend");
  const toggle = page.getByTestId("result-legend-toggle");
  const details = page.getByTestId("result-legend-details");
  const workspace = page.locator("#viewport-workspace");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("result-legend-identity")).toContainText("Demo stress");
  await expect(page.getByTestId("touch-tool-rail")).toBeVisible();
  await assertInsideWorkspace(summary, workspace);
  await assertNoOverlap(summary, page.locator(".toolbar"));
  await assertNoOverlap(summary, page.getByTestId("touch-tool-rail"));

  await toggle.click();
  await expect(details).toBeVisible();
  await assertInsideWorkspace(summary, workspace);
  await assertNoOverflow(page);
  const detailsStyle = await details.evaluate((element) => {
    const style = getComputedStyle(element);
    return { maxHeight: style.maxHeight, overflowY: style.overflowY };
  });
  expect(detailsStyle.maxHeight).not.toBe("none");
  expect(detailsStyle.overflowY).toBe("auto");
});

async function loadResults(page: Page): Promise<void> {
  await page.goto("/");
  if (await page.evaluate(() => innerWidth <= 720)) {
    await openNavigation(page);
    await page.getByTestId("model-select").selectOption("results");
    await closeNavigation(page);
  } else {
    await page.getByTestId("model-select").selectOption("results");
  }
  await waitForRenderer(page);
}

async function requireBox(locator: Locator): Promise<LayoutBox> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("expected a visible layout box");
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

async function assertInsideWorkspace(summary: Locator, workspace: Locator): Promise<void> {
  const summaryBox = await requireBox(summary);
  const workspaceBox = await requireBox(workspace);
  expect(summaryBox.x).toBeGreaterThanOrEqual(workspaceBox.x - 1);
  expect(summaryBox.y).toBeGreaterThanOrEqual(workspaceBox.y - 1);
  expect(summaryBox.right).toBeLessThanOrEqual(workspaceBox.right + 1);
  expect(summaryBox.bottom).toBeLessThanOrEqual(workspaceBox.bottom + 1);
}

async function assertNoOverlap(first: Locator, second: Locator): Promise<void> {
  const firstBox = await requireBox(first);
  const secondBox = await requireBox(second);
  expect(
    firstBox.right <= secondBox.x ||
      secondBox.right <= firstBox.x ||
      firstBox.bottom <= secondBox.y ||
      secondBox.bottom <= firstBox.y,
  ).toBe(true);
}

async function assertNoOverflow(page: Page): Promise<void> {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const documentSize = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  expect(documentSize.width).toBeLessThanOrEqual(viewport.width);
  expect(documentSize.height).toBeLessThanOrEqual(viewport.height);
}
