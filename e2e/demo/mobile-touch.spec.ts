import { expect, test, type CDPSession } from "@playwright/test";
import {
  cameraDistance,
  canvasInteractionBox,
  drawnPixels,
  expectBoundsClippedSafely,
  panCameraSnapshot,
  readNavigationState,
  requireHit,
} from "../shared/helpers";
import { openCommandPanel, setSelectionGranularity, waitForRenderer } from "./demo-support";

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
  const box = await canvasInteractionBox(canvas);
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
  const box = await canvasInteractionBox(canvas);
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
  await waitForRenderer(page, canvas);
  await openCommandPanel(page, "view");
  await page.getByTestId("fit-view").click();

  const box = await canvasInteractionBox(canvas);
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
  expect(navigationScale(closest.camera)).toBeLessThan(navigationScale(before.camera));
  expect(await canvas.screenshot()).not.toHaveLength(0);
  await context.close();
});

test("keeps the panned model target stable during an off-center pinch", async ({ browser }) => {
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
  await waitForRenderer(page, canvas);
  await openCommandPanel(page, "view");
  await page.getByTestId("fit-view").click();

  const box = await canvasInteractionBox(canvas);
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
  const afterPan = panCameraSnapshot(before.camera, -17, 0);
  await dispatchTouch(client, "touchEnd", []);
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("false");

  const after = await readNavigationState(canvas);
  // The full-height phone canvas changes perspective scale while the pinch is
  // in flight; retain a bounded scene-space assertion rather than requiring
  // the pre-shell pixel estimate to survive that resize.
  expect(Math.abs(after.camera.target[0] - afterPan.target[0])).toBeLessThan(1);
  expect(Math.abs(after.camera.target[1] - afterPan.target[1])).toBeLessThan(1);
  expect(Math.abs(after.camera.target[2] - afterPan.target[2])).toBeLessThan(1);
  expect(navigationScale(after.camera)).toBeLessThan(navigationScale(before.camera));
  expectBoundsClippedSafely(after.camera, after.bounds);
  expect(await drawnPixels(canvas)).toBe(true);
  await context.close();
});

test("one-finger taps select node and element targets", async ({ browser }) => {
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
  await waitForRenderer(page, canvas);
  await setSelectionGranularity(page, "node");

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

  await setSelectionGranularity(page, "element");
  const elementHit = await requireHit(
    page,
    canvas,
    { prefix: "f:" },
    "element GPU picking must resolve on the mobile WebGPU lane",
  );
  await page.touchscreen.tap(elementHit.x, elementHit.y);
  await expect.poll(async () => canvas.getAttribute("data-selected")).toMatch(/^e:/);

  // A tap is not a drag: selection must leave no gesture stuck.
  await expect.poll(async () => canvas.getAttribute("data-dragging")).toBe("false");

  await context.close();
});

test("a view-cube tap changes the camera without starting canvas dragging", async ({ browser }) => {
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
  await waitForRenderer(page, canvas);
  const before = await canvas.getAttribute("data-camera");

  await page.locator('[data-view-face="front"]').tap();
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(before);
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("false");
  await context.close();
});

function normalizeVector(vector: readonly number[]): readonly [number, number, number] {
  const magnitude = Math.hypot(...vector);
  return [(vector[0] ?? 0) / magnitude, (vector[1] ?? 0) / magnitude, (vector[2] ?? 0) / magnitude];
}

function dotVector(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

function navigationScale(
  camera: Awaited<ReturnType<typeof readNavigationState>>["camera"],
): number {
  return camera.mode === "orthographic" ? camera.orthoHeight : cameraDistance(camera);
}
