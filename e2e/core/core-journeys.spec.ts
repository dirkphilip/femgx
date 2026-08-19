import { writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { drawnPixels, pixelHash, pixelMetrics } from "../browser-support/helpers";

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

interface HardwareAdapterEvidence {
  readonly architecture: string;
  readonly description: string;
  readonly device: string;
  readonly isFallbackAdapter: boolean;
  readonly vendor: string;
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

test("renders distinct occurrence results while keeping one reusable part batch", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const { canvas, status } = await openCase(page, "occurrence-results");
    const result = JSON.parse((await status.getAttribute("data-detail")) ?? "{}") as {
      parts?: number;
      batches?: number;
      shared?: boolean;
      override?: boolean;
    };
    expect(result).toEqual({ parts: 1, batches: 1, shared: true, override: true });
    await expect.poll(() => drawnPixels(canvas)).toBe(true);
    const colors = await occurrenceResultPixels(canvas, page);
    expect(colors.blue).toBeGreaterThan(100);
    expect(colors.red).toBeGreaterThan(100);
  }
});

test("renders the copyable dense host integration at desktop and mobile", async ({
  page,
}, testInfo) => {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 720 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/examples/host-integration/");
    await expect(page.locator("#diagnostics")).toHaveText("Model validation passed");
    const canvas = page.locator("#viewport");
    await expect.poll(async () => (await pixelMetrics(canvas)).distinctColors).toBeGreaterThan(20);
    expect((await pixelMetrics(canvas)).saturatedPixels).toBeGreaterThan(100);
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error("Host integration canvas has no bounds");
    const modelY = viewport.name === "desktop" ? 0.25 : 0.4;
    await canvas.click({ position: { x: bounds.width * 0.25, y: bounds.height * modelY } });
    await expect(page.locator("#inspection")).toContainText(/von Mises|displacement/u);
    await page.screenshot({
      path: testInfo.outputPath(`host-integration-${viewport.name}.png`),
      fullPage: true,
    });
  }
});

test("captures bounded hardware-WebGPU conformance evidence", async ({ page }, testInfo) => {
  const captures: Array<{
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly distinctColors: number;
    readonly saturatedPixels: number;
    readonly hash: string;
    readonly screenshot: string;
  }> = [];
  let adapter: HardwareAdapterEvidence | null = null;
  for (const viewport of [
    { name: "desktop", width: 1280, height: 720 },
    { name: "mobile-390x844", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const { canvas, status } = await openCase(page, "hardware-conformance");
    const detail = JSON.parse((await status.getAttribute("data-detail")) ?? "{}") as {
      projection?: string;
      scalar?: string;
      section?: boolean;
      selectedAndHighlighted?: boolean;
      transparentOccurrence?: boolean;
      region?: number;
      picked?: string;
    };
    expect(detail).toEqual({
      projection: "perspective",
      scalar: "conformance-scalar",
      section: true,
      selectedAndHighlighted: true,
      transparentOccurrence: true,
      region: 2,
      picked: "face",
    });
    adapter ??= await readHardwareAdapter(page);
    expect(adapter).not.toBeNull();
    expect(adapter?.isFallbackAdapter).toBe(false);
    expect(`${adapter?.vendor} ${adapter?.device} ${adapter?.description}`).not.toMatch(
      /swiftshader|llvmpipe|lavapipe|software/i,
    );
    const metrics = await pixelMetrics(canvas);
    expect(metrics.distinctColors).toBeGreaterThan(32);
    expect(metrics.saturatedPixels).toBeGreaterThan(1_000);
    const face = page.locator('[data-femgx-orientation-gizmo="true"] [data-view-face="front"]');
    const before = await face.locator("polygon").getAttribute("points");
    await page
      .locator('[data-femgx-orientation-gizmo="true"] [data-view-corner="+++"] circle')
      .click();
    await expect.poll(() => face.locator("polygon").getAttribute("points")).not.toBe(before);
    const screenshot = `hardware-conformance-${viewport.name}.png`;
    await page.screenshot({ path: testInfo.outputPath(screenshot), fullPage: true });
    captures.push({ ...viewport, ...metrics, screenshot });
  }
  const evidence = {
    schemaVersion: 1,
    kind: "hardware-webgpu-conformance",
    capturedAt: new Date().toISOString(),
    target: process.env["FEMGX_CONFORMANCE_TARGET"] ?? null,
    gitSha: process.env["GITHUB_SHA"] ?? "local",
    platform: process.platform,
    architecture: process.arch,
    browser: { name: "Google Chrome", version: page.context().browser()?.version() ?? "unknown" },
    adapter,
    assertions: {
      perspective: true,
      scalarColors: true,
      selectedAndHighlighted: true,
      transparency: true,
      sectionCaps: true,
      picking: true,
      orientationGizmo: true,
    },
    captures,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(testInfo.outputPath("hardware-conformance.json"), serialized, "utf8");
  await testInfo.attach("hardware-conformance", {
    body: serialized,
    contentType: "application/json",
  });
});

async function readHardwareAdapter(page: Page): Promise<HardwareAdapterEvidence | null> {
  return page.evaluate(async () => {
    const resolved = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (resolved === null) return null;
    const { architecture, description, device, isFallbackAdapter, vendor } = resolved.info;
    return { architecture, description, device, isFallbackAdapter, vendor };
  });
}

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

async function occurrenceResultPixels(
  canvas: Locator,
  page: Page,
): Promise<{ readonly blue: number; readonly red: number }> {
  const encoded = (await canvas.screenshot()).toString("base64");
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const image = document.createElement("canvas");
    image.width = bitmap.width;
    image.height = bitmap.height;
    const context = image.getContext("2d");
    if (context === null) throw new Error("no 2d context for occurrence result evidence");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let blue = 0;
    let red = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index] ?? 0;
      const g = data[index + 1] ?? 0;
      const b = data[index + 2] ?? 0;
      if (b > 80 && b > r * 1.5 && b > g * 1.2) blue += 1;
      if (r > 80 && r > b * 2 && r > g * 1.2) red += 1;
    }
    bitmap.close();
    return { blue, red };
  }, encoded);
}
