import { expect, test, type Locator, type Page } from "@playwright/test";
import { drawnPixels, pixelHash } from "../browser-support/helpers";

const HOST = "/e2e/core/core-host.html";

async function openCase(page: Page, name: string) {
  await page.goto(`${HOST}?case=${name}`);
  const status = page.locator("#core-status");
  const expected = name.startsWith("selection-precedence") ? "selection-all-elemental" : name;
  await expect(status).toHaveAttribute("data-result", expected, { timeout: 10_000 });
  return { canvas: page.locator("#core-canvas"), status };
}

interface OrangeMetrics {
  readonly pixels: number;
  readonly dominantRgb: number;
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

test("resolves raster point, region, authored-edge, and visibility interaction through Viewport", async ({
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

test("keeps selection color beneath highlight across minimal and feature admission", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const captures = new Map<string, OrangeMetrics>();
    for (const admission of ["minimal", "feature", "transparent"] as const) {
      const { canvas } = await openCase(page, `emphasis-${admission}`);
      captures.set(admission, await orangeMetrics(canvas, page));
    }
    expect(captures.get("minimal")?.pixels).toBeGreaterThan(0);
    expect(captures.get("feature")?.pixels).toBeGreaterThan(0);
    expect(captures.get("feature")?.dominantRgb).toBe(captures.get("minimal")?.dominantRgb);
    expect(captures.get("transparent")?.pixels).toBeGreaterThan(0);
  }
});

test("keeps equal-depth selected cues independent of fast-path order", async ({ page }) => {
  const captures = new Map<string, OrangeMetrics>();
  for (const order of ["forward", "reverse"] as const) {
    const { canvas, status } = await openCase(page, `selection-precedence-${order}`);
    captures.set(`${order}-elemental`, await orangeMetrics(canvas, page));
    await page.evaluate(() => {
      const host = window as typeof window & {
        femgxCore?: {
          setSelectionPhase?: (phase: "all-elemental-fractional") => void;
        };
      };
      host.femgxCore?.setSelectionPhase?.("all-elemental-fractional");
    });
    await expect(status).toHaveAttribute("data-result", "selection-all-elemental-fractional");
    captures.set(`${order}-fractional`, await orangeMetrics(canvas, page));
    await page.evaluate(() => {
      const host = window as typeof window & {
        femgxCore?: { setSelectionPhase?: (phase: "all-nodal") => void };
      };
      host.femgxCore?.setSelectionPhase?.("all-nodal");
    });
    await expect(status).toHaveAttribute("data-result", "selection-all-nodal");
    captures.set(`${order}-nodal`, await orangeMetrics(canvas, page));
    await page.evaluate(() => {
      const host = window as typeof window & {
        femgxCore?: { setSelectionPhase?: (phase: "all-but-one-elemental") => void };
      };
      host.femgxCore?.setSelectionPhase?.("all-but-one-elemental");
    });
    await expect(status).toHaveAttribute("data-result", "selection-all-but-one-elemental");
    captures.set(`${order}-partial`, await orangeMetrics(canvas, page));
  }
  expect(captures.get("forward-elemental")?.pixels).toBeGreaterThan(0);
  expect(captures.get("reverse-elemental")?.pixels).toBeGreaterThan(0);
  expect(captures.get("forward-elemental")?.dominantRgb).toBe(
    captures.get("reverse-elemental")?.dominantRgb,
  );
  expect(captures.get("forward-fractional")?.pixels).toBeGreaterThan(0);
  expect(captures.get("reverse-fractional")?.pixels).toBeGreaterThan(0);
  expect(captures.get("forward-fractional")?.dominantRgb).toBe(
    captures.get("reverse-fractional")?.dominantRgb,
  );
  expect(captures.get("forward-nodal")?.dominantRgb).toBe(
    captures.get("forward-elemental")?.dominantRgb,
  );
  expect(captures.get("reverse-nodal")?.dominantRgb).toBe(
    captures.get("forward-elemental")?.dominantRgb,
  );
  expect(captures.get("forward-partial")?.dominantRgb).toBe(
    captures.get("forward-elemental")?.dominantRgb,
  );
  expect(captures.get("reverse-partial")?.pixels).toBeGreaterThan(0);
  expect(captures.get("reverse-partial")?.dominantRgb).toBe(
    captures.get("forward-partial")?.dominantRgb,
  );

  const { canvas: behindCanvas } = await openCase(page, "selection-precedence-behind");
  expect((await orangeMetrics(behindCanvas, page)).pixels).toBe(0);
});

async function orangeMetrics(canvas: Locator, page: Page): Promise<OrangeMetrics> {
  const encoded = (await canvas.screenshot()).toString("base64");
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const image = document.createElement("canvas");
    image.width = bitmap.width;
    image.height = bitmap.height;
    const context = image.getContext("2d");
    if (context === null) throw new Error("no 2d context for selection evidence");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    const colors = new Map<number, number>();
    let pixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      if (red >= 200 && green >= 60 && green <= 190 && blue <= 80) {
        const rgb = (red << 16) | (green << 8) | blue;
        colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
        pixels += 1;
      }
    }
    let dominantRgb = 0;
    let dominantCount = 0;
    for (const [rgb, count] of colors) {
      if (count > dominantCount) {
        dominantRgb = rgb;
        dominantCount = count;
      }
    }
    bitmap.close();
    return { pixels, dominantRgb };
  }, encoded);
}
