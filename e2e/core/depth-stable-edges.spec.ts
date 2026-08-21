import { expect, test, type Locator } from "@playwright/test";

const HOST = "/e2e/core/core-host.html";

interface EdgeProbe {
  readonly covered?: readonly [number, number];
  readonly node?: readonly [number, number];
  readonly shallow?: readonly [number, number];
  readonly steep?: readonly [number, number];
}

test("keeps depth-visible native authored edges stable while retaining occlusion", async ({
  page,
}, testInfo) => {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 720 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const projection of ["perspective", "orthographic"] as const) {
      await page.goto(`${HOST}?case=depth-stable-edges-${projection}`);
      const canvas = page.locator("#core-canvas");
      const probes = await edgeProbes(page.locator("#core-status"));
      expect(await darkPixelsNear(canvas, probes.shallow)).toBeGreaterThan(0);
      expect(await darkPixelsNear(canvas, probes.steep)).toBeGreaterThan(0);
      expect(await orangePixelsNear(canvas, probes.node)).toBeGreaterThan(0);
      await page.screenshot({
        path: testInfo.outputPath(`depth-stable-${viewport.name}-${projection}.png`),
        fullPage: true,
      });
    }
  }

  await page.goto(`${HOST}?case=depth-edge-occlusion`);
  const canvas = page.locator("#core-canvas");
  const probes = await edgeProbes(page.locator("#core-status"));
  expect(await darkPixelsNear(canvas, probes.covered)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("depth-edge-occlusion.png"), fullPage: true });
});

async function edgeProbes(status: Locator): Promise<EdgeProbe> {
  await expect(status).toHaveAttribute("data-result", /depth-(stable-edges|edge-occlusion)/, {
    timeout: 10_000,
  });
  return JSON.parse((await status.getAttribute("data-detail")) ?? "{}") as EdgeProbe;
}

async function darkPixelsNear(
  canvas: Locator,
  point: readonly [number, number] | undefined,
): Promise<number> {
  if (point === undefined) throw new Error("missing edge probe");
  const encoded = (await canvas.screenshot()).toString("base64");
  return canvas.page().evaluate(
    async ({ base64, point: [x, y] }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const snapshot = document.createElement("canvas");
      snapshot.width = bitmap.width;
      snapshot.height = bitmap.height;
      const context = snapshot.getContext("2d");
      if (context === null) throw new Error("no edge screenshot context");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(Math.round(x) - 6, Math.round(y) - 6, 13, 13).data;
      let dark = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          (pixels[index] ?? 255) < 80 &&
          (pixels[index + 1] ?? 255) < 80 &&
          (pixels[index + 2] ?? 255) < 80
        ) {
          dark += 1;
        }
      }
      return dark;
    },
    { base64: encoded, point },
  );
}

async function orangePixelsNear(
  canvas: Locator,
  point: readonly [number, number] | undefined,
): Promise<number> {
  if (point === undefined) throw new Error("missing node probe");
  const encoded = (await canvas.screenshot()).toString("base64");
  return canvas.page().evaluate(
    async ({ base64, point: [x, y] }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const snapshot = document.createElement("canvas");
      snapshot.width = bitmap.width;
      snapshot.height = bitmap.height;
      const context = snapshot.getContext("2d");
      if (context === null) throw new Error("no node screenshot context");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(Math.round(x) - 6, Math.round(y) - 6, 13, 13).data;
      let orange = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        if (red > 180 && green > 60 && green < 180 && blue < 80) orange += 1;
      }
      return orange;
    },
    { base64: encoded, point },
  );
}
