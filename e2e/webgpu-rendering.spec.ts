/** rendering ownership: GPU pixels, overlays, and visual contracts. */

import { expect, test } from "@playwright/test";
import type * as Api from "../src/index";
import {
  sweepForHit,
  stableCanvasPixels,
  canvasRgba,
  differingPixelCount,
  visiblePixelCount,
  yellowComponents,
  hasYellowPixel,
  selectedLuminanceSpread,
  luminancePatch,
  nodeContribution,
  clearHover,
  dragCamera,
  toggleElementHighlight,
  projectCameraPoint,
  readNavigationState,
  requireHit,
  setSelectionGranularity,
  rendererMode,
  loadWebGpuPage,
} from "./webgpu-support";

function brightenedNodePixelCount(withoutNodes: Buffer, withNodes: Buffer): number {
  let count = 0;
  for (let index = 0; index + 2 < Math.min(withoutNodes.length, withNodes.length); index += 4) {
    const before =
      (withoutNodes[index] ?? 0) + (withoutNodes[index + 1] ?? 0) + (withoutNodes[index + 2] ?? 0);
    const after =
      (withNodes[index] ?? 0) + (withNodes[index + 1] ?? 0) + (withNodes[index + 2] ?? 0);
    if (
      after > before + 36 &&
      (withNodes[index] ?? 0) > 100 &&
      (withNodes[index + 1] ?? 0) > 100 &&
      (withNodes[index + 2] ?? 0) > 100
    ) {
      count += 1;
    }
  }
  return count;
}

test("keeps selection feedback visible in edge overlay mode", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }

  // Sweep until GPU pick resolves any target; the selected key encodes its
  // granularity as a prefix (n:/f:/e:/i:/p:).
  const hoverPoint = await requireHit(
    page,
    canvas,
    { attribute: "hovered", settleMs: 150, fresh: true },
    "GPU picking must resolve selection feedback on the hardware WebGPU lane",
  );

  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).not.toBe("");
  const selected = (await canvas.getAttribute("data-selected")) ?? "";

  // Edge overlay keeps the emphasis: the label flips and the demo still renders
  // the selected key in the next frame.
  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBeNull();
  expect(await canvas.getAttribute("data-selected")).toBe(selected);

  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  expect(await canvas.getAttribute("data-selected")).toBe(selected);
});

test("renders and switches the built-in viewport backgrounds", async ({ page }) => {
  await page.goto("/");
  const hasWebGpu = await page.evaluate(() => "gpu" in navigator);
  if (!hasWebGpu) test.skip(true, "WebGPU is unavailable in this browser environment");

  await page.evaluate(async () => {
    const modulePath = "/src/index.ts";
    const api = (await import(/* @vite-ignore */ modulePath)) as typeof Api;
    document.body.innerHTML =
      '<canvas id="background-test" style="display:block;width:640px;height:420px"></canvas>';
    const canvas = document.getElementById("background-test");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("background canvas missing");
    const part = api.createPart(1, {
      positions: new Float32Array([-0.8, -0.6, 0, 0.8, -0.6, 0, 0, 0.7, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles",
    });
    const scene = api
      .createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "background-test",
        placements: [{ kind: "part", partId: 1, transform: api.identity() }],
      })
      .withRoot(1)
      .build();
    const viewport = await api.createFemViewport({ canvas, scene, background: "studio" });
    (window as Window & { __backgroundViewport?: typeof viewport }).__backgroundViewport = viewport;
  });

  const canvas = page.locator("#background-test");
  await expect(canvas).toBeVisible();
  await stableCanvasPixels(page, canvas);
  const studio = await canvasRgba(page, canvas);
  const canvasSize = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("background canvas missing");
    return { width: element.width, height: element.height };
  });
  const studioTop = luminancePatch(
    studio,
    canvasSize.width,
    canvasSize.width * 0.1,
    canvasSize.height * 0.1,
  );
  const studioBottom = luminancePatch(
    studio,
    canvasSize.width,
    canvasSize.width * 0.1,
    canvasSize.height * 0.9,
  );
  expect(studioTop.mean, "studio's upper field must be lighter").toBeGreaterThan(studioBottom.mean);
  expect(
    studioTop.mean - studioBottom.mean,
    "studio must retain a visibly meaningful top-to-bottom luminance separation",
  ).toBeGreaterThanOrEqual(32);
  expect(
    studioTop.mean - studioBottom.mean,
    "studio must remain restrained rather than becoming a high-contrast effect",
  ).toBeLessThanOrEqual(80);
  await page.evaluate(() =>
    (
      window as Window & { __backgroundViewport?: { setBackground: (background: "white") => void } }
    ).__backgroundViewport?.setBackground("white"),
  );
  await stableCanvasPixels(page, canvas);
  const white = await canvasRgba(page, canvas);
  await page.evaluate(() =>
    (
      window as Window & { __backgroundViewport?: { setBackground: (background: "dark") => void } }
    ).__backgroundViewport?.setBackground("dark"),
  );
  await stableCanvasPixels(page, canvas);
  const dark = await canvasRgba(page, canvas);

  expect(
    differingPixelCount(studio, white),
    "studio and white must present different pixels",
  ).toBeGreaterThan(1000);
  expect(
    differingPixelCount(white, dark),
    "white and dark must present different pixels",
  ).toBeGreaterThan(1000);
  await page.evaluate(() =>
    (
      window as Window & { __backgroundViewport?: { destroy: () => void } }
    ).__backgroundViewport?.destroy(),
  );
});

test("preserves element identity for shared indexed surface corners", async ({ page }) => {
  await page.goto("/");
  const hasWebGpu = await page.evaluate(() => "gpu" in navigator);
  if (!hasWebGpu) test.skip(true, "WebGPU is unavailable in this browser environment");

  const hits = await page.evaluate(async () => {
    const modulePath = "/src/index.ts";
    const api = (await import(/* @vite-ignore */ modulePath)) as typeof Api;
    document.body.innerHTML =
      '<canvas id="shared-index-test" style="display:block;width:640px;height:420px"></canvas>';
    const canvas = document.getElementById("shared-index-test");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("shared-index canvas missing");
    const part = api.createPart(1, {
      positions: new Float32Array([-0.9, -0.8, 0, 0, -0.8, 0, 0, 0.8, 0, 0.9, 0.8, 0]),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
      primitive: "triangles",
      elements: [
        { id: 10, primitiveStart: 0, primitiveCount: 1 },
        { id: 20, primitiveStart: 1, primitiveCount: 1 },
      ],
    });
    const scene = api
      .createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "shared-index-test",
        placements: [{ kind: "part", partId: 1, transform: api.identity() }],
      })
      .withRoot(1)
      .build();
    const viewport = await api.createFemViewport({
      canvas,
      scene,
      camera: api.createCamera({
        position: [0, 0, 2],
        target: [0, 0, 0],
        up: [0, 1, 0],
        orthoHeight: 2.2,
        width: 640,
        height: 420,
      }),
      background: "dark",
    });
    const pickAt = async (point: [number, number, number]) => {
      const projected = api.projectPoint(viewport.camera, point);
      if (projected === undefined) throw new Error("shared-index point projected behind camera");
      const [x, y] = projected;
      return viewport.pick(x, y);
    };
    const left = await pickAt([-0.3, -0.25, 0]);
    const right = await pickAt([0.3, 0.25, 0]);
    viewport.destroy();
    return { left, right };
  });

  expect(hits.left).toMatchObject({ kind: "element", elementId: 10 });
  expect(hits.right).toMatchObject({ kind: "element", elementId: 20 });
});

