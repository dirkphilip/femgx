import { expect, test, type Page } from "@playwright/test";
import { drawnPixels, waitForRenderer } from "./demo-support";

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;
const ORDINARY_MODELS = [
  "bolted",
  "vtk",
  "gallery",
  "hex20-cylinder",
  "section-volume",
  "results",
  "transparency",
  "performance",
] as const;
const RESULT_MODELS = new Set(["vtk", "hex20-cylinder", "section-volume", "results"]);

test("keeps every ordinary story inside desktop and phone layout budgets", async ({ page }) => {
  for (const viewport of [DESKTOP, PHONE]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await waitForRenderer(page);
    const canvas = page.getByTestId("view-canvas");

    for (const model of ORDINARY_MODELS) {
      await page.getByTestId("model-select").selectOption(model);
      await expect(canvas).toHaveAttribute("data-model", model);
      await expect.poll(() => drawnPixels(canvas), { timeout: 15_000 }).toBe(true);
      await assertWorkbenchLayout(page, viewport === PHONE, RESULT_MODELS.has(model));
    }
  }
});

async function assertWorkbenchLayout(
  page: Page,
  phone: boolean,
  resultModel: boolean,
): Promise<void> {
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
      scene: read("#primary-scene"),
      toolbar: read(".toolbar"),
      canvas: read('[data-testid="view-canvas"]'),
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
  expect(layout.toolbar).toBeDefined();
  expect(layout.canvas).toBeDefined();
  expect(layout.gizmo).toBeDefined();
  if (layout.scene === undefined || layout.toolbar === undefined || layout.canvas === undefined) {
    throw new Error("primary workbench layout is missing a required surface");
  }
  expect(layout.toolbar.x).toBeGreaterThanOrEqual(layout.scene.x - 1);
  expect(layout.toolbar.right).toBeLessThanOrEqual(layout.scene.right + 1);
  expect(layout.toolbar.y).toBeGreaterThanOrEqual(layout.scene.y - 1);
  expect(layout.toolbar.bottom).toBeLessThanOrEqual(layout.scene.bottom + 1);
  expect(layout.canvas.width).toBeGreaterThan(0);
  expect(layout.canvas.height).toBeGreaterThan(phone ? 280 : 400);

  if (layout.gizmo !== undefined) {
    expect(layout.gizmo.x).toBeGreaterThanOrEqual(layout.scene.x - 1);
    expect(layout.gizmo.right).toBeLessThanOrEqual(layout.scene.right + 1);
    expect(layout.gizmo.y).toBeGreaterThanOrEqual(layout.scene.y - 1);
    expect(layout.gizmo.bottom).toBeLessThanOrEqual(layout.scene.bottom + 1);
  }

  if (resultModel) {
    expect(layout.results?.hidden).toBe(false);
    expect(layout.results?.display).not.toBe("none");
    expect(layout.legend?.hidden).toBe(false);
  } else {
    expect(layout.results?.hidden).toBe(true);
    expect(layout.results?.width).toBe(0);
    expect(layout.results?.height).toBe(0);
    expect(layout.results?.display).toBe("none");
    expect(layout.activeElementInsideHiddenResults).toBe(false);
    expect(layout.legend?.hidden).toBe(true);
  }
}
