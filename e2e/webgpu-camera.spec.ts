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

test("keeps every gallery occurrence inside clip planes while orbiting", async ({ page }) => {
  await loadWebGpuPage(page);
  await page
    .getByTestId("model-select")
    .selectOption({ label: "Element tessellation and mapping gallery" });
  await page.getByTestId("fit-view").click();

  const canvas = page.getByTestId("view-canvas");
  await expect(page.getByTestId("status")).toContainText("12 visible");
  const initialNavigation = await readNavigationState(canvas);
  expectBoundsClippedSafely(initialNavigation.camera, initialNavigation.bounds);

  for (const delta of [
    { x: 160, y: 60 },
    { x: -280, y: 90 },
    { x: 200, y: -140 },
  ]) {
    const before = await readNavigationState(canvas);
    await dragCamera(page, canvas, delta);
    const navigation = await readNavigationState(canvas);
    expect(cameraStepDegrees(before, navigation)).toBeGreaterThan(5);
    expectBoundsClippedSafely(navigation.camera, navigation.bounds);
    await expect(page.getByTestId("status")).toContainText("12 visible");
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
  await dragCamera(page, canvas, { x: 90, y: 35 }, "Control");
  await expect.poll(cameraKey).not.toBe(beforePan);

  await page.getByTestId("reset").click();
  const beforeZoom = await cameraKey();
  await dragCamera(page, canvas, { x: 0, y: -90 }, "Shift");
  await expect.poll(cameraKey).not.toBe(beforeZoom);
});

test("keeps target-plane panning at the CSS-pixel pace in both projections", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("fit-view").click();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");

  for (const projection of ["Perspective", "Orthographic"] as const) {
    if ((await page.getByTestId("projection-toggle").textContent()) !== projection) {
      await page.getByTestId("projection-toggle").click();
      await expect(page.getByTestId("projection-toggle")).toHaveText(projection);
      await page.getByTestId("fit-view").click();
    }
    const before = await readNavigationState(canvas);
    const anchor = targetPlanePoint(before.camera, box.width / 2, box.height / 2);
    const beforeProjection = projectCameraPoint(before.camera, anchor);
    await dragCamera(page, canvas, { x: 64, y: 24 }, "Control");
    const after = await readNavigationState(canvas);
    const afterProjection = projectCameraPoint(after.camera, anchor);

    expect(afterProjection?.[0]).toBeCloseTo((beforeProjection?.[0] ?? NaN) + 64, 1);
    expect(afterProjection?.[1]).toBeCloseTo((beforeProjection?.[1] ?? NaN) + 24, 1);
    expectBoundsClippedSafely(after.camera, after.bounds);
  }
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

test("snaps every named face and signed corner through the view cube", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("fit-view").click();

  const faces = {
    front: [0, 0, 1],
    back: [0, 0, -1],
    right: [1, 0, 0],
    left: [-1, 0, 0],
    top: [0, 1, 0],
    bottom: [0, -1, 0],
  } as const;
  await page.locator('[data-view-face="front"]').click();
  await expect
    .poll(async () => directionAlignment(await readNavigationState(canvas), faces.front))
    .toBeGreaterThan(0.99999);
  for (const [id, direction] of Object.entries(faces)) {
    const target = page.locator(`[data-view-face="${id}"]`);
    await target.dispatchEvent("keydown", { key: "Enter" });
    await expect
      .poll(async () => directionAlignment(await readNavigationState(canvas), direction), {
        message: `${id} face alignment`,
      })
      .toBeGreaterThan(0.99999);
  }

  const corners = ["+++", "++-", "+-+", "+--", "-++", "-+-", "--+", "---"] as const;
  for (const corner of corners) {
    const direction = corner.split("").map((sign) => (sign === "+" ? 1 : -1)) as [
      number,
      number,
      number,
    ];
    const target = page.locator(`[data-view-corner="${corner}"]`);
    await target.dispatchEvent("keydown", { key: "Enter" });
    await expect
      .poll(async () => directionAlignment(await readNavigationState(canvas), direction), {
        message: `${corner} corner alignment`,
      })
      .toBeGreaterThan(0.99999);
  }
});

test("rotates the current view cube by default, Shift, and Control/Meta steps", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const cases = [
    { name: "default", key: undefined, degrees: 15 },
    { name: "Shift", key: "Shift" as const, degrees: 90 },
    { name: "modifier", key: modifier, degrees: 5 },
  ];

  for (const testCase of cases) {
    await page.getByTestId("fit-view").click();
    const before = await readNavigationState(canvas);
    const arrow = page.locator('[data-rotate="left"]');
    await arrow.focus();
    if (testCase.key === undefined) {
      await page.keyboard.press("Enter");
    } else {
      await page.keyboard.down(testCase.key);
      await page.keyboard.press("Enter");
      await page.keyboard.up(testCase.key);
    }
    await expect
      .poll(async () => cameraStepDegrees(before, await readNavigationState(canvas)))
      .toBeCloseTo(testCase.degrees, 1);
    const after = await readNavigationState(canvas);
    expect(cameraStepDegrees(before, after), `${testCase.name} arrow step`).toBeCloseTo(
      testCase.degrees,
      1,
    );
  }
});

