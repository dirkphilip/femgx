import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  dataset,
  drawnPixels,
  loadWebGpuPage,
  openCommandPanel,
  pixelHash,
  requireHit,
  setSelectionGranularity,
} from "../demo-support";

interface PointHit {
  readonly x: number;
  readonly y: number;
  readonly key: string;
}

async function requirePointHit(
  page: Page,
  canvas: Locator,
  message: string,
  excludedKey?: string,
): Promise<PointHit> {
  const hit = await canvas.evaluate(async (element, excluded) => {
    const bounds = element.getBoundingClientRect();
    const probe = (
      window as typeof window & {
        femgxDemo?: {
          probePick?: (
            x: number,
            y: number,
          ) => Promise<{ readonly pickKey: string; readonly hoveredKey: string }>;
        };
      }
    ).femgxDemo?.probePick;
    if (probe === undefined) return undefined;
    for (let row = 0; row < 24; row += 1) {
      const y = Math.round(bounds.top + (0.25 + ((row + 0.5) * 0.7) / 24) * bounds.height);
      for (let column = 0; column < 24; column += 1) {
        const x = Math.round(bounds.left + (0.05 + ((column + 0.5) * 0.7) / 24) * bounds.width);
        if (document.elementFromPoint(x, y) !== element) continue;
        const result = await probe(x - bounds.left, y - bounds.top);
        if (result.pickKey.startsWith("n:") && result.pickKey !== excluded)
          return { x, y, key: result.pickKey };
      }
    }
    return undefined;
  }, excludedKey);
  expect(hit, message).toBeDefined();
  if (hit === undefined) throw new Error(message);
  await page.mouse.move(hit.x, hit.y);
  await expect.poll(() => canvas.getAttribute("data-pick")).toBe(hit.key);
  return hit;
}

async function isolatePartOccurrence(page: Page, label: string): Promise<Locator> {
  const rows = page.locator('[data-visibility-target-kind="partOccurrence"]');
  const target = rows.filter({
    has: page.getByText(`Built-in helper · ${label}`, { exact: true }),
  });
  await expect(target).toHaveCount(1);
  const checkbox = target.locator("input[data-part-occurrence-id]");
  const targetId = await checkbox.getAttribute("data-part-occurrence-id");
  if (targetId === null) throw new Error(`Missing ${label} part-occurrence identity`);
  const checkboxes = rows.locator("input[data-part-occurrence-id]");
  for (let index = 0; index < (await checkboxes.count()); index += 1) {
    const candidate = checkboxes.nth(index);
    if ((await candidate.getAttribute("data-part-occurrence-id")) !== targetId)
      await candidate.uncheck();
  }
  await expect(checkbox).toBeChecked();
  return checkbox;
}

async function visibleElementKeys(canvas: Locator): Promise<string[]> {
  return canvas.evaluate(async (element) => {
    const bounds = element.getBoundingClientRect();
    const targets = await (
      window as typeof window & {
        femgxDemo?: {
          pickRegion?: (rect: Record<string, number>, granularity: "element") => Promise<unknown[]>;
        };
      }
    ).femgxDemo?.pickRegion?.(
      {
        left: 0,
        top: 0,
        right: bounds.width,
        bottom: bounds.height,
        width: bounds.width,
        height: bounds.height,
      },
      "element",
    );
    return (targets ?? []).flatMap((target) => {
      if (typeof target !== "object" || target === null) return [];
      const value = target as Record<string, unknown>;
      return value["kind"] === "element" &&
        typeof value["partOccurrenceId"] === "string" &&
        typeof value["elementId"] === "number"
        ? [`e:${value["partOccurrenceId"]}:${value["elementId"]}`]
        : [];
    });
  });
}

test("picks and selects a node, exposing adjacency and neighbors", async ({ page }) => {
  await loadWebGpuPage(page);
  await setSelectionGranularity(page, "node");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^n:/);
  const hideSelected = page.getByTestId("hide-selected");
  await expect(hideSelected).toBeDisabled();
  await expect(hideSelected).toHaveAttribute(
    "title",
    "Select one or more visible elements to hide.",
  );
  await expect(page.getByTestId("inspection-panel")).toContainText("Adjacent elements");
  await expect(page.getByTestId("inspection-panel")).toContainText("Neighbors");
});

