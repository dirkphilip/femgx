import { expect, test, type Page } from "@playwright/test";
import {
  closeNavigation,
  drawnPixels,
  openCommandPanel,
  openNavigation,
  waitForRenderer,
} from "./demo-support";

const PHONE = { width: 390, height: 844 } as const;
const COMPACT = { width: 721, height: 600 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;
const ORDINARY_MODELS = [
  "bolted",
  "vtk",
  "gallery",
  "hex20-cylinder",
  "section-volume",
  "results",
  "transparency",
] as const;
const RESULT_MODELS = new Set(["vtk", "hex20-cylinder", "section-volume", "results"]);

test("keeps every ordinary story inside desktop and phone layout budgets", async ({ page }) => {
  for (const viewport of [DESKTOP, PHONE]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await waitForRenderer(page);
    const canvas = page.getByTestId("view-canvas");

    for (const model of ORDINARY_MODELS) {
      if (viewport === PHONE) await openNavigation(page);
      await page.getByTestId("model-select").selectOption(model);
      if (viewport === PHONE) await closeNavigation(page);
      await expect(canvas).toHaveAttribute("data-model", model);
      await expect.poll(() => drawnPixels(canvas), { timeout: 15_000 }).toBe(true);
      await assertWorkbenchLayout(page, viewport === PHONE, RESULT_MODELS.has(model));
    }
  }
});

test("keeps the compact rail and command row inside a narrow desktop viewport", async ({
  page,
}) => {
  await page.setViewportSize(COMPACT);
  await page.goto("/");
  await waitForRenderer(page);
  await assertWorkbenchLayout(page, false, false);
});

async function assertWorkbenchLayout(
  page: Page,
  phone: boolean,
  resultModel: boolean,
): Promise<void> {
  if (resultModel) await openCommandPanel(page, "analysis");
  const layout = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) return undefined;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        hidden: element.hidden,
        display: getComputedStyle(element).display,
      };
    };
    const toolbar = document.querySelector<HTMLElement>(".toolbar");
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      toolbarScrollWidth: toolbar?.scrollWidth ?? 0,
      toolbarClientWidth: toolbar?.clientWidth ?? 0,
      activeElementInsideHiddenResults:
        document.querySelector<HTMLElement>("#result-controls")?.contains(document.activeElement) ??
        false,
      shell: read("#viewport-shell"),
      workspace: read("#viewport-workspace"),
      scene: read("#primary-scene"),
      toolbar: read(".toolbar"),
      canvas: read('[data-testid="view-canvas"]'),
      analysis: read("#analysis-surface"),
      legend: read("#result-legend"),
      results: read("#result-controls"),
      gizmo: read('[data-femgx-orientation-gizmo="true"]'),
    };
  });

  expect(layout.documentWidth, "the page must not overflow horizontally").toBeLessThanOrEqual(
    layout.viewportWidth,
  );
  expect(
    layout.toolbarScrollWidth,
    "the toolbar must not overflow horizontally",
  ).toBeLessThanOrEqual(layout.toolbarClientWidth);
  expect(layout.scene).toBeDefined();
  expect(layout.shell).toBeDefined();
  expect(layout.workspace).toBeDefined();
  expect(layout.toolbar).toBeDefined();
  expect(layout.canvas).toBeDefined();
  expect(layout.gizmo).toBeDefined();
  if (
    layout.shell === undefined ||
    layout.workspace === undefined ||
    layout.scene === undefined ||
    layout.toolbar === undefined ||
    layout.canvas === undefined
  ) {
    throw new Error("primary workbench layout is missing a required surface");
  }
  expect(layout.toolbar.x).toBeGreaterThanOrEqual(layout.shell.x - 1);
  expect(layout.toolbar.right).toBeLessThanOrEqual(layout.shell.right + 1);
  expect(layout.toolbar.y).toBeGreaterThanOrEqual(layout.shell.y - 1);
  expect(layout.toolbar.bottom).toBeLessThanOrEqual(layout.workspace.y + 1);
  expect(layout.scene.y).toBeGreaterThanOrEqual(layout.workspace.y - 1);
  expect(layout.scene.bottom).toBeLessThanOrEqual(layout.workspace.bottom + 1);
  expect(layout.canvas.width).toBeGreaterThan(0);
  expect(layout.canvas.height).toBeGreaterThan(phone ? 280 : 400);
  if (phone) {
    expect(layout.canvas.width).toBeGreaterThanOrEqual(320);
    expect(layout.canvas.height).toBeGreaterThanOrEqual(360);
  }

  if (layout.gizmo !== undefined) {
    expect(layout.gizmo.x).toBeGreaterThanOrEqual(layout.scene.x - 1);
    expect(layout.gizmo.right).toBeLessThanOrEqual(layout.scene.right + 1);
    expect(layout.gizmo.y).toBeGreaterThanOrEqual(layout.scene.y - 1);
    expect(layout.gizmo.bottom).toBeLessThanOrEqual(layout.scene.bottom + 1);
  }

  if (resultModel) {
    expect(layout.analysis).toBeDefined();
    expect(layout.results?.hidden).toBe(false);
    expect(layout.results?.display).not.toBe("none");
    expect(layout.legend?.hidden).toBe(false);
    if (phone) expect(layout.legend?.width).toBeLessThanOrEqual(220);
  } else {
    expect(layout.results?.hidden).toBe(true);
    expect(layout.results?.width).toBe(0);
    expect(layout.results?.height).toBe(0);
    expect(layout.results?.display).toBe("none");
    expect(layout.activeElementInsideHiddenResults).toBe(false);
    expect(layout.legend?.hidden).toBe(true);
  }
}
