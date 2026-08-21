import { expect, test, type Locator } from "@playwright/test";

const HOST = "/e2e/core/core-host.html";

interface EdgeProbe {
  readonly covered?: readonly [number, number];
  readonly interiorNode?: readonly [number, number];
  readonly exteriorNode?: readonly [number, number];
  readonly shallow?: readonly [number, number];
  readonly steep?: readonly [number, number];
}

interface NodeShape {
  readonly coloredPixels: number;
  readonly quadrants: readonly number[];
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
      const nodeShapes = await orangeNodeShapesNear(canvas, [
        requireProbe(probes.interiorNode, "interior node"),
        requireProbe(probes.exteriorNode, "exterior node"),
      ]);
      expectInteriorNodeCoverage(nodeShapes[0]);
      expectExteriorNodeDisc(nodeShapes[1]);
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

function requireProbe(
  point: readonly [number, number] | undefined,
  label: string,
): readonly [number, number] {
  if (point === undefined) throw new Error(`missing ${label} probe`);
  return point;
}

function expectInteriorNodeCoverage(shape: NodeShape | undefined): void {
  if (shape === undefined) throw new Error("missing interior node shape");
  // Adjacent surface depth legitimately clips one side; broad area and three
  // occupied quadrants still distinguish a glyph from one procedural triangle.
  expect(shape.coloredPixels).toBeGreaterThanOrEqual(20);
  expect(shape.quadrants.filter((count) => count > 0).length).toBeGreaterThanOrEqual(3);
}

function expectExteriorNodeDisc(shape: NodeShape | undefined): void {
  if (shape === undefined) throw new Error("missing exterior node shape");
  expect(shape.coloredPixels).toBeGreaterThanOrEqual(40);
  expect(Math.min(...shape.quadrants)).toBeGreaterThanOrEqual(5);
}

async function orangeNodeShapesNear(
  canvas: Locator,
  points: readonly (readonly [number, number])[],
): Promise<readonly NodeShape[]> {
  const encoded = (await canvas.screenshot()).toString("base64");
  return canvas.page().evaluate(
    async ({ base64, points }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const snapshot = document.createElement("canvas");
      snapshot.width = bitmap.width;
      snapshot.height = bitmap.height;
      const context = snapshot.getContext("2d");
      if (context === null) throw new Error("no node screenshot context");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return points.map(([pointX, pointY]) => {
        const pixels = context.getImageData(
          Math.round(pointX) - 6,
          Math.round(pointY) - 6,
          13,
          13,
        ).data;
        let coloredPixels = 0;
        const quadrants = [0, 0, 0, 0];
        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index] ?? 0;
          const green = pixels[index + 1] ?? 0;
          const blue = pixels[index + 2] ?? 0;
          if (!(red > 180 && green > 60 && green < 180 && blue < 80)) continue;
          const pixel = index / 4;
          const x = pixel % 13;
          const y = Math.floor(pixel / 13);
          coloredPixels += 1;
          const quadrant = (y < 6 ? 0 : 2) + (x < 6 ? 0 : 1);
          quadrants[quadrant] = (quadrants[quadrant] ?? 0) + 1;
        }
        return { coloredPixels, quadrants };
      });
    },
    { base64: encoded, points },
  );
}