test("renders the persistent world-origin triad without scene identity", async ({ page }) => {
  await page.goto("/");
  const hasWebGpu = await page.evaluate(() => "gpu" in navigator);
  if (!hasWebGpu) test.skip(true, "WebGPU is unavailable in this browser environment");

  await page.evaluate(async () => {
    const modulePath = "/src/index.ts";
    const api = (await import(/* @vite-ignore */ modulePath)) as typeof Api;
    document.body.innerHTML =
      '<canvas id="origin-triad-test" style="display:block;width:640px;height:420px"></canvas>';
    const canvas = document.getElementById("origin-triad-test");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("origin triad canvas missing");
    const scene = api
      .createScene()
      .addAssembly({ id: 1, name: "empty", placements: [] })
      .withRoot(1)
      .build();
    const viewport = await api.createFemViewport({ canvas, scene, background: "dark" });
    const state = window as Window & {
      __originTriadApi?: typeof api;
      __originTriadViewport?: typeof viewport;
    };
    state.__originTriadApi = api;
    state.__originTriadViewport = viewport;
  });

  const canvas = page.locator("#origin-triad-test");
  await expect(canvas).toBeVisible();
  const captureTriad = async () => {
    await stableCanvasPixels(page, canvas);
    const pixels = await canvasRgba(page, canvas);
    const width = await canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error("origin triad canvas missing");
      return element.width;
    });
    return triadPixelEnvelope(pixels, width);
  };
  const baseline = await captureTriad();
  const pixels = await canvasRgba(page, canvas);
  const dominantPixels = (
    rgba: Buffer,
    channel: number,
    otherA: number,
    otherB: number,
  ): number => {
    let count = 0;
    for (let index = 0; index + 2 < rgba.length; index += 4) {
      const value = rgba[index + channel] ?? 0;
      if (
        value > 100 &&
        value > (rgba[index + otherA] ?? 0) + 35 &&
        value > (rgba[index + otherB] ?? 0) + 35
      ) {
        count += 1;
      }
    }
    return count;
  };
  expect(dominantPixels(pixels, 0, 1, 2), "persistent red X axis").toBeGreaterThan(0);
  expect(dominantPixels(pixels, 1, 0, 2), "persistent green Y axis").toBeGreaterThan(0);
  expect(dominantPixels(pixels, 2, 0, 1), "persistent blue Z axis").toBeGreaterThan(0);
  const baselineWidth = baseline.width;
  for (const label of ["zoom out", "orthographic", "perspective", "resize"]) {
    await page.evaluate(
      ({ action }: { action: string }) => {
        const state = window as Window & {
          __originTriadApi?: typeof Api;
          __originTriadViewport?: {
            camera: Api.Camera;
            setCamera: (camera: Api.Camera, options?: { durationMs?: number }) => void;
          };
        };
        const api = state.__originTriadApi;
        const viewport = state.__originTriadViewport;
        if (api === undefined || viewport === undefined)
          throw new Error("origin triad state missing");
        if (action === "zoom in") {
          viewport.setCamera(api.zoomCamera(viewport.camera, -1), { durationMs: 0 });
        } else if (action === "zoom out") {
          viewport.setCamera(api.zoomCamera(viewport.camera, 1), { durationMs: 0 });
        } else if (action === "orthographic") {
          viewport.setCamera(api.setProjection(viewport.camera, "orthographic"), { durationMs: 0 });
        } else if (action === "perspective") {
          viewport.setCamera(api.setProjection(viewport.camera, "perspective"), { durationMs: 0 });
        } else {
          const canvas = document.getElementById("origin-triad-test");
          if (!(canvas instanceof HTMLCanvasElement))
            throw new Error("origin triad canvas missing");
          canvas.style.width = "480px";
          canvas.style.height = "320px";
        }
      },
      { action: label },
    );
    const envelope = await captureTriad();
    expect(envelope.width, `${label} triad remains visible`).toBeGreaterThan(0);
    expect(envelope.height, `${label} triad remains visible`).toBeGreaterThan(0);
    if (label === "zoom out") expect(envelope.width).toBeLessThan(baselineWidth);
  }
  await page.evaluate(() =>
    (
      window as Window & { __originTriadViewport?: { destroy: () => void } }
    ).__originTriadViewport?.destroy(),
  );

  await page.evaluate(async () => {
    const modulePath = "/src/index.ts";
    const api = (await import(/* @vite-ignore */ modulePath)) as typeof Api;
    document.body.innerHTML =
      '<canvas id="origin-triad-disabled-test" style="display:block;width:640px;height:420px"></canvas>';
    const canvas = document.getElementById("origin-triad-disabled-test");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("disabled triad canvas missing");
    const scene = api
      .createScene()
      .addAssembly({ id: 1, name: "empty", placements: [] })
      .withRoot(1)
      .build();
    const viewport = await api.createFemViewport({
      canvas,
      scene,
      originTriad: false,
      background: "dark",
    });
    (
      window as Window & { __disabledOriginTriadViewport?: typeof viewport }
    ).__disabledOriginTriadViewport = viewport;
  });
  const disabledCanvas = page.locator("#origin-triad-disabled-test");
  await expect(disabledCanvas).toBeVisible();
  await stableCanvasPixels(page, disabledCanvas);
  const disabledPixels = await canvasRgba(page, disabledCanvas);
  expect(dominantPixels(disabledPixels, 0, 1, 2), "disabled red X axis").toBe(0);
  expect(dominantPixels(disabledPixels, 1, 0, 2), "disabled green Y axis").toBe(0);
  expect(dominantPixels(disabledPixels, 2, 0, 1), "disabled blue Z axis").toBe(0);
  await page.evaluate(() =>
    (
      window as Window & { __disabledOriginTriadViewport?: { destroy: () => void } }
    ).__disabledOriginTriadViewport?.destroy(),
  );
});

function triadPixelEnvelope(
  rgba: Buffer,
  width: number,
): { readonly width: number; readonly height: number } {
  const height = Math.floor(rgba.length / 4 / width);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = rgba[offset] ?? 0;
      const green = rgba[offset + 1] ?? 0;
      const blue = rgba[offset + 2] ?? 0;
      const axisPixel =
        (red > 80 && red > green + 24 && red > blue + 24) ||
        (green > 80 && green > red + 24 && green > blue + 24) ||
        (blue > 80 && blue > red + 24 && blue > green + 24);
      if (!axisPixel) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    width: maxX >= minX ? maxX - minX + 1 : 0,
    height: maxY >= minY ? maxY - minY + 1 : 0,
  };
}

