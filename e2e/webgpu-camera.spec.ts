/** camera ownership: camera, navigation, and orientation contracts. */

import { expect, test } from "@playwright/test";
import {
  cameraDistance,
  expectBoundsClippedSafely,
  expectDisplayedPointClippedSafely,
  projectCameraPoint,
  readNavigationState,
  requireHit,
  targetPlanePoint,
  stableCanvasPixels,
  canvasRgba,
  visiblePixelCount,
  dragCamera,
  loadWebGpuPage,
} from "./webgpu-support";

test("keeps every supported gallery occurrence inside clip planes while orbiting", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  await page.getByTestId("model-select").selectOption({ label: "Supported element gallery" });
  await page.getByTestId("fit-view").click();

  const canvas = page.getByTestId("view-canvas");
  await expect(page.getByTestId("status")).toContainText("10 visible");
  const initialNavigation = await readNavigationState(canvas);
  expectBoundsClippedSafely(initialNavigation.camera, initialNavigation.bounds);

  for (const delta of [
    { x: 160, y: 60 },
    { x: -280, y: 90 },
    { x: 200, y: -140 },
  ]) {
    await dragCamera(page, canvas, delta);
    const navigation = await readNavigationState(canvas);
    expectBoundsClippedSafely(navigation.camera, navigation.bounds);
    await expect(page.getByTestId("status")).toContainText("10 visible");
    expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(200);
  }
});

test("uses SpaceClaim middle-button spin, pan, and zoom gestures", async ({ page }) => {
  await loadWebGpuPage(page);

  const canvas = page.getByTestId("view-canvas");
  const cameraKey = async (): Promise<string | null> => canvas.getAttribute("data-camera");

  const beforeSpin = await cameraKey();
  await dragCamera(page, canvas, { x: 90, y: 35 });
  await expect.poll(cameraKey).not.toBe(beforeSpin);

  await page.getByTestId("reset").click();
  const beforePan = await cameraKey();
  await dragCamera(page, canvas, { x: 90, y: 35 }, "Shift");
  await expect.poll(cameraKey).not.toBe(beforePan);

  await page.getByTestId("reset").click();
  const beforeZoom = await cameraKey();
  await dragCamera(page, canvas, { x: 0, y: -90 }, "Control");
  await expect.poll(cameraKey).not.toBe(beforeZoom);
});

test("crosses both orbit poles through repeated full rotations", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("fit-view").click();

  for (let step = 0; step < 8; step += 1) {
    await dragCamera(page, canvas, { x: 0, y: 160 });
    const navigation = await readNavigationState(canvas);
    expectCameraFrame(navigation.camera);
    expectBoundsClippedSafely(navigation.camera, navigation.bounds);
  }

  expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(200);
  await expect(page.locator('[data-femgx-orientation-gizmo="true"]')).toBeVisible();
});

test("shows a camera-oriented rotation-origin widget only during orbit", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { attribute: "hovered", prefix: "f:", fresh: true },
    "GPU picking must resolve an orbit pivot for the widget test",
  );
  const x = hit.x;
  const y = hit.y;

  const before = await stableCanvasPixels(page, canvas);
  const framesBefore = await canvas.getAttribute("data-frames");
  await page.mouse.down({ button: "middle" });
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("true");
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBe(framesBefore);
  const during = await stableCanvasPixels(page, canvas);
  expect(during.equals(before), "the active orbit widget must affect the rendered frame").toBe(
    false,
  );

  await page.mouse.move(x + 90, y + 35);
  await page.waitForTimeout(100);

  await page.mouse.up({ button: "middle" });
  await expect.poll(() => canvas.getAttribute("data-dragging")).toBe("false");
});

