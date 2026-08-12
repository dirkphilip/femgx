import { expect, test, type CDPSession } from "@playwright/test";
import {
  cameraDistance,
  drawnPixels,
  expectBoundsClippedSafely,
  panCameraSnapshot,
  projectCameraPoint,
  readNavigationState,
  requireHit,
  targetPlanePoint,
} from "./helpers";

const BASE_URL = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:5173";

type TouchEventType = "touchStart" | "touchMove" | "touchEnd" | "touchCancel";

interface TouchPoint {
  readonly x: number;
  readonly y: number;
  readonly id?: number;
}

/** Injects a raw touch event through CDP; Playwright's touchscreen API is single-touch only. */
async function dispatchTouch(
  client: CDPSession,
  type: TouchEventType,
  touchPoints: readonly TouchPoint[],
): Promise<void> {
  await client.send("Input.dispatchTouchEvent", { type, touchPoints: [...touchPoints] });
}

test("touch gestures orbit, pinch-zoom, and pan without leaving dragging stuck", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }
  const center = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };

  const dragging = async (): Promise<string | null> => canvas.getAttribute("data-dragging");
  const cameraKey = async (): Promise<string | null> => canvas.getAttribute("data-camera");
  await expect.poll(dragging).toBe("false");

  const client = await context.newCDPSession(page);

  // A one-finger drag orbits the camera and must always release the gesture.
  const beforeOrbit = await cameraKey();
  await dispatchTouch(client, "touchStart", [{ x: center.x, y: center.y, id: 0 }]);
  await expect.poll(dragging).toBe("true");
  await dispatchTouch(client, "touchMove", [{ x: center.x + 60, y: center.y + 30, id: 0 }]);
  await dispatchTouch(client, "touchEnd", []);
  await expect.poll(dragging).toBe("false");
  expect(await cameraKey()).not.toBe(beforeOrbit);

  // A two-finger pinch zooms around the midpoint and midpoint movement pans.
  const beforePinch = await cameraKey();
  await dispatchTouch(client, "touchStart", [
    { x: center.x - 40, y: center.y, id: 0 },
    { x: center.x + 40, y: center.y, id: 1 },
  ]);
  await expect.poll(dragging).toBe("true");
  await dispatchTouch(client, "touchMove", [
    { x: center.x - 70, y: center.y + 20, id: 0 },
    { x: center.x + 70, y: center.y + 20, id: 1 },
  ]);
  await dispatchTouch(client, "touchMove", [
    { x: center.x - 80, y: center.y + 30, id: 0 },
    { x: center.x + 80, y: center.y + 30, id: 1 },
  ]);
  await dispatchTouch(client, "touchEnd", []);
  await expect.poll(dragging).toBe("false");
  expect(await cameraKey()).not.toBe(beforePinch);

  // An interrupted gesture (pointercancel) must clear the drag immediately.
  await dispatchTouch(client, "touchStart", [{ x: center.x, y: center.y, id: 0 }]);
  await expect.poll(dragging).toBe("true");
  await dispatchTouch(client, "touchCancel", []);
  await expect.poll(dragging).toBe("false");

  await context.close();
});

test("one-finger orbit crosses a camera pole without corrupting the frame", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const x = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + box.height * 0.2);
  const client = await context.newCDPSession(page);

  await dispatchTouch(client, "touchStart", [{ x, y: startY, id: 0 }]);
  for (const fraction of [0.4, 0.6, 0.8] as const) {
    await dispatchTouch(client, "touchMove", [
      { x, y: Math.round(box.y + box.height * fraction), id: 0 },
    ]);
  }
  await dispatchTouch(client, "touchEnd", []);
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("false");

  const camera = await readNavigationState(canvas);
  const forward = normalizeVector([
    camera.camera.target[0] - camera.camera.position[0],
    camera.camera.target[1] - camera.camera.position[1],
    camera.camera.target[2] - camera.camera.position[2],
  ]);
  expect(Math.hypot(...camera.camera.up)).toBeCloseTo(1, 5);
  expect(dotVector(forward, normalizeVector(camera.camera.up))).toBeCloseTo(0, 5);
  expectBoundsClippedSafely(camera.camera, camera.bounds);
  expect(await canvas.screenshot()).not.toHaveLength(0);
  await context.close();
});