test("element emphasis changes the rendered pixels and toggles off again", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  await expect.poll(() => canvas.getAttribute("data-frames"), { timeout: 10_000 }).not.toBeNull();

  // Baseline: no interaction, so the canvas holds only the deterministic model.
  const baseline = await stableCanvasPixels(page, canvas);

  const hoverPoint = await requireHit(
    page,
    canvas,
    { attribute: "hovered", settleMs: 150, fresh: true },
    "GPU picking must resolve element emphasis on the hardware WebGPU lane",
  );

  // Emphasize the element under the pointer, then clear the hover so the
  // pixel comparison isolates the emphasis. If element emphasis ever renders
  // invisibly again (a WGSL/CPU record-layout desync like #69), the settled
  // pixels never differ from the baseline and this assertion fails.
  await toggleElementHighlight(page, hoverPoint);
  await clearHover(page, canvas);
  const emphasized = await stableCanvasPixels(page, canvas);
  expect(
    emphasized.equals(baseline),
    "element emphasis must render as visibly different pixels",
  ).toBe(false);

  // Toggling the emphasis off must visibly remove the emphasized frame.
  await toggleElementHighlight(page, hoverPoint);
  await clearHover(page, canvas);
  const restored = await stableCanvasPixels(page, canvas);
  expect(
    restored.equals(emphasized),
    "clearing the emphasis must change the emphasized frame",
  ).toBe(false);
});

test("renders element nodes as a separate visible annotation pass", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("gallery");

  const canvas = page.getByTestId("view-canvas");
  const withNodes = await stableCanvasPixels(page, canvas);
  const nodeToggle = page.getByTestId("node-overlay");
  await nodeToggle.click();
  await expect(nodeToggle).toHaveAttribute("aria-pressed", "false");
  const withoutNodes = await stableCanvasPixels(page, canvas);
  expect(withoutNodes.equals(withNodes), "node glyphs must change the rendered pixels").toBe(false);
  const withNodesRgba = await canvasRgba(page, canvas);
  expect(
    visiblePixelCount(withNodesRgba),
    "the node pass must preserve the resolved surface instead of presenting black",
  ).toBeGreaterThan(withNodesRgba.length / 16);

  await nodeToggle.click();
  await expect(nodeToggle).toHaveAttribute("aria-pressed", "true");
  const restored = await stableCanvasPixels(page, canvas);
  expect(restored.equals(withoutNodes), "showing node glyphs must change the plain frame").toBe(
    false,
  );
});

test("keeps Hex20 node annotations neutral over elemental results", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("hex20-cylinder");
  const canvas = page.getByTestId("view-canvas");
  const nodeToggle = page.getByTestId("node-overlay");
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  await expect(nodeToggle).toHaveAttribute("aria-pressed", "true");

  await nodeToggle.click();
  await stableCanvasPixels(page, canvas);
  const withoutNodes = await canvasRgba(page, canvas);
  await nodeToggle.click();
  await stableCanvasPixels(page, canvas);
  const withNodes = await canvasRgba(page, canvas);

  expect(
    brightenedNodePixelCount(withoutNodes, withNodes),
    "neutral node annotations must not inject brighter elemental-result colors",
  ).toBeLessThan(400);
});

test("renders complete point sprites with authored node picks", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("gallery");
  await setSelectionGranularity(page, "node");
  await page.getByTestId("node-overlay").click();
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "false");
  await page
    .locator('[data-femgx-orientation-gizmo="true"]')
    .evaluate((gizmo) => ((gizmo as HTMLElement).style.visibility = "hidden"));
  const pointVisibility = page.locator("input[data-instance-id]");
  const pointInput = page
    .locator(".visibility-row.visibility-part")
    .filter({ hasText: "Built-in helper · Point" })
    .locator("input[data-instance-id]");
  await expect(pointInput).toHaveCount(1);
  const pointInstanceId = await pointInput.getAttribute("data-instance-id");
  if (pointInstanceId === null) throw new Error("Point helper row has no instance identity");
  for (const input of await pointVisibility.all()) {
    if ((await input.getAttribute("data-instance-id")) !== pointInstanceId) await input.uncheck();
  }
  await page.getByTestId("fit-view").click();
  // The toolbar overlays the canvas and covers the three highest fitted points;
  // hide it after fitting so this pixel contract measures authored sprites, not
  // DOM occlusion.
  await page.locator(".toolbar").evaluate((toolbar) => {
    const element = toolbar as HTMLElement;
    element.style.opacity = "0";
    element.style.pointerEvents = "none";
  });

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const withoutNodeOverlay = await stableCanvasPixels(page, canvas);
  await page.getByTestId("node-overlay").click();
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
  const withNodeOverlay = await stableCanvasPixels(page, canvas);
  expect(
    withNodeOverlay.equals(withoutNodeOverlay),
    "Point parts must not receive a duplicate node annotation overlay",
  ).toBe(true);
  const rgba = await canvasRgba(page, canvas);
  const width = Math.round(box.width);
  const components = yellowComponents(rgba, width).filter(isFullSizePointSprite);
  expect(
    components,
    "gallery point elements must produce one full-size glyph per authored point",
  ).toHaveLength(27);
  for (const [index, bounds] of components.entries()) {
    const centerX = Math.round((bounds.minX + bounds.maxX) / 2);
    const centerY = Math.round((bounds.minY + bounds.maxY) / 2);
    expect(
      bounds.maxX - bounds.minX,
      `point ${index} must have horizontal coverage`,
    ).toBeGreaterThan(5);
    expect(bounds.maxY - bounds.minY, `point ${index} must have vertical coverage`).toBeGreaterThan(
      5,
    );
    for (const [label, x, y] of [
      ["left", bounds.minX + 2, centerY],
      ["right", bounds.maxX - 2, centerY],
      ["top", centerX, bounds.minY + 2],
      ["bottom", centerX, bounds.maxY - 2],
    ] as const) {
      expect(
        hasYellowPixel(rgba, width, x, y),
        `point ${index} must cover its ${label} cardinal`,
      ).toBe(true);
    }
  }

  // Keep the pick probe below the transparent toolbar; this checks the same
  // authored point path without depending on browser hit routing at its edge.
  const firstPoint = components.find((bounds) => bounds.minY > 132) ?? components[0];
  if (firstPoint === undefined) throw new Error("point sprite coverage has no first glyph");
  await canvas.evaluate((node) => {
    (node as HTMLElement).dataset["hovered"] = "";
  });
  await page.mouse.move(
    box.x + (firstPoint.minX + firstPoint.maxX) / 2,
    box.y + (firstPoint.minY + firstPoint.maxY) / 2,
  );
  await expect.poll(() => canvas.getAttribute("data-hovered"), { timeout: 2_000 }).toMatch(/^n:/);
});

interface QuadraticSurfaceTarget {
  readonly label: string;
  readonly elementId: number;
  readonly nodeId: number;
  readonly worldPoint: readonly [number, number, number];
}

const QUADRATIC_SURFACE_TARGETS: readonly QuadraticSurfaceTarget[] = [
  {
    label: "Built-in helper · Tri6",
    elementId: 11,
    nodeId: 3,
    worldPoint: [15.5, 0, 0],
  },
  {
    label: "Built-in helper · Quad8",
    elementId: 12,
    nodeId: 4,
    worldPoint: [16, 3, 0],
  },
];

