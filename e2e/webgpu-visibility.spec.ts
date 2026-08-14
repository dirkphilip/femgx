/** visibility ownership: GPU visibility and body-interface contracts. */

import { expect, test } from "@playwright/test";
import type * as Api from "../src/index";
import {
  canvasRgba,
  differingPixelCount,
  loadWebGpuPage,
  requireHit,
  stableCanvasPixels,
} from "./webgpu-support";

function nodeAnnotationContributionAt(
  a: Buffer,
  b: Buffer,
  width: number,
  center: { readonly x: number; readonly y: number },
  radius = 6,
): number {
  let count = 0;
  for (let y = Math.floor(center.y) - radius; y <= Math.floor(center.y) + radius; y += 1) {
    for (let x = Math.floor(center.x) - radius; x <= Math.floor(center.x) + radius; x += 1) {
      const offset = (y * width + x) * 4;
      if (
        Math.abs((a[offset] ?? 0) - (b[offset] ?? 0)) > 8 ||
        Math.abs((a[offset + 1] ?? 0) - (b[offset + 1] ?? 0)) > 8 ||
        Math.abs((a[offset + 2] ?? 0) - (b[offset + 2] ?? 0)) > 8
      ) {
        count += 1;
      }
    }
  }
  return count;
}

test("exposes independent body visibility and highlight controls", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("assembly-expand-5").click();
  const canvas = page.getByTestId("view-canvas");
  const body = page.getByTestId("body-vis-6-2");
  const glow = page.getByTestId("body-highlight-6-2");
  await expect(body).toBeChecked();
  await expect(glow).toHaveAttribute("data-active", "false");

  const baseline = await stableCanvasPixels(page, canvas);
  await body.uncheck();
  await expect(body).not.toBeChecked();
  const hidden = await stableCanvasPixels(page, canvas);
  expect(hidden.equals(baseline), "hiding one body must change the WebGPU frame").toBe(false);

  await body.check();
  await glow.click();
  await expect(glow).toHaveAttribute("data-active", "true");
  await expect(body).toBeChecked();
  const styled = await stableCanvasPixels(page, canvas);
  expect(styled.equals(baseline), "body highlight must change the WebGPU frame").toBe(false);
});

test("keeps shared node annotations while an incident owner remains visible", async ({ page }) => {
  await page.goto("/");
  const hasWebGpu = await page.evaluate(() => "gpu" in navigator);
  if (!hasWebGpu) test.skip(true, "WebGPU is unavailable in this browser environment");

  const sharedNode = await page.evaluate(async () => {
    const modulePath = "/src/index.ts";
    const api = (await import(/* @vite-ignore */ modulePath)) as typeof Api;
    document.body.innerHTML =
      '<canvas id="node-owner-visibility" style="display:block;width:640px;height:420px"></canvas>';
    const canvas = document.getElementById("node-owner-visibility");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("node visibility canvas missing");
    const part = api.createPart(1, {
      positions: new Float32Array([-1, -0.5, 0, 0, -0.5, 0, -0.5, 0.5, 0, 1, -0.5, 0, 0.5, 0.5, 0]),
      indices: new Uint32Array([0, 1, 2, 1, 3, 4]),
      primitive: "triangles",
      nodePickIds: new Uint32Array([1, 2, 3, 4, 5]),
      nodePositions: new Float32Array([
        -1, -0.5, 0, 0, -0.5, 0, -0.5, 0.5, 0, 1, -0.5, 0, 0.5, 0.5, 0,
      ]),
      elements: [
        { id: 1, primitiveStart: 0, primitiveCount: 1, bodyId: 1 },
        { id: 2, primitiveStart: 1, primitiveCount: 1, bodyId: 2 },
      ],
      bodies: [
        { id: 1, elementIds: [1] },
        { id: 2, elementIds: [2] },
      ],
    });
    const scene = api
      .createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "node-owner-visibility",
        placements: [{ kind: "part", partId: part.id, transform: api.identity() }],
      })
      .withRoot(1)
      .build();
    const viewport = await api.createFemViewport({
      canvas,
      scene,
      originTriad: false,
      background: "white",
      camera: api.createCamera({
        position: [0, 0, 3],
        target: [0, 0, 0],
        up: [0, 1, 0],
        orthoHeight: 2,
        width: 640,
        height: 420,
      }),
    });
    const nodes = api.setPartOverride(api.createInteractionState(), part.id, { nodes: true });
    const bodyHidden = api.setBodyVisible(nodes, { instanceId: "1/0", bodyId: 2 }, false);
    const elementHidden = api.setElementVisible(nodes, { instanceId: "1/0", elementId: 2 }, false);
    const withoutNodes = (state: Api.InteractionState) =>
      api.setPartOverride(state, part.id, { nodes: false });
    const state = window as Window & {
      __nodeOwnerVisibility?: {
        readonly viewport: Api.FemViewport;
        readonly bodyHidden: Api.InteractionState;
        readonly bodyHiddenWithoutNodes: Api.InteractionState;
        readonly elementHidden: Api.InteractionState;
        readonly elementHiddenWithoutNodes: Api.InteractionState;
      };
    };
    state.__nodeOwnerVisibility = {
      viewport,
      bodyHidden,
      bodyHiddenWithoutNodes: withoutNodes(bodyHidden),
      elementHidden,
      elementHiddenWithoutNodes: withoutNodes(elementHidden),
    };
    viewport.setInteraction(bodyHidden);
    const projected = api.projectPoint(viewport.camera, [0, -0.5, 0]);
    if (projected === undefined) throw new Error("shared node projected behind the camera");
    return projected;
  });

  const canvas = page.locator("#node-owner-visibility");
  await expect(canvas).toBeVisible();
  const size = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("node visibility canvas missing");
    return {
      width: element.width,
      scaleX: element.width / element.clientWidth,
      scaleY: element.height / element.clientHeight,
    };
  });
  const capture = async (
    state: "bodyHiddenWithoutNodes" | "elementHidden" | "elementHiddenWithoutNodes",
  ) => {
    await page.evaluate((name) => {
      const owner = (window as Window & { __nodeOwnerVisibility?: Record<string, unknown> })
        .__nodeOwnerVisibility;
      const viewport = owner?.["viewport"] as Api.FemViewport | undefined;
      const interaction = owner?.[name] as Api.InteractionState | undefined;
      if (viewport === undefined || interaction === undefined)
        throw new Error("node state missing");
      viewport.setInteraction(interaction);
    }, state);
    await stableCanvasPixels(page, canvas);
    return canvasRgba(page, canvas);
  };
  await stableCanvasPixels(page, canvas);
  const bodyHidden = await canvasRgba(page, canvas);
  const bodyHiddenWithoutNodes = await capture("bodyHiddenWithoutNodes");
  const elementHidden = await capture("elementHidden");
  const elementHiddenWithoutNodes = await capture("elementHiddenWithoutNodes");

  expect(
    nodeAnnotationContributionAt(bodyHidden, bodyHiddenWithoutNodes, size.width, {
      x: sharedNode[0] * size.scaleX,
      y: sharedNode[1] * size.scaleY,
    }),
    "a node shared with a visible body must remain annotated",
  ).toBeGreaterThan(0);
  expect(
    nodeAnnotationContributionAt(elementHidden, elementHiddenWithoutNodes, size.width, {
      x: sharedNode[0] * size.scaleX,
      y: sharedNode[1] * size.scaleY,
    }),
    "a node exposed by hiding one element must remain annotated",
  ).toBeGreaterThan(0);
});

