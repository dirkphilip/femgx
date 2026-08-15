import { expect, test, type Page } from "@playwright/test";
import { drawnPixels, pixelHash } from "../shared/helpers";

const HOST = "/e2e/core/core-host.html";

async function openCase(page: Page, name: string) {
  await page.goto(`${HOST}?case=${name}`);
  const status = page.locator("#core-status");
  await expect(status).toHaveAttribute("data-result", name, { timeout: 10_000 });
  return { canvas: page.locator("#core-canvas"), status };
}

test("presents two reusable public part occurrences as one instanced frame", async ({ page }) => {
  const { canvas, status } = await openCase(page, "instancing");
  const stats = JSON.parse((await status.getAttribute("data-detail")) ?? "{}") as {
    visibleInstances?: number;
    drawBatches?: number;
  };
  expect(stats.visibleInstances).toBe(2);
  expect(stats.drawBatches).toBe(1);
  await expect.poll(() => drawnPixels(canvas)).toBe(true);
});

test("resolves raster point, region, authored-edge, and visibility interaction through FemViewport", async ({
  page,
}) => {
  const { canvas, status } = await openCase(page, "picking");
  const result = JSON.parse((await status.getAttribute("data-detail")) ?? "{}") as {
    region?: number;
    picked?: string;
    edge?: string;
    hidden?: number;
  };
  expect(result.region).toBeGreaterThan(0);
  expect(result.picked).not.toBe("none");
  expect(result.edge).toBe("edge");
  expect(result.hidden).toBe(0);
  await expect(canvas).toHaveAttribute("data-ready", "true");
});

test("renders public background, authored overlays, origin triad, and resize state", async ({
  page,
}) => {
  const { canvas, status } = await openCase(page, "presentation");
  const size = JSON.parse((await status.getAttribute("data-detail")) ?? "{}") as {
    width?: number;
    height?: number;
  };
  expect(await canvas.getAttribute("data-presentation")).toBe("dark,edge-free,nodes-12,points-10");
  expect(size.width).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
  await expect.poll(() => drawnPixels(canvas)).toBe(true);
});

test("installs authored scalar results, nodal deformation, and section clipping", async ({
  page,
}) => {
  const { canvas, status } = await openCase(page, "results");
  const result = JSON.parse((await status.getAttribute("data-detail")) ?? "{}") as {
    scalar?: string;
    deformation?: boolean;
    sectionCleared?: boolean;
  };
  expect(result).toEqual({ scalar: "temperature", deformation: true, sectionCleared: true });
  await expect.poll(() => drawnPixels(canvas)).toBe(true);
});

test("applies a public camera transition and restores a fitted view", async ({ page }) => {
  const { canvas, status } = await openCase(page, "camera");
  const result = JSON.parse((await status.getAttribute("data-detail")) ?? "{}") as {
    moved?: boolean;
  };
  expect(result.moved).toBe(true);
  await expect.poll(() => drawnPixels(canvas)).toBe(true);
});

test("weights transparent instances and changes exact element emphasis", async ({ page }) => {
  const { canvas } = await openCase(page, "transparency");
  await expect.poll(() => drawnPixels(canvas)).toBe(true);
  const initial = await pixelHash(canvas);
  await page.evaluate(() => {
    (
      window as typeof window & { femgxCore?: { toggleEmphasis?: () => void } }
    ).femgxCore?.toggleEmphasis?.();
  });
  await expect(page.locator("#core-status")).toHaveAttribute(
    "data-result",
    "transparency-emphasized",
  );
  await expect.poll(() => pixelHash(canvas)).not.toBe(initial);
});