test("renders and picks authored Tri6 and Quad8 mid-edge nodes on desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("gallery");
  const canvas = page.getByTestId("view-canvas");
  const instances = page.locator("input[data-instance-id]");
  await page.locator(".toolbar").evaluate((toolbar) => {
    const element = toolbar as HTMLElement;
    element.style.opacity = "0";
    element.style.pointerEvents = "none";
  });

  const exerciseTarget = async (target: QuadraticSurfaceTarget): Promise<void> => {
    const row = page.locator(".visibility-row.visibility-part").filter({ hasText: target.label });
    const input = row.locator("input[data-instance-id]");
    await expect(input).toHaveCount(1);
    const instanceId = await input.getAttribute("data-instance-id");
    if (instanceId === null) throw new Error(`${target.label} has no instance identity`);
    for (const instance of await instances.all()) {
      if ((await instance.getAttribute("data-instance-id")) !== instanceId) {
        await instance.uncheck();
      }
    }

    await input.check();
    await page.getByTestId("fit-view").click();
    await stableCanvasPixels(page, canvas);
    expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(100);

    await setSelectionGranularity(page, "face");
    const face = await requireHit(
      page,
      canvas,
      { prefix: "f:", attribute: "pick", fresh: true },
      `${target.label} must resolve a face through GPU picking`,
    );
    expect(face.key).toBe(`f:${instanceId}:${target.elementId}:0`);
    await page.mouse.click(face.x, face.y);
    await expect.poll(() => canvas.getAttribute("data-selected")).toBe(face.key);

    await page.keyboard.down("Shift");
    await page.mouse.click(face.x, face.y);
    await page.keyboard.up("Shift");
    await expect
      .poll(() => canvas.getAttribute("data-selected"))
      .toBe(`e:${instanceId}:${target.elementId}`);

    const navigation = await readNavigationState(canvas);
    const projected = projectCameraPoint(navigation.camera, target.worldPoint);
    if (projected === undefined)
      throw new Error(`${target.label} mid-edge node is behind the camera`);
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("canvas has no bounding box");
    const nodePoint = { x: box.x + projected[0], y: box.y + projected[1] };
    const nodeKey = `n:${instanceId}:${target.nodeId}`;
    await setSelectionGranularity(page, "node");
    const offsets: Array<readonly [number, number]> = [[0, 0]];
    for (let radius = 2; radius <= 20; radius += 2) {
      for (const [x, y] of [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ] as const) {
        offsets.push([x * radius, y * radius]);
      }
    }
    let node: { readonly x: number; readonly y: number; readonly key: string } | undefined;
    for (const [offsetX, offsetY] of offsets) {
      const x = nodePoint.x + offsetX;
      const y = nodePoint.y + offsetY;
      await canvas.evaluate((element) => {
        (element as HTMLElement).dataset["hovered"] = "";
      });
      await page.mouse.move(x, y);
      await page.waitForTimeout(80);
      if ((await canvas.getAttribute("data-hovered")) === nodeKey) {
        node = { x, y, key: nodeKey };
        break;
      }
    }
    if (node === undefined) {
      throw new Error(`${target.label} did not resolve its projected mid-edge node`);
    }
    expect(Math.hypot(node.x - nodePoint.x, node.y - nodePoint.y)).toBeLessThan(32);
    await page.mouse.click(node.x, node.y);
    await expect.poll(() => canvas.getAttribute("data-selected")).toBe(nodeKey);
  };

  for (const target of QUADRATIC_SURFACE_TARGETS) await exerciseTarget(target);

  await page.setViewportSize({ width: 390, height: 844 });
  for (const target of QUADRATIC_SURFACE_TARGETS) {
    await exerciseTarget(target);
    expect(
      visiblePixelCount(await canvasRgba(page, canvas)),
      `${target.label} must remain visible in the mobile WebGPU frame`,
    ).toBeGreaterThan(100);
  }
});

function isFullSizePointSprite(bounds: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): boolean {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return width > 5 && width <= 10 && height > 5 && height <= 10;
}

interface CentralColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function centralColor(rgba: Buffer, width: number, radius = 12): CentralColor {
  const height = Math.floor(rgba.length / 4 / width);
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = Math.floor(height / 2) - radius; y <= Math.floor(height / 2) + radius; y += 1) {
    for (let x = Math.floor(width / 2) - radius; x <= Math.floor(width / 2) + radius; x += 1) {
      const offset = (y * width + x) * 4;
      red += rgba[offset] ?? 0;
      green += rgba[offset + 1] ?? 0;
      blue += rgba[offset + 2] ?? 0;
      count += 1;
    }
  }
  return { red: red / count, green: green / count, blue: blue / count };
}

function colorDifference(a: CentralColor, b: CentralColor): number {
  return Math.max(Math.abs(a.red - b.red), Math.abs(a.green - b.green), Math.abs(a.blue - b.blue));
}

test("composes the transparency fixture and picks its nearest translucent face", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("transparency");
  await setSelectionGranularity(page, "face");

  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-model", "transparency");
  const frame = await stableCanvasPixels(page, canvas);
  const rgba = await canvasRgba(page, canvas);
  expect(
    visiblePixelCount(rgba),
    "the transparency composite must preserve visible geometry",
  ).toBeGreaterThan(rgba.length / 16);
  expect(frame.equals(await stableCanvasPixels(page, canvas))).toBe(true);

  const hit = await sweepForHit(page, canvas, { prefix: "f:", attribute: "pick", fresh: true });
  expect(hit, "the nearest translucent shell face must remain pickable").not.toBeUndefined();
  expect(hit?.key).toMatch(/^f:31\/1:/);
  await page.mouse.click(hit?.x ?? 0, hit?.y ?? 0);
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe(hit?.key);
  await stableCanvasPixels(page, canvas);
  const selectedRgba = await canvasRgba(page, canvas);
  expect(
    differingPixelCount(rgba, selectedRgba),
    "selected translucent faces must have visible emphasis",
  ).toBeGreaterThan(100);

  const visibility = page.locator("input[data-instance-id]");
  await expect(visibility).toHaveCount(4);
  for (const index of [0, 2, 3]) await visibility.nth(index).uncheck();
  await stableCanvasPixels(page, canvas);
  const selectedShellOnlyRgba = await canvasRgba(page, canvas);
  for (const index of [0, 2, 3]) await visibility.nth(index).check();
  expect(
    differingPixelCount(selectedRgba, selectedShellOnlyRgba),
    "selected translucent shells must preserve interior geometry behind the front face",
  ).toBeGreaterThan(500);
});