test("rolls the current view in-plane without changing its line of sight", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("fit-view").click();
  await page.locator('[data-view-face="front"]').click();
  await expect
    .poll(async () => directionAlignment(await readNavigationState(canvas), [0, 0, 1]))
    .toBeGreaterThan(0.99999);
  const before = await readNavigationState(canvas);
  const probe = [
    before.camera.target[0] + before.camera.up[0],
    before.camera.target[1] + before.camera.up[1],
    before.camera.target[2] + before.camera.up[2],
  ] as const;
  const beforeProbe = projectCameraPoint(before.camera, probe);
  const beforeTarget = projectCameraPoint(before.camera, before.camera.target);
  if (beforeProbe === undefined || beforeTarget === undefined) {
    throw new Error("front view probe must be projectable");
  }

  const clockwise = page.locator('[data-rotate="clockwise"]');
  await clockwise.focus();
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await expect
    .poll(async () => (await readNavigationState(canvas)).camera.up[0])
    .not.toBeCloseTo(before.camera.up[0], 3);

  const after = await readNavigationState(canvas);
  const afterProbe = projectCameraPoint(after.camera, probe);
  const afterTarget = projectCameraPoint(after.camera, after.camera.target);
  if (afterProbe === undefined || afterTarget === undefined) {
    throw new Error("rolled view probe must be projectable");
  }
  expect(after.camera.position).toEqual(before.camera.position);
  expect(after.camera.target).toEqual(before.camera.target);
  expect(afterProbe[0]).toBeGreaterThan(beforeProbe[0]);
  expect(afterProbe[1]).toBeCloseTo(afterTarget[1], 1);
  expect(afterTarget[0]).toBeCloseTo(beforeTarget[0], 1);

  const counterclockwise = page.locator('[data-rotate="counterclockwise"]');
  await counterclockwise.focus();
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await expect
    .poll(async () => (await readNavigationState(canvas)).camera.up[0])
    .toBeCloseTo(before.camera.up[0], 4);
  const restored = await readNavigationState(canvas);
  expect(restored.camera.up[0]).toBeCloseTo(before.camera.up[0], 4);
  expect(restored.camera.up[1]).toBeCloseTo(before.camera.up[1], 4);
  expect(restored.camera.up[2]).toBeCloseTo(before.camera.up[2], 4);
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
  expect(navigationScale(zoomedOut.camera)).toBeGreaterThan(navigationScale(fitted.camera));
  expectBoundsClippedSafely(zoomedOut.camera, zoomedOut.bounds);

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -200);
  }
  await stableCanvasPixels(page, canvas);
  const restored = await readNavigationState(canvas);
  expect(restored.camera.position[0]).toBeCloseTo(fitted.camera.position[0], 3);
  expect(restored.camera.position[1]).toBeCloseTo(fitted.camera.position[1], 3);
  expect(restored.camera.position[2]).toBeCloseTo(fitted.camera.position[2], 3);
  expectBoundsClippedSafely(restored.camera, restored.bounds);

  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -800);
  }
  const zoomedIn = await stableCanvasPixels(page, canvas);
  const closest = await readNavigationState(canvas);
  expectDisplayedPointClippedSafely(closest.camera, closest.bounds, displayedPoint);
  expect(closest.camera.target).toEqual(fitted.camera.target);
  const projectedTarget = projectCameraPoint(closest.camera, closest.camera.target);
  expect(projectedTarget?.[0]).toBeCloseTo(box.width / 2, 3);
  expect(projectedTarget?.[1]).toBeCloseTo(box.height / 2, 3);
  expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(200);
  expect(navigationScale(closest.camera)).toBeLessThan(navigationScale(fitted.camera));
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

