import { expect, test, type Locator } from "@playwright/test";

const HOST = "/e2e/core/authored-interior-edges-host.html";

interface InteriorEdgeDetail {
  readonly edgeEnd?: readonly [number, number, number];
  readonly edgeKeys?: readonly string[];
  readonly edgeStart?: readonly [number, number, number];
  readonly pickKey?: string;
  readonly probe?: readonly [number, number, number];
  readonly visibleEdgeProbe?: readonly [number, number, number];
}

test("renders and picks an authored edge exposed by a cut cavity", async ({ page }, testInfo) => {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 720 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(HOST);
    const status = page.locator("#interior-edge-status");
    const detail = await interiorEdgeDetail(status);
    expect(detail.pickKey).toBe("0,1");
    expect(detail.edgeKeys).toContain("0,1");
    const canvas = page.locator("#interior-edge-canvas");
    await expect.poll(() => drawnPixels(canvas)).toBe(true);
    expect((await pixelStats(canvas, detail.visibleEdgeProbe))[1]).toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath(`authored-interior-edges-${viewport.name}.png`),
      fullPage: true,
    });
  }
});

async function interiorEdgeDetail(status: Locator): Promise<InteriorEdgeDetail> {
  await expect(status).toHaveAttribute("data-result", "authored-interior-edges-ready", {
    timeout: 10_000,
  });
  return JSON.parse((await status.getAttribute("data-detail")) ?? "{}") as InteriorEdgeDetail;
}

async function drawnPixels(canvas: Locator): Promise<boolean> {
  const encoded = (await canvas.screenshot()).toString("base64");
  return canvas.page().evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const sample = document.createElement("canvas");
    sample.width = bitmap.width;
    sample.height = bitmap.height;
    const context = sample.getContext("2d");
    if (context === null) throw new Error("no interior-edge screenshot context");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 37) < 25 || (pixels[index + 1] ?? 45) < 35) return true;
    }
    return false;
  }, encoded);
}

async function pixelStats(
  canvas: Locator,
  point: readonly [number, number, number] | undefined,
): Promise<readonly number[]> {
  if (point === undefined) throw new Error("missing interior-edge probe");
  const encoded = (await canvas.screenshot()).toString("base64");
  return canvas.page().evaluate(
    async ({ base64, point: [x, y] }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const sample = document.createElement("canvas");
      sample.width = bitmap.width;
      sample.height = bitmap.height;
      const context = sample.getContext("2d");
      if (context === null) throw new Error("no interior-edge stats context");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const left = Math.max(0, Math.round(x) - 6);
      const top = Math.max(0, Math.round(y) - 6);
      const pixels = context.getImageData(left, top, 13, 13).data;
      let minimum = 255;
      let dark = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        minimum = Math.min(
          minimum,
          pixels[index] ?? 255,
          pixels[index + 1] ?? 255,
          pixels[index + 2] ?? 255,
        );
        if ((pixels[index] ?? 255) < 120) dark += 1;
      }
      return [minimum, dark];
    },
    { base64: encoded, point },
  );
}