test("weights nearer equal-opacity layers without registration-order dependence", async ({
  page,
}) => {
  await page.goto("/");
  const hasWebGpu = await page.evaluate(() => "gpu" in navigator);
  if (!hasWebGpu) test.skip(true, "WebGPU is unavailable in this browser environment");

  const canvas = page.locator("#depth-weight-test");
  const assertDepthWeight = async (viewportSize: {
    readonly width: number;
    readonly height: number;
  }) => {
    await page.setViewportSize(viewportSize);
    await page.evaluate(() => {
      document.body.innerHTML =
        '<canvas id="depth-weight-test" style="display:block;width:min(640px,100vw);height:420px"></canvas>';
    });
    await expect(canvas).toBeVisible();

    const renderLayers = async (
      reverseRegistration: boolean,
      cameraZ: number,
    ): Promise<CentralColor> => {
      await page.evaluate(
        async ({ reverseRegistration: reverse, cameraZ: z }) => {
          const modulePath = "/src/index.ts";
          const api = (await import(/* @vite-ignore */ modulePath)) as typeof Api;
          const state = window as typeof window & {
            __depthWeightViewport?: { destroy: () => void };
          };
          state.__depthWeightViewport?.destroy();
          const createLayer = (id: number) =>
            api.createPart(id, {
              positions: new Float32Array([
                -0.75, -0.6, 0, 0.75, -0.6, 0, 0.75, 0.6, 0, -0.75, 0.6, 0,
              ]),
              indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
              primitive: "triangles",
            });
          const red = createLayer(1);
          const green = createLayer(2);
          const orderedParts = reverse ? [green, red] : [red, green];
          let builder = api.createScene();
          for (const part of orderedParts) builder = builder.addPart(part);
          const redPlacement = {
            kind: "part" as const,
            partId: 1,
            transform: api.translation(0, 0, 0.45),
          };
          const greenPlacement = {
            kind: "part" as const,
            partId: 2,
            transform: api.translation(0, 0, -0.45),
          };
          const placements = reverse
            ? [greenPlacement, redPlacement]
            : [redPlacement, greenPlacement];
          const scene = builder
            .addAssembly({ id: 1, name: "depth-weight-test", placements })
            .withRoot(1)
            .build();
          let interaction = api.createInteractionState();
          interaction = api.setPartOverride(interaction, 1, {
            color: { r: 1, g: 0, b: 0, a: 1 },
            opacity: 0.5,
            edge: false,
            nodes: false,
          });
          interaction = api.setPartOverride(interaction, 2, {
            color: { r: 0, g: 1, b: 0, a: 1 },
            opacity: 0.5,
            edge: false,
            nodes: false,
          });
          const canvas = document.getElementById("depth-weight-test");
          if (!(canvas instanceof HTMLCanvasElement))
            throw new Error("depth-weight canvas missing");
          const viewport = await api.createFemViewport({
            canvas,
            scene,
            interaction,
            originTriad: false,
            background: "white",
            camera: api.createCamera({
              position: [0, 0, z],
              target: [0, 0, 0],
              up: [0, 1, 0],
              near: 0.1,
              far: 4,
              orthoHeight: 2,
              width: 640,
              height: 420,
            }),
          });
          state.__depthWeightViewport = viewport;
        },
        { reverseRegistration, cameraZ },
      );
      await stableCanvasPixels(page, canvas);
      const bounds = await canvas.boundingBox();
      if (bounds === null) throw new Error("depth-weight canvas has no bounds");
      return centralColor(await canvasRgba(page, canvas), Math.round(bounds.width));
    };

    const redNear = await renderLayers(false, 2);
    const redNearReversed = await renderLayers(true, 2);
    const greenNear = await renderLayers(false, -2);
    await page.evaluate(() => {
      const state = window as typeof window & {
        __depthWeightViewport?: { destroy: () => void };
      };
      state.__depthWeightViewport?.destroy();
    });

    expect(redNear.red - redNear.green, "the nearer red layer must dominate").toBeGreaterThan(5);
    expect(
      greenNear.green - greenNear.red,
      "reversing the camera must favor the nearer green layer",
    ).toBeGreaterThan(5);
    expect(
      colorDifference(redNear, redNearReversed),
      "registration order must not change the frame",
    ).toBeLessThan(2);
    expect(
      Math.abs(redNear.blue - greenNear.blue),
      "coverage must remain stable when depth roles swap",
    ).toBeLessThan(2);
  };

  await assertDepthWeight({ width: 1280, height: 720 });
  await assertDepthWeight({ width: 390, height: 844 });
});

test("removes zero-alpha shell overlays without removing their picks", async ({ page }) => {
  await loadWebGpuPage(page, "/?testAlphaZero");
  await page.getByTestId("model-select").selectOption("transparency");

  const canvas = page.getByTestId("view-canvas");
  const instanceVisibility = page.locator("input[data-instance-id]");
  await expect(instanceVisibility).toHaveCount(4);

  // The transparency fixture orders its opaque interior first, followed by
  // the shell and the two overlapping zero-alpha placements. Hiding the
  // latter gives a pixel baseline for the interior's own overlays.
  for (const index of [1, 2, 3]) await instanceVisibility.nth(index).uncheck();
  const interiorOnly = await stableCanvasPixels(page, canvas);

  for (const index of [1, 2, 3]) await instanceVisibility.nth(index).check();
  const alphaZeroFrame = await stableCanvasPixels(page, canvas);
  expect(
    alphaZeroFrame.equals(interiorOnly),
    "zero-alpha shell and overlap parts must add no edge or node pixels",
  ).toBe(true);

  const hit = await sweepForHit(page, canvas, { prefix: "f:", attribute: "pick", fresh: true });
  expect(hit, "zero-alpha shell geometry must remain pickable").not.toBeUndefined();
  expect(hit?.key).toMatch(/^f:31\/1:/);
});

test("keeps element edges and nodes visible after orbiting", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  for (const delta of [
    { x: 90, y: 35 },
    { x: -150, y: 55 },
  ]) {
    await dragCamera(page, canvas, delta);
    const withNodes = await stableCanvasPixels(page, canvas);
    await page.getByTestId("node-overlay").click();
    const withoutNodes = await stableCanvasPixels(page, canvas);
    expect(withoutNodes.equals(withNodes), "nodes must remain visible after orbiting").toBe(false);
    await page.getByTestId("node-overlay").click();
  }
});

test("keeps depth-tested node annotations stable across fine zoom steps", async ({ page }) => {
  await loadWebGpuPage(page);
  await page
    .getByTestId("model-select")
    .selectOption({ label: "Element tessellation and mapping gallery" });
  // Hide the gallery's hardware point/line overlays so the measured delta is
  // only the depth-tested node annotation pass.
  await page.getByTestId("instance-vis-0").uncheck();
  await page.getByTestId("instance-vis-1").uncheck();
  await page.getByTestId("fit-view").click();

  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  const contributions: number[] = [];
  for (let step = 0; step < 8; step++) {
    contributions.push(await nodeContribution(page));
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(50);
  }

  const baseline = contributions[0];
  expect(contributions.length).toBeGreaterThan(0);
  expect(baseline).toBeGreaterThan(40);
  if (baseline === undefined) return;

  for (const [index, count] of contributions.entries()) {
    expect(count, `node contribution must stay visible at zoom step ${index}`).toBeGreaterThan(40);
    expect(
      count,
      `node contribution must not collapse across zoom (step ${index}: ${String(count)} vs ${String(baseline)})`,
    ).toBeGreaterThan(baseline * 0.05);
    expect(
      count,
      `node contribution must not explode from flicker/leakage (step ${index}: ${String(count)} vs ${String(baseline)})`,
    ).toBeLessThan(baseline * 12);
  }
});