test("keeps an instance selection framed and visible after fitting", async ({ page }) => {
  await loadWebGpuPage(page);
  await page
    .getByTestId("model-select")
    .selectOption({ label: "Element tessellation and mapping gallery" });
  await page.getByTestId("fit-view").click();
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve before fitting the selected target",
  );
  await page.keyboard.down("Alt");
  await page.mouse.click(hit.x, hit.y);
  await page.keyboard.up("Alt");
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^i:/);

  const beforeFit = await canvas.getAttribute("data-camera");
  await page.keyboard.press("z");
  await page.waitForTimeout(100);
  const earlyFit = await canvas.getAttribute("data-camera");
  expect(earlyFit).not.toBe(beforeFit);
  await page.waitForTimeout(150);
  expect(await canvas.getAttribute("data-camera")).not.toBe(earlyFit);
  await page.waitForTimeout(900);
  const navigation = await readNavigationState(canvas);

  expectCameraFrame(navigation.camera);
  expect(visiblePixelCount(await canvasRgba(page, canvas))).toBeGreaterThan(200);
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

function directionAlignment(
  navigation: Awaited<ReturnType<typeof readNavigationState>>,
  expected: readonly [number, number, number],
): number {
  const direction = normalizeVector([
    navigation.camera.position[0] - navigation.camera.target[0],
    navigation.camera.position[1] - navigation.camera.target[1],
    navigation.camera.position[2] - navigation.camera.target[2],
  ]);
  return dotVector(direction, normalizeVector(expected));
}

function cameraStepDegrees(
  before: Awaited<ReturnType<typeof readNavigationState>>,
  after: Awaited<ReturnType<typeof readNavigationState>>,
): number {
  const first = normalizeVector([
    before.camera.position[0] - before.camera.target[0],
    before.camera.position[1] - before.camera.target[1],
    before.camera.position[2] - before.camera.target[2],
  ]);
  const second = normalizeVector([
    after.camera.position[0] - after.camera.target[0],
    after.camera.position[1] - after.camera.target[1],
    after.camera.position[2] - after.camera.target[2],
  ]);
  return (Math.acos(Math.max(-1, Math.min(1, dotVector(first, second)))) * 180) / Math.PI;
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

function navigationScale(
  camera: Awaited<ReturnType<typeof readNavigationState>>["camera"],
): number {
  return camera.mode === "orthographic" ? camera.orthoHeight : cameraDistance(camera);
}

test("keeps empty-canvas wheel zoom anchored at the current camera target", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const projection = page.getByTestId("projection-toggle");
  await projection.click();
  await expect(projection).toHaveText("Perspective");
  await page.getByTestId("fit-view").click();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");

  const candidates = [
    [0.95, 0.2],
    [0.05, 0.8],
    [0.95, 0.95],
    [0.05, 0.2],
  ] as const;
  let empty: readonly [number, number] | undefined;
  for (const [fx, fy] of candidates) {
    const point = [box.x + box.width * fx, box.y + box.height * fy] as const;
    const receivesCanvasInput = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName === "CANVAS",
      { x: point[0], y: point[1] },
    );
    if (!receivesCanvasInput) continue;
    await page.mouse.move(point[0], point[1]);
    await page.waitForTimeout(120);
    if ((await canvas.getAttribute("data-hovered")) === "") {
      empty = point;
      break;
    }
  }
  if (empty === undefined) throw new Error("could not find an empty canvas corner");

  const before = await readNavigationState(canvas);
  for (let step = 0; step < 2; step += 1) await page.mouse.wheel(0, -180);
  await stableCanvasPixels(page, canvas);
  await page.waitForTimeout(500);

  const zoomed = await readNavigationState(canvas);
  expect(zoomed.camera.target).toEqual(before.camera.target);
  const projected = projectCameraPoint(zoomed.camera, zoomed.camera.target);
  expect(projected?.[0]).toBeCloseTo(box.width / 2, 3);
  expect(projected?.[1]).toBeCloseTo(box.height / 2, 3);
  expect(cameraDistance(zoomed.camera)).toBeLessThan(cameraDistance(before.camera));
  expectBoundsClippedSafely(zoomed.camera, zoomed.bounds);

  for (let step = 0; step < 2; step += 1) await page.mouse.wheel(0, 180);
  await stableCanvasPixels(page, canvas);
  await page.waitForTimeout(500);
  const restored = await readNavigationState(canvas);
  expect(restored.camera.target).toEqual(before.camera.target);
  expect(cameraDistance(restored.camera)).toBeCloseTo(cameraDistance(before.camera), 4);
});