test("keeps depth ordering and picking after deep zoom in and out", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.getByTestId("fit-view").click();
  await page.mouse.move(x, y);
  const fitted = await readNavigationState(canvas);
  expectBoundsClippedSafely(fitted.camera, fitted.bounds);
  await requireHit(
    page,
    canvas,
    { attribute: "hovered", fresh: true },
    "GPU picking must resolve the deep-zoom approach point",
  );
  const picked = await page.evaluate(
    async ({ x: localX, y: localY }) => {
      const harness = (
        window as typeof window & {
          femgxDemo?: {
            pickPoint: (pointX: number, pointY: number) => Promise<readonly number[] | undefined>;
          };
        }
      ).femgxDemo;
      return (await harness?.pickPoint(localX, localY)) ?? null;
    },
    { x: x - box.x, y: y - box.y },
  );
  if (picked === null || picked.length !== 3) {
    throw new Error("GPU picking did not return a displayed world point");
  }
  const displayedPoint: readonly [number, number, number] = [
    picked[0] ?? NaN,
    picked[1] ?? NaN,
    picked[2] ?? NaN,
  ];

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, 200);
  }
  await stableCanvasPixels(page, canvas);
  const zoomedOut = await readNavigationState(canvas);
  expect(cameraDistance(zoomedOut.camera)).toBeGreaterThan(cameraDistance(fitted.camera));
  expectBoundsClippedSafely(zoomedOut.camera, zoomedOut.bounds);

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -200);
  }
  await stableCanvasPixels(page, canvas);
  const restored = await readNavigationState(canvas);
  expect(restored.camera.position[0]).toBeCloseTo(fitted.camera.position[0], 3);
  expect(restored.camera.position[1]).toBeCloseTo(fitted.camera.position[1], 3);
  expect(restored.camera.position[2]).toBeCloseTo(fitted.camera.position[2], 3);
  expect(restored.camera.near).toBeCloseTo(fitted.camera.near, 3);
  expect(restored.camera.far).toBeCloseTo(fitted.camera.far, 3);

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -800);
  }
  const zoomedIn = await stableCanvasPixels(page, canvas);
  const closest = await readNavigationState(canvas);
  expectDisplayedPointClippedSafely(closest.camera, closest.bounds, displayedPoint);
  const projectedPoint = projectCameraPoint(closest.camera, displayedPoint);
  expect(projectedPoint).toBeDefined();
  expect(
    Math.hypot((projectedPoint?.[0] ?? 0) - (x - box.x), (projectedPoint?.[1] ?? 0) - (y - box.y)),
  ).toBeLessThan(1);
  expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(200);
  expect(cameraDistance(closest.camera)).toBeLessThan(cameraDistance(fitted.camera));
  expect(zoomedIn.length).toBeGreaterThan(0);

  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must still resolve after the bounds-safe close zoom",
  );
  expect(hit.key).toMatch(/^(n|f|e|i|p):/);

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, 800);
  }
  const zoomedOutAgain = await readNavigationState(canvas);
  expectDisplayedPointClippedSafely(zoomedOutAgain.camera, zoomedOutAgain.bounds, displayedPoint);
  expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(20);
});

function expectCameraFrame(
  camera: Awaited<ReturnType<typeof readNavigationState>>["camera"],
): void {
  const forward = normalizeVector([
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ]);
  const up = normalizeVector(camera.up);
  const right = normalizeVector(crossVector(forward, up));
  expect(Math.hypot(...camera.up)).toBeCloseTo(1, 5);
  expect(dotVector(forward, up)).toBeCloseTo(0, 5);
  expect(dotVector(forward, right)).toBeCloseTo(0, 5);
  expect(dotVector(crossVector(right, forward), up)).toBeCloseTo(1, 5);
  expect(camera.near).toBeGreaterThan(0);
  expect(camera.far).toBeGreaterThan(camera.near);
}

function normalizeVector(vector: readonly number[]): readonly [number, number, number] {
  const magnitude = Math.hypot(...vector);
  return [(vector[0] ?? 0) / magnitude, (vector[1] ?? 0) / magnitude, (vector[2] ?? 0) / magnitude];
}

function crossVector(
  a: readonly number[],
  b: readonly number[],
): readonly [number, number, number] {
  return [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
}

function dotVector(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

test("keeps empty-canvas wheel zoom anchored at the cursor", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("fit-view").click();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");

  const candidates = [
    [0.05, 0.05],
    [0.95, 0.05],
    [0.05, 0.95],
    [0.95, 0.95],
  ] as const;
  let empty: readonly [number, number] | undefined;
  for (const [fx, fy] of candidates) {
    const point = [box.x + box.width * fx, box.y + box.height * fy] as const;
    await page.mouse.move(point[0], point[1]);
    await page.waitForTimeout(120);
    if ((await canvas.getAttribute("data-hovered")) === "") {
      empty = point;
      break;
    }
  }
  if (empty === undefined) throw new Error("could not find an empty canvas corner");

  const local = [empty[0] - box.x, empty[1] - box.y] as const;
  const before = await readNavigationState(canvas);
  const anchor = targetPlanePoint(before.camera, local[0], local[1]);
  for (let step = 0; step < 2; step += 1) await page.mouse.wheel(0, -180);
  await stableCanvasPixels(page, canvas);
  await page.waitForTimeout(500);

  const zoomed = await readNavigationState(canvas);
  const projected = projectCameraPoint(zoomed.camera, anchor);
  expect(projected).toBeDefined();
  expect(
    Math.hypot((projected?.[0] ?? 0) - local[0], (projected?.[1] ?? 0) - local[1]),
  ).toBeLessThan(1);
  expect(cameraDistance(zoomed.camera)).toBeLessThan(cameraDistance(before.camera));
  expect(
    Math.hypot(
      zoomed.camera.target[0] - before.camera.target[0],
      zoomed.camera.target[1] - before.camera.target[1],
      zoomed.camera.target[2] - before.camera.target[2],
    ),
  ).toBeGreaterThan(0.01);
  expectBoundsClippedSafely(zoomed.camera, zoomed.bounds);

  for (let step = 0; step < 2; step += 1) await page.mouse.wheel(0, 180);
  await stableCanvasPixels(page, canvas);
  await page.waitForTimeout(500);
  const restored = await readNavigationState(canvas);
  const restoredProjection = projectCameraPoint(restored.camera, anchor);
  expect(restoredProjection).toBeDefined();
  expect(
    Math.hypot(
      (restoredProjection?.[0] ?? 0) - local[0],
      (restoredProjection?.[1] ?? 0) - local[1],
    ),
  ).toBeLessThan(1);
  expect(cameraDistance(restored.camera)).toBeCloseTo(cameraDistance(before.camera), 4);
});