test("keeps a picked face's flat lighting stable through close zoom", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const edgeToggle = page.getByTestId("edge-overlay");
  const nodeToggle = page.getByTestId("node-overlay");
  await setSelectionGranularity(page, "face");
  if ((await edgeToggle.getAttribute("aria-pressed")) === "true") await edgeToggle.click();
  if ((await nodeToggle.getAttribute("aria-pressed")) === "true") await nodeToggle.click();

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const width = Math.round(box.width);

  for (const projection of ["Perspective", "Orthographic"] as const) {
    if ((await page.getByTestId("projection-toggle").textContent()) !== projection) {
      await page.getByTestId("projection-toggle").click();
      await expect(page.getByTestId("projection-toggle")).toHaveText(projection);
    }
    await page.getByTestId("fit-view").click();
    const hit = await requireHit(
      page,
      canvas,
      { prefix: "f:", attribute: "pick", fresh: true },
      "GPU picking must resolve a face for the close-zoom lighting test",
    );
    const worldPoint = await page.evaluate(
      async ({ x, y }) => {
        const harness = (
          window as typeof window & {
            femgxDemo?: {
              pickPoint: (pointX: number, pointY: number) => Promise<readonly number[] | undefined>;
            };
          }
        ).femgxDemo;
        return (await harness?.pickPoint(x, y)) ?? null;
      },
      { x: hit.x - box.x, y: hit.y - box.y },
    );
    if (worldPoint === null || worldPoint.length !== 3) {
      throw new Error("face pick returned no world point");
    }

    const samples = [];
    for (let step = 0; step < 4; step += 1) {
      await stableCanvasPixels(page, canvas);
      const projected = projectCameraPoint(
        (await readNavigationState(canvas)).camera,
        worldPoint as readonly [number, number, number],
      );
      if (projected === undefined)
        throw new Error(`picked face left the view at zoom step ${step}`);
      await page.mouse.move(box.x + projected[0], box.y + projected[1]);
      await expect.poll(() => canvas.getAttribute("data-hovered")).toBe(hit.key);
      const patch = luminancePatch(
        await canvasRgba(page, canvas),
        width,
        projected[0],
        projected[1],
      );
      samples.push(patch);
      expect(patch.count).toBeGreaterThan(0);
      if (step < 3) {
        await page.mouse.wheel(0, -200);
        await stableCanvasPixels(page, canvas);
      }
    }

    const baseline = samples[0];
    if (baseline === undefined) throw new Error("lighting sample has no baseline");
    expect(baseline.mean).toBeGreaterThan(32);
    for (const [step, sample] of samples.entries()) {
      expect(
        sample.mean,
        `flat-face luminance must remain visible at ${projection} zoom step ${step}`,
      ).toBeGreaterThan(baseline.mean * 0.8);
      expect(
        Math.abs(sample.mean - baseline.mean),
        `flat-face luminance must remain stable at ${projection} zoom step ${step}`,
      ).toBeLessThan(Math.max(18, baseline.mean * 0.18));
    }
  }
});

test("keeps depth-tested edges behind the single edges control", async ({ page }) => {
  await loadWebGpuPage(page);

  await expect(page.getByTestId("renderer-status")).toContainText("Renderer webgpu");
  await expect(page.getByTestId("depth-test")).toHaveCount(0);
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
});

test("keeps the solid frame deterministic across page loads", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const first = await stableCanvasPixels(page, canvas);

  await page.reload();
  await expect.poll(() => rendererMode(page)).toBe("webgpu");
  const second = await stableCanvasPixels(page, canvas);

  expect(first.equals(second), "base pixel output must be deterministic").toBe(true);
});

test("renders a distinct edge-overlay frame", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const solid = await stableCanvasPixels(page, canvas);

  await page.getByTestId("edge-overlay").click();
  const edge = await stableCanvasPixels(page, canvas);

  expect(edge.equals(solid), "edge mode must render different pixels than solid").toBe(false);
});

test("keeps selected volume faces lit, distinct, and reversible with overlays", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-select").selectOption("results");
  await expect(canvas).toHaveAttribute("data-model", "results");
  await page.getByTestId("result-field").selectOption("__base__");
  await expect(page.getByTestId("result-field")).toHaveValue("__base__");
  await dragCamera(page, canvas, { x: 64, y: 24 });
  const hoverPoint = await requireHit(
    page,
    canvas,
    { attribute: "hovered", settleMs: 150, fresh: true },
    "GPU picking must resolve selected-face lighting on the hardware WebGPU lane",
  );

  await clearHover(page, canvas);
  await canvas.evaluate((element) => {
    (element.parentElement as HTMLElement).blur();
  });
  const before = await stableCanvasPixels(page, canvas);
  const baselineRgba = await canvasRgba(page, canvas);
  await page.keyboard.down("Shift");
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);
  await clearHover(page, canvas);
  const selected = await stableCanvasPixels(page, canvas);
  const selectedRgba = await canvasRgba(page, canvas);

  expect(selected.equals(before), "selecting an instance must change the rendered pixels").toBe(
    false,
  );
  expect(
    selectedLuminanceSpread(baselineRgba, selectedRgba),
    "differently oriented selected volume faces must retain useful lighting contrast",
  ).toBeGreaterThan(18);

  await page.keyboard.down("Shift");
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe("");
  await clearHover(page, canvas);
  await canvas.evaluate((element) => {
    (element.parentElement as HTMLElement).blur();
  });
  await page.locator(".inspection").evaluate((element) => {
    element.setAttribute("hidden", "");
  });
  const deselected = await stableCanvasPixels(page, canvas);
  expect(
    deselected.equals(before),
    "deselection must restore the ordinary surface appearance",
  ).toBe(true);

  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
  const overlaid = await stableCanvasPixels(page, canvas);
  await page.keyboard.down("Shift");
  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^e:/);
  await clearHover(page, canvas);
  const selectedOverlaid = await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(overlaid, selectedOverlaid),
    "selected volume must remain clear when edges and nodes are enabled",
  ).toBeGreaterThan(200);
});