test("exposes and restores body interfaces in visible picking", async ({ page }) => {
  await loadWebGpuPage(page);
  await page.getByTestId("assembly-expand-5").click();
  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const rect = {
    left: 0,
    top: 0,
    right: box.width,
    bottom: box.height,
    width: box.width,
    height: box.height,
  };
  const region = async (granularity: string): Promise<readonly Record<string, unknown>[]> =>
    page.evaluate(
      async ({ rect: value, granularity: level }) => {
        const demo = (
          window as typeof window & {
            femgxDemo?: {
              pickRegion?: (
                selection: typeof value,
                requested: string,
              ) => Promise<readonly Record<string, unknown>[]>;
            };
          }
        ).femgxDemo;
        return (await demo?.pickRegion?.(value, level)) ?? [];
      },
      { rect, granularity },
    );
  const baselineFaces = await region("face");
  const baselineFrame = await stableCanvasPixels(page, canvas);
  const body = page.getByTestId("body-vis-6-2");
  await body.uncheck();
  await expect(body).not.toBeChecked();
  const exposedFrame = await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(baselineFrame, exposedFrame),
    "hiding a body should change the rendered visible surface",
  ).toBeGreaterThan(200);
  const exposedFaces = await region("face");
  expect(exposedFaces.length, "hiding a body should preserve visible face coverage").toBe(
    baselineFaces.length,
  );
  expect(exposedFaces.every((target) => target["kind"] === "face")).toBe(true);

  await body.check();
  await expect(body).toBeChecked();
  const restoredFrame = await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(exposedFrame, restoredFrame),
    "restoring the body should bring the hidden surface back",
  ).toBeGreaterThan(200);
  await expect
    .poll(async () => JSON.stringify(await region("face")))
    .toBe(JSON.stringify(baselineFaces));
});

test("hides and restores one element occurrence through the GPU path", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const target = await requireHit(
    page,
    canvas,
    { fresh: true },
    "GPU picking must resolve an element-owned target",
  );
  const baseline = await stableCanvasPixels(page, canvas);

  await page.mouse.move(target.x, target.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(target.x, target.y, { button: "right" });
  await page.keyboard.up("Shift");
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".menu-title").first()).toHaveText(/^Element \d+$/);
  await menu.locator('button[data-action="hide-element"]').click();

  const hidden = await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(baseline, hidden),
    "hiding one element must change the rendered frame",
  ).toBeGreaterThan(50);

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const emptyPoint = { x: box.x + 5, y: box.y + 5 };
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await page.waitForTimeout(150);
  await page.mouse.click(emptyPoint.x, emptyPoint.y, { button: "right" });
  await expect(menu).toBeVisible();
  await menu.locator('button[data-action="show-all"]').click();
  const restored = await stableCanvasPixels(page, canvas);
  expect(
    differingPixelCount(hidden, restored),
    "show all must restore the hidden element surface",
  ).toBeGreaterThan(50);
});