test("keeps repeated mobile pinch zoom inside the model bounds", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.getAttribute("data-renderer"), { timeout: 10_000 }).toBe("webgpu");
  await page.getByTestId("fit-view").click();

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const center = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
  const before = await readNavigationState(canvas);
  const client = await context.newCDPSession(page);
  await dispatchTouch(client, "touchStart", [
    { x: center.x - 35, y: center.y, id: 0 },
    { x: center.x + 35, y: center.y, id: 1 },
  ]);
  for (let step = 1; step <= 8; step += 1) {
    const radius = 35 + step * 24;
    await dispatchTouch(client, "touchMove", [
      { x: center.x - radius, y: center.y, id: 0 },
      { x: center.x + radius, y: center.y, id: 1 },
    ]);
  }
  await dispatchTouch(client, "touchEnd", []);
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("false");

  const closest = await readNavigationState(canvas);
  expectBoundsClippedSafely(closest.camera, closest.bounds);
  expect(cameraDistance(closest.camera)).toBeLessThan(cameraDistance(before.camera));
  expect(await canvas.screenshot()).not.toHaveLength(0);
  await context.close();
});

test("anchors an off-center empty-space pinch at its midpoint", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.getAttribute("data-renderer"), { timeout: 10_000 }).toBe("webgpu");
  await page.getByTestId("fit-view").click();

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const midpoint = {
    x: Math.round(box.x + box.width * 0.78),
    y: Math.round(box.y + box.height * 0.3),
  };
  const before = await readNavigationState(canvas);
  const client = await context.newCDPSession(page);
  await dispatchTouch(client, "touchStart", [
    { x: midpoint.x - 28, y: midpoint.y, id: 0 },
    { x: midpoint.x + 28, y: midpoint.y, id: 1 },
  ]);
  await dispatchTouch(client, "touchMove", [
    { x: midpoint.x - 62, y: midpoint.y, id: 0 },
    { x: midpoint.x + 28, y: midpoint.y, id: 1 },
  ]);
  const currentMidpoint = { x: midpoint.x - 17, y: midpoint.y };
  const afterPan = panCameraSnapshot(before.camera, -17 / 100, 0);
  const anchor = targetPlanePoint(afterPan, currentMidpoint.x - box.x, currentMidpoint.y - box.y);
  await dispatchTouch(client, "touchEnd", []);
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("false");

  const after = await readNavigationState(canvas);
  const projected = projectCameraPoint(after.camera, anchor);
  expect(projected).toBeDefined();
  expect(
    Math.hypot(
      (projected?.[0] ?? 0) - (currentMidpoint.x - box.x),
      (projected?.[1] ?? 0) - (currentMidpoint.y - box.y),
    ),
  ).toBeLessThan(0.2);
  expect(cameraDistance(after.camera)).toBeLessThan(cameraDistance(before.camera));
  expectBoundsClippedSafely(after.camera, after.bounds);
  expect(await drawnPixels(canvas)).toBe(true);
  await context.close();
});

test("a one-finger tap still performs picking and selection", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();

  // Dense step grid so a pointer lands on rasterized node/face pixels. A miss
  // means the GPU pick path is broken, not that the environment lacks a capability.
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.touchscreen.tap(hit.x, hit.y);
  await expect.poll(async () => canvas.getAttribute("data-selected")).toMatch(/^n:/);

  await page.touchscreen.tap(hit.x, hit.y);
  await expect.poll(async () => canvas.getAttribute("data-selected")).toBe("");

  // A tap is not a drag: selection must leave no gesture stuck.
  await expect.poll(async () => canvas.getAttribute("data-dragging")).toBe("false");

  await context.close();
});

function normalizeVector(vector: readonly number[]): readonly [number, number, number] {
  const magnitude = Math.hypot(...vector);
  return [(vector[0] ?? 0) / magnitude, (vector[1] ?? 0) / magnitude, (vector[2] ?? 0) / magnitude];
}

function dotVector(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}