test("reveals internal faces for an exactly selected adjacent Hex8 element", async ({ page }) => {
  await page.goto("/");
  const hasWebGpu = await page.evaluate(() => "gpu" in navigator);
  if (!hasWebGpu) test.skip(true, "WebGPU is unavailable in this browser environment");

  await page.evaluate(async () => {
    const modulePath = "/src/index.ts";
    const api = (await import(/* @vite-ignore */ modulePath)) as typeof Api;
    document.body.innerHTML =
      '<canvas id="adjacent-hex-selection" style="display:block;width:640px;height:420px"></canvas>';
    const canvas = document.getElementById("adjacent-hex-selection");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("adjacent Hex8 canvas missing");

    const nodes: number[] = [];
    for (let x = 0; x <= 3; x += 1) {
      nodes.push(x, -0.75, -0.75, x, 0.75, -0.75, x, -0.75, 0.75, x, 0.75, 0.75);
    }
    const elements = [0, 1, 2].map((x) => {
      const left = x * 4;
      const right = left + 4;
      return api.createElement(x + 1, api.HEX8_SHAPE, [
        left,
        right,
        right + 1,
        left + 1,
        left + 2,
        right + 2,
        right + 3,
        left + 3,
      ]);
    });
    const model = api.createElementModel(nodes, elements);
    const part = api.heterogeneousElementParts({ triangle: 1 }, model).triangle;
    if (part === undefined) throw new Error("adjacent Hex8 triangle part missing");
    const scene = api
      .createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "adjacent-hex-selection",
        placements: [{ kind: "part", partId: part.id, transform: api.identity() }],
      })
      .withRoot(1)
      .build();
    const viewport = await api.createFemViewport({
      canvas,
      scene,
      originTriad: false,
      background: "dark",
      camera: api.createCamera({
        position: [5, 0, 0],
        target: [1.5, 0, 0],
        up: [0, 1, 0],
        orthoHeight: 2.5,
        width: 640,
        height: 420,
      }),
    });
    const ordinary = api.createInteractionState();
    const selected = api.setTargetSelected(
      ordinary,
      { kind: "element", instanceId: "1/0", elementId: 2 },
      true,
    );
    (window as Window & { __adjacentHexSelection?: typeof viewport }).__adjacentHexSelection =
      viewport;
    viewport.setInteraction(ordinary);
    (window as Window & { __adjacentHexOrdinary?: typeof ordinary }).__adjacentHexOrdinary =
      ordinary;
    (window as Window & { __adjacentHexSelected?: typeof selected }).__adjacentHexSelected =
      selected;
  });

  const canvas = page.locator("#adjacent-hex-selection");
  await expect(canvas).toBeVisible();
  const width = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("adjacent Hex8 canvas missing");
    return element.width;
  });
  await stableCanvasPixels(page, canvas);
  const ordinary = await canvasRgba(page, canvas);
  const ordinaryCenter = luminancePatch(ordinary, width, width / 2, 210, 18);

  await page.evaluate(() => {
    const state = window as Window & {
      __adjacentHexSelection?: { setInteraction: (interaction: Api.InteractionState) => void };
      __adjacentHexSelected?: Api.InteractionState;
    };
    if (state.__adjacentHexSelection === undefined || state.__adjacentHexSelected === undefined) {
      throw new Error("adjacent Hex8 selection state missing");
    }
    state.__adjacentHexSelection.setInteraction(state.__adjacentHexSelected);
  });
  await stableCanvasPixels(page, canvas);
  const selected = await canvasRgba(page, canvas);
  const selectedCenter = luminancePatch(selected, width, width / 2, 210, 18);

  expect(
    Math.abs(selectedCenter.mean - ordinaryCenter.mean),
    "the selected middle element must reveal its hidden shared faces through the neighboring solids",
  ).toBeGreaterThan(3);
  expect(
    differingPixelCount(ordinary, selected),
    "exact element selection must produce a visible selection frame",
  ).toBeGreaterThan(100);

  await page.setViewportSize({ width: 390, height: 844 });
  await canvas.evaluate((element) => {
    element.style.width = "390px";
    element.style.height = "420px";
  });
  const mobileWidth = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("adjacent Hex8 canvas missing");
    return element.width;
  });
  await page.evaluate(() => {
    const state = window as Window & {
      __adjacentHexSelection?: { setInteraction: (interaction: Api.InteractionState) => void };
      __adjacentHexOrdinary?: Api.InteractionState;
    };
    if (state.__adjacentHexSelection === undefined || state.__adjacentHexOrdinary === undefined) {
      throw new Error("adjacent Hex8 ordinary state missing");
    }
    state.__adjacentHexSelection.setInteraction(state.__adjacentHexOrdinary);
  });
  await stableCanvasPixels(page, canvas);
  const mobileOrdinary = await canvasRgba(page, canvas);
  await page.evaluate(() => {
    const state = window as Window & {
      __adjacentHexSelection?: { setInteraction: (interaction: Api.InteractionState) => void };
      __adjacentHexSelected?: Api.InteractionState;
    };
    if (state.__adjacentHexSelection === undefined || state.__adjacentHexSelected === undefined) {
      throw new Error("adjacent Hex8 selected state missing");
    }
    state.__adjacentHexSelection.setInteraction(state.__adjacentHexSelected);
  });
  await stableCanvasPixels(page, canvas);
  const mobileSelected = await canvasRgba(page, canvas);
  expect(
    visiblePixelCount(mobileSelected),
    "mobile WebGPU output must remain visible",
  ).toBeGreaterThan(100);
  expect(
    differingPixelCount(mobileOrdinary, mobileSelected),
    "mobile exact element selection must reveal the internal faces",
  ).toBeGreaterThan(100);
  expect(
    Math.abs(
      luminancePatch(mobileOrdinary, mobileWidth, mobileWidth / 2, 210, 18).mean -
        luminancePatch(mobileSelected, mobileWidth, mobileWidth / 2, 210, 18).mean,
    ),
  ).toBeGreaterThan(1);

  await page.evaluate(() => {
    (
      window as Window & { __adjacentHexSelection?: { destroy: () => void } }
    ).__adjacentHexSelection?.destroy();
  });
});

test("renders imported VTK scalar and nodal displacement results on desktop and mobile", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-select").selectOption("vtk");
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  await stableCanvasPixels(page, canvas);
  const deformed = await canvasRgba(page, canvas);
  expect(
    visiblePixelCount(deformed),
    "imported VTK results must render visible desktop pixels",
  ).toBeGreaterThan(100);

  await page.getByTestId("result-field").selectOption("__base__");
  await expect(canvas).toHaveAttribute("data-results", "base");
  await stableCanvasPixels(page, canvas);
  const base = await canvasRgba(page, canvas);
  expect(
    differingPixelCount(deformed, base),
    "clearing imported VTK results must change the rendered frame",
  ).toBeGreaterThan(100);

  await page.setViewportSize({ width: 390, height: 844 });
  await stableCanvasPixels(page, canvas);
  const mobileBase = await canvasRgba(page, canvas);
  expect(
    visiblePixelCount(mobileBase),
    "imported VTK geometry and result state must remain visible on mobile",
  ).toBeGreaterThan(100);
  await page.getByTestId("result-field").selectOption("vtk-stress");
  await expect(canvas).toHaveAttribute("data-results", "colored");
  await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(mobileBase, await canvasRgba(page, canvas)),
    "the imported scalar field must remain renderable on mobile",
  ).toBeGreaterThan(100);
});

test("keeps result contours readable through face selection", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("results");
  await setSelectionGranularity(page, "face");
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("result-field").selectOption("demo-stress");
  await page.getByTestId("deformation-field").selectOption("__off__");
  await expect(page.getByTestId("result-field")).toHaveValue("demo-stress");

  const hit = await requireHit(
    page,
    canvas,
    { prefix: "f:", attribute: "hovered", fresh: true },
    "GPU picking must resolve a result-colored face before selection",
  );
  await clearHover(page, canvas);
  await stableCanvasPixels(page, canvas);
  const baselineRgba = await canvasRgba(page, canvas);
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe(hit.key);
  await clearHover(page, canvas);
  await stableCanvasPixels(page, canvas);
  const selectedRgba = await canvasRgba(page, canvas);

  expect(
    differingPixelCount(baselineRgba, selectedRgba),
    "face selection must remain visible in results",
  ).toBeGreaterThan(100);
  expect(
    selectedLuminanceSpread(baselineRgba, selectedRgba),
    "selection must not flatten result-colored face contrast",
  ).toBeGreaterThan(18);
});

test("preserves selected nodal result rendering across every display mode", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption("results");
  await setSelectionGranularity(page, "face");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "f:", attribute: "hovered", fresh: true },
    "GPU picking must resolve a face before cycling nodal result modes",
  );
  await clearHover(page, canvas);
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).toBe(hit.key);

  const modes = ["deformed", "base", "colored", "deformed"] as const;
  for (const [index, expectedMode] of modes.entries()) {
    await expect(canvas).toHaveAttribute("data-results", expectedMode);
    await expect.poll(() => canvas.getAttribute("data-selected")).toBe(hit.key);
    await stableCanvasPixels(page, canvas);
    expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(100);
    if (index === 0) await page.getByTestId("result-field").selectOption("__base__");
    else if (index === 1) await page.getByTestId("result-field").selectOption("demo-stress");
    else if (index === 2)
      await page.getByTestId("deformation-field").selectOption("demo-displacement");
  }
});