test("uses the Point glyph as the node marker when node annotations are toggled", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("gallery");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-model", "gallery");
  await isolatePartOccurrence(page, "Point");
  await setSelectionGranularity(page, "node");
  await openCommandPanel(page, "display");
  const nodeOverlay = page.getByTestId("node-overlay");
  await expect(nodeOverlay).toHaveAttribute(
    "title",
    "Toggle node annotations. Point elements use their primary glyph as the node marker.",
  );
  await expect.poll(() => drawnPixels(canvas)).toBe(true);
  const pointHit = await requirePointHit(
    page,
    canvas,
    "the isolated Point occurrence must be pickable with node annotations shown",
  );

  await nodeOverlay.click();
  await expect(nodeOverlay).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => drawnPixels(canvas)).toBe(true);
  await page.mouse.click(pointHit.x, pointHit.y);
  await expect.poll(() => dataset(page, "selected")).toBe(pointHit.key);
  await expect(page.getByTestId("inspection-panel")).toContainText("Built-in helper · Point");

  await openCommandPanel(page, "display");
  await nodeOverlay.click();
  await expect(nodeOverlay).toHaveAttribute("aria-pressed", "true");
  const pointHitWithAnnotations = await requirePointHit(
    page,
    canvas,
    "the isolated Point occurrence must remain pickable with node annotations shown",
    pointHit.key,
  );
  await page.mouse.click(pointHitWithAnnotations.x, pointHitWithAnnotations.y);
  await expect.poll(() => dataset(page, "selected")).toBe(pointHitWithAnnotations.key);
  await expect(page.getByTestId("inspection-panel")).toContainText("Built-in helper · Point");
});

for (const label of ["Point", "Line", "Line3"] as const) {
  test(`hides and restores the selected gallery ${label} element through GPU picking`, async ({
    page,
  }) => {
    await loadWebGpuPage(page);
    await page.getByTestId("model-select").selectOption("gallery");
    const canvas = page.getByTestId("view-canvas");
    await expect(canvas).toHaveAttribute("data-model", "gallery");
    await setSelectionGranularity(page, "element");
    const occurrence = await isolatePartOccurrence(page, label);
    const hit = await requireHit(
      page,
      canvas,
      { prefix: "e:", attribute: "hovered", fresh: true },
      `the isolated ${label} element must resolve through GPU picking`,
    );
    await page.mouse.click(hit.x, hit.y);
    await expect.poll(() => dataset(page, "selected")).toBe(hit.key);
    const selectedPixels = await pixelHash(canvas);

    await openCommandPanel(page, "selection");
    await page.getByTestId("hide-selected").click();
    await expect(page.getByTestId("model-feedback")).toHaveText("Hidden 1 selected element.");
    await expect.poll(() => dataset(page, "selected")).toBe(hit.key);
    await page.mouse.move(hit.x, hit.y);
    await expect.poll(() => canvas.getAttribute("data-hovered")).toBe("");
    await expect.poll(() => pixelHash(canvas)).not.toBe(selectedPixels);

    await page.getByTestId("show-all").click();
    await expect(occurrence).toBeChecked();
    await expect.poll(() => visibleElementKeys(canvas)).toContain(hit.key);
    await expect.poll(() => dataset(page, "selected")).toBe(hit.key);
  });
}

test("picks and selects a face, exposing its normal and ownership", async ({ page }) => {
  await loadWebGpuPage(page);
  await setSelectionGranularity(page, "face");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "f:" },
    "face GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^f:/);
  await expect(page.getByTestId("inspection-panel")).toContainText("Normal");
  await expect(page.getByTestId("inspection-panel")).toContainText("Adjacent elements");
});

test("picks and selects an authored edge without requiring the wireframe overlay", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  await setSelectionGranularity(page, "edge");
  await openCommandPanel(page, "display");
  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "ed:" },
    "authored edge GPU picking must remain available with the overlay disabled",
  );

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toBe(hit.key);
  await expect(page.getByTestId("inspection-panel")).toContainText("Authored nodes");
  await expect(page.getByTestId("inspection-panel")).toContainText("Incident elements");
  await expect(page.getByTestId("interaction-help")).toContainText("Edge selects authored");
});