test("preserves selected nodal colors when results are replaced after upload", async ({ page }) => {
  await page.goto("/");
  const hasWebGpu = await page.evaluate(() => "gpu" in navigator);
  if (!hasWebGpu) test.skip(true, "WebGPU is unavailable in this browser environment");

  await page.evaluate(async () => {
    const modulePath = "/src/index.ts";
    const api = (await import(/* @vite-ignore */ modulePath)) as typeof Api;
    document.body.innerHTML =
      '<canvas id="nodal-results-test" style="display:block;width:640px;height:420px"></canvas>';
    const canvas = document.getElementById("nodal-results-test");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("nodal-results canvas missing");
    const part = api.createPart(1, {
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      primitive: "triangles",
      nodePickIds: new Uint32Array([1, 2, 3, 4]),
      nodePositions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      elements: [{ id: 10, primitiveStart: 0, primitiveCount: 2 }],
      faces: [
        {
          elementId: 10,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 2,
          key: "0,1,2,3",
          nodeIds: [0, 1, 2, 3],
          neighborElementIds: [],
        },
      ],
    });
    const scene = api
      .createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "nodal-results",
        placements: [{ kind: "part", partId: 1, transform: api.identity() }],
      })
      .withRoot(1)
      .build();
    const scalar = api.createResultField({
      id: "nodal-scalar",
      name: "Nodal scalar",
      location: "nodal",
      shape: "scalar",
      count: 4,
      unit: "u",
      values: new Float32Array([0, 1, 2, 3]),
    });
    const scalarB = api.createResultField({
      id: "nodal-scalar-b",
      name: "Nodal scalar B",
      location: "nodal",
      shape: "scalar",
      count: 4,
      unit: "u",
      values: new Float32Array([3, 2, 1, 0]),
    });
    const displacement = api.createResultField({
      id: "nodal-displacement",
      name: "Nodal displacement",
      location: "nodal",
      shape: "vector",
      count: 4,
      unit: "u",
      values: new Float32Array([0, 0, 0, 0.04, 0, 0, 0.04, 0.04, 0, 0, 0.04, 0]),
    });
    const displacementB = api.createResultField({
      id: "nodal-displacement-b",
      name: "Nodal displacement B",
      location: "nodal",
      shape: "vector",
      count: 4,
      unit: "u",
      values: new Float32Array([0, 0, 0, 0.02, 0, 0, 0.02, 0.03, 0, 0, 0.02, 0]),
    });
    const selected = api.setTargetSelected(
      api.createInteractionState(),
      { kind: "face", instanceId: "1/0", elementId: 10, faceIndex: 0 },
      true,
    );
    const viewport = await api.createFemViewport({
      canvas,
      scene,
      background: "dark",
      camera: api.createCamera({
        position: [0, 0, 4],
        target: [0, 0, 0],
        up: [0, 1, 0],
        orthoHeight: 2.8,
        width: 640,
        height: 420,
      }),
      results: { scalar: { field: scalar }, deformation: { field: displacement } },
    });
    viewport.setInteraction(selected);
    (
      window as Window & {
        __nodalResultsTest?: {
          readonly scalar: typeof scalar;
          readonly scalarB: typeof scalarB;
          readonly displacement: typeof displacement;
          readonly displacementB: typeof displacementB;
          readonly selected: typeof selected;
          readonly ordinary: typeof selected;
          readonly viewport: typeof viewport;
        };
      }
    ).__nodalResultsTest = {
      scalar,
      scalarB,
      displacement,
      displacementB,
      selected,
      ordinary: api.createInteractionState(),
      viewport,
    };
  });

  const canvas = page.locator("#nodal-results-test");
  const transition = async (mode: "base" | "colored" | "deformed") => {
    await page.evaluate((nextMode) => {
      const state = (
        window as Window & {
          __nodalResultsTest?: {
            readonly scalar: Api.ScalarField<"nodal">;
            readonly displacement: Api.VectorField<"nodal">;
            readonly viewport: Api.FemViewport;
          };
        }
      ).__nodalResultsTest;
      if (state === undefined) throw new Error("nodal-results state missing");
      if (nextMode === "base") state.viewport.clearResults();
      else if (nextMode === "colored")
        state.viewport.setResults({ scalar: { field: state.scalar } });
      else {
        state.viewport.setResults({
          scalar: { field: state.scalar },
          deformation: { field: state.displacement },
        });
      }
    }, mode);
  };

  for (const mode of ["deformed", "base", "colored", "deformed"] as const) {
    await transition(mode);
    await stableCanvasPixels(page, canvas);
    const selectedPixels = await canvasRgba(page, canvas);
    expect(
      visiblePixelCount(selectedPixels),
      `${mode} nodal frame must remain visible`,
    ).toBeGreaterThan(100);
    expect(
      await page.evaluate(() => {
        const state = (
          window as Window & {
            __nodalResultsTest?: {
              readonly selected: Api.InteractionState;
              readonly ordinary: Api.InteractionState;
              readonly viewport: Api.FemViewport;
            };
          }
        ).__nodalResultsTest;
        return state !== undefined && state.viewport.interaction === state.selected;
      }),
    ).toBe(true);
    await page.evaluate(() => {
      const state = (
        window as Window & {
          __nodalResultsTest?: {
            readonly selected: Api.InteractionState;
            readonly ordinary: Api.InteractionState;
            readonly viewport: Api.FemViewport;
          };
        }
      ).__nodalResultsTest;
      if (state === undefined) throw new Error("nodal-results state missing");
      state.viewport.setInteraction(state.ordinary);
    });
    await stableCanvasPixels(page, canvas);
    const ordinaryPixels = await canvasRgba(page, canvas);
    expect(
      differingPixelCount(ordinaryPixels, selectedPixels),
      `${mode} nodal selection must remain visible`,
    ).toBeGreaterThan(100);
    await page.evaluate(() => {
      const state = (
        window as Window & {
          __nodalResultsTest?: {
            readonly selected: Api.InteractionState;
            readonly ordinary: Api.InteractionState;
            readonly viewport: Api.FemViewport;
          };
        }
      ).__nodalResultsTest;
      if (state === undefined) throw new Error("nodal-results state missing");
      state.viewport.setInteraction(state.selected);
    });
  }

  const retained = await page.evaluate(async () => {
    const state = (
      window as Window & {
        __nodalResultsTest?: {
          readonly scalar: Api.ScalarField<"nodal">;
          readonly scalarB: Api.ScalarField<"nodal">;
          readonly displacement: Api.VectorField<"nodal">;
          readonly displacementB: Api.VectorField<"nodal">;
          readonly viewport: Api.FemViewport;
        };
      }
    ).__nodalResultsTest;
    if (state === undefined) throw new Error("nodal-results state missing");
    const scene = state.viewport.scene;
    const runtime = state.viewport.runtime;
    const camera = state.viewport.camera;
    const interaction = state.viewport.interaction;
    const visibleInstances = runtime.visibleCount;
    for (let step = 0; step < 100; step += 1) {
      const alternate = step % 2 === 1;
      state.viewport.setResults({
        scalar: { field: alternate ? state.scalarB : state.scalar },
        deformation: {
          field: alternate ? state.displacementB : state.displacement,
          scale: 1 + (step % 3) * 0.25,
        },
      });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    }
    return {
      scene: state.viewport.scene === scene,
      runtime: state.viewport.runtime === runtime,
      camera: state.viewport.camera === camera,
      interaction: state.viewport.interaction === interaction,
      visibleInstances: state.viewport.runtime.visibleCount === visibleInstances,
    };
  });
  expect(retained).toEqual({
    scene: true,
    runtime: true,
    camera: true,
    interaction: true,
    visibleInstances: true,
  });
  await stableCanvasPixels(page, canvas);
  expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(100);
});
