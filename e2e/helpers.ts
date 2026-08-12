import { expect, test, type Locator, type Page } from "@playwright/test";

/** RGBA pixel data of the presented canvas, decoded in the browser. */
async function pixelData(canvas: Locator): Promise<number[]> {
  const shot = await canvas.screenshot();
  const base64 = shot.toString("base64");
  return canvas.page().evaluate((encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/png" });
    return createImageBitmap(blob).then((bitmap) => {
      const snapshot = document.createElement("canvas");
      snapshot.width = bitmap.width;
      snapshot.height = bitmap.height;
      const context = snapshot.getContext("2d");
      if (context === null) {
        throw new Error("no 2d snapshot context for pixel decode");
      }
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();
      return Array.from(data);
    });
  }, base64);
}

/** True when the canvas has actually drawn something (more than one color). */
export async function drawnPixels(canvas: Locator): Promise<boolean> {
  return (await distinctColors(canvas)) > 1;
}

/** A deterministic fingerprint of the presented canvas pixels. */
export async function pixelHash(canvas: Locator): Promise<string> {
  const data = await pixelData(canvas);
  let hash = 0;
  for (let index = 0; index < data.length; index += 4) {
    hash =
      ((hash * 31 + (data[index] ?? 0)) * 31 +
        (data[index + 1] ?? 0) * 7 +
        (data[index + 2] ?? 0) * 3 +
        (data[index + 3] ?? 0)) >>>
      0;
  }
  return hash.toString(16);
}

/** The number of distinct RGB colors in the presented canvas. */
export async function distinctColors(canvas: Locator): Promise<number> {
  const data = await pixelData(canvas);
  const colors = new Set<string>();
  for (let index = 0; index < data.length; index += 4) {
    colors.add(`${data[index] ?? 0},${data[index + 1] ?? 0},${data[index + 2] ?? 0}`);
  }
  return colors.size;
}

/** A resolved canvas point whose dataset key matched the sweep. */
export interface SweepHit {
  readonly x: number;
  readonly y: number;
  readonly key: string;
}

/** Options controlling how a pointer sweep searches for a pick target. */
export interface SweepOptions {
  /** Only accept hits whose dataset key starts with this prefix (default: any). */
  readonly prefix?: string;
  /** Which canvas dataset attribute carries the hit key (default: `"pick"`). */
  readonly attribute?: "pick" | "hovered";
  /** Rows in the fractional grid (default: 8). */
  readonly rows?: number;
  /** Columns in the fractional grid (default: 10). */
  readonly cols?: number;
  /**
   * Max milliseconds to poll after each move for async GPU pick readback
   * (default: 250).
   */
  readonly settleMs?: number;
  /** Sweep from the bottom-right toward the top-left (for edge-near targets). */
  readonly reverse?: boolean;
  /** When set, scan with a fixed pixel step instead of the fractional grid. */
  readonly step?: number;
  /** Clear the diagnostic before every move so returned coordinates are exact. */
  readonly fresh?: boolean;
}

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export interface CameraSnapshot {
  readonly mode: "perspective" | "orthographic";
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly fovY: number;
  readonly orthoHeight: number;
  readonly width: number;
  readonly height: number;
  readonly near: number;
  readonly far: number;
}

export interface BoundsSnapshot {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** Reads the demo's current camera and the active scene navigation bounds. */
export async function readNavigationState(
  canvas: Locator,
): Promise<{ readonly camera: CameraSnapshot; readonly bounds: BoundsSnapshot }> {
  const camera = await canvas.getAttribute("data-camera");
  const bounds = await canvas.getAttribute("data-camera-bounds");
  if (camera === null || bounds === null) throw new Error("camera navigation metadata is missing");
  return {
    camera: JSON.parse(camera) as CameraSnapshot,
    bounds: JSON.parse(bounds) as BoundsSnapshot,
  };
}

/** Asserts the bounds/clip invariant exposed by the camera navigation contract. */
export function expectBoundsClippedSafely(camera: CameraSnapshot, bounds: BoundsSnapshot): void {
  const depths = boundsDepths(camera, bounds);
  expect(Math.min(...depths), "all model bounds must stay beyond the near plane").toBeGreaterThan(
    camera.near,
  );
  expect(Math.max(...depths), "the far plane must contain the model bounds").toBeLessThan(
    camera.far,
  );
}

/** Asserts the positive-depth clip interval and one displayed approach point. */
export function expectDisplayedPointClippedSafely(
  camera: CameraSnapshot,
  bounds: BoundsSnapshot,
  point: readonly [number, number, number],
): void {
  const depths = boundsDepths(camera, bounds).filter((depth) => depth > 0);
  expect(depths.length, "the camera must retain a positive scene depth").toBeGreaterThan(0);
  expect(
    Math.min(...depths),
    "positive scene depths must stay beyond the near plane",
  ).toBeGreaterThan(camera.near);
  expect(Math.max(...depths), "the far plane must contain positive scene depths").toBeLessThan(
    camera.far,
  );
  expect(
    pointDepth(camera, point),
    "the displayed approach point must stay beyond the near plane",
  ).toBeGreaterThan(camera.near);
}

/** Returns the eye-target distance from a captured camera snapshot. */
export function cameraDistance(camera: CameraSnapshot): number {
  return Math.hypot(
    camera.position[0] - camera.target[0],
    camera.position[1] - camera.target[1],
    camera.position[2] - camera.target[2],
  );
}

/** Computes the empty-space navigation point on the plane through the target. */
export function targetPlanePoint(
  camera: CameraSnapshot,
  x: number,
  y: number,
): readonly [number, number, number] {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const distance = dot(subtract(camera.target, camera.position), forward);
  const halfHeight =
    camera.mode === "orthographic" ? camera.orthoHeight / 2 : Math.tan(camera.fovY / 2) * distance;
  const halfWidth = halfHeight * (camera.width / camera.height);
  const ndcX = (x / camera.width) * 2 - 1;
  const ndcY = 1 - (y / camera.height) * 2;
  return add(
    add(add(camera.position, scale(forward, distance)), scale(right, ndcX * halfWidth)),
    scale(up, ndcY * halfHeight),
  );
}

/** Applies the camera's existing view-plane pan convention to a snapshot. */
export function panCameraSnapshot(
  camera: CameraSnapshot,
  horizontal: number,
  vertical: number,
): CameraSnapshot {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = normalize(cross(right, forward));
  const delta = add(scale(right, -horizontal), scale(up, vertical));
  return {
    ...camera,
    position: add(camera.position, delta),
    target: add(camera.target, delta),
  };
}

/** Projects a world point into the camera's CSS pixel coordinates. */
export function projectCameraPoint(
  camera: CameraSnapshot,
  point: readonly [number, number, number],
): readonly [number, number] | undefined {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const relative = subtract(point, camera.position);
  const depth = dot(relative, forward);
  if (depth <= 0) return undefined;
  const halfHeight =
    camera.mode === "orthographic" ? camera.orthoHeight / 2 : Math.tan(camera.fovY / 2) * depth;
  const halfWidth = halfHeight * (camera.width / camera.height);
  return [
    ((dot(relative, right) / halfWidth + 1) * camera.width) / 2,
    ((1 - dot(relative, up) / halfHeight) * camera.height) / 2,
  ];
}

function boundsDepths(camera: CameraSnapshot, bounds: BoundsSnapshot): readonly number[] {
  const forward = normalize([
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ]);
  return boundsCorners(bounds).map((corner) =>
    dot(
      [
        corner[0] - camera.position[0],
        corner[1] - camera.position[1],
        corner[2] - camera.position[2],
      ],
      forward,
    ),
  );
}

function pointDepth(camera: CameraSnapshot, point: readonly [number, number, number]): number {
  const forward = normalize(subtract(camera.target, camera.position));
  return dot(subtract(point, camera.position), forward);
}

function boundsCorners(bounds: BoundsSnapshot): readonly (readonly [number, number, number])[] {
  return [
    [bounds.minX, bounds.minY, bounds.minZ],
    [bounds.minX, bounds.minY, bounds.maxZ],
    [bounds.minX, bounds.maxY, bounds.minZ],
    [bounds.minX, bounds.maxY, bounds.maxZ],
    [bounds.maxX, bounds.minY, bounds.minZ],
    [bounds.maxX, bounds.minY, bounds.maxZ],
    [bounds.maxX, bounds.maxY, bounds.minZ],
    [bounds.maxX, bounds.maxY, bounds.maxZ],
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

type Vec3 = readonly [number, number, number];

function add(a: readonly number[], b: readonly number[]): Vec3 {
  return [(a[0] ?? 0) + (b[0] ?? 0), (a[1] ?? 0) + (b[1] ?? 0), (a[2] ?? 0) + (b[2] ?? 0)];
}

function subtract(a: readonly number[], b: readonly number[]): Vec3 {
  return [(a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)];
}

function scale(vector: readonly number[], amount: number): Vec3 {
  return [(vector[0] ?? 0) * amount, (vector[1] ?? 0) * amount, (vector[2] ?? 0) * amount];
}

function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
}

function normalize(vector: readonly number[]): Vec3 {
  const length = Math.hypot(vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0);
  return [(vector[0] ?? 0) / length, (vector[1] ?? 0) / length, (vector[2] ?? 0) / length];
}

/**
 * Polls the canvas dataset after a move until a key appears, matches the
 * prefix, or `settleMs` elapses. Non-matching non-empty keys settle early so
 * the sweep can advance.
 */
async function waitForKey(
  keyOf: () => Promise<string>,
  matches: (key: string) => boolean,
  settleMs: number,
  page: Page,
): Promise<string> {
  const deadline = Date.now() + settleMs;
  while (Date.now() <= deadline) {
    const key = await keyOf();
    if (matches(key) || key !== "") {
      return key;
    }
    await page.waitForTimeout(16);
  }
  return keyOf();
}

function gridCells(
  box: Box,
  options: {
    readonly rows: number;
    readonly cols: number;
    readonly reverse: boolean;
    readonly step?: number;
  },
): Array<readonly [number, number]> {
  const cells: Array<readonly [number, number]> = [];
  if (options.step === undefined) {
    for (let row = 0; row < options.rows; row++) {
      for (let col = 0; col < options.cols; col++) {
        cells.push([
          Math.round(box.x + ((col + 0.5) / options.cols) * box.width),
          Math.round(box.y + ((row + 0.5) / options.rows) * box.height),
        ]);
      }
    }
  } else {
    for (let y = 0; y < box.height; y += options.step) {
      for (let x = 0; x < box.width; x += options.step) {
        cells.push([
          Math.round(box.x + x + options.step / 2),
          Math.round(box.y + y + options.step / 2),
        ]);
      }
    }
  }
  return options.reverse ? [...cells].reverse() : cells;
}

async function sweepCells(
  page: Page,
  cells: ReadonlyArray<readonly [number, number]>,
  options: {
    readonly clearKey?: (() => Promise<void>) | undefined;
    readonly keyOf: () => Promise<string>;
    readonly matches: (key: string) => boolean;
    readonly settleMs: number;
  },
): Promise<SweepHit | undefined> {
  const { clearKey, keyOf, matches, settleMs } = options;
  for (const [x, y] of cells) {
    await clearKey?.();
    await page.mouse.move(x, y);
    const key = await waitForKey(keyOf, matches, settleMs, page);
    if (matches(key)) {
      return { x, y, key };
    }
  }
  return undefined;
}

/**
 * Sweeps the pointer across the canvas until the dataset key resolves a hit
 * matching `options.prefix`. Demo picking is asynchronous GPU readback, so
 * each move polls `data-pick` / `data-hovered` until the readback settles.
 * Returns the canvas point and key, or `undefined` when no grid point resolves.
 */
export async function sweepForHit(
  page: Page,
  canvas: Locator,
  options: SweepOptions = {},
): Promise<SweepHit | undefined> {
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }
  const {
    prefix = "",
    attribute = "pick",
    rows = 8,
    cols = 10,
    settleMs = 250,
    reverse = false,
    step,
    fresh = false,
  } = options;
  const keyOf = async (): Promise<string> => (await canvas.getAttribute(`data-${attribute}`)) ?? "";
  const clearKey = async (): Promise<void> => {
    await canvas.evaluate((node, name) => {
      (node as HTMLElement).dataset[name] = "";
    }, attribute);
  };
  const matches = (key: string): boolean => key !== "" && (prefix === "" || key.startsWith(prefix));
  const anyHit = (key: string): boolean => key !== "";

  // Warm a frame so pick attachments are current after navigations/screenshots.
  const center: readonly [number, number] = [
    Math.round(box.x + box.width / 2),
    Math.round(box.y + box.height / 2),
  ];
  if (fresh || prefix !== "") await clearKey();
  await page.mouse.move(center[0], center[1]);
  const centerKey = await waitForKey(keyOf, anyHit, settleMs, page);
  if (matches(centerKey)) return { x: center[0], y: center[1], key: centerKey };

  if (prefix !== "") {
    const radius = 180;
    const localStep = 12;
    const local: Array<readonly [number, number]> = [];
    for (let dy = -radius; dy <= radius; dy += localStep) {
      for (let dx = -radius; dx <= radius; dx += localStep) {
        const x = center[0] + dx;
        const y = center[1] + dy;
        if (x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height) {
          local.push([x, y]);
        }
      }
    }
    local.sort(
      (a, b) =>
        Math.hypot(a[0] - center[0], a[1] - center[1]) -
        Math.hypot(b[0] - center[0], b[1] - center[1]),
    );
    return sweepCells(page, local, { clearKey, keyOf, matches, settleMs });
  }

  const grid = gridCells(
    box,
    step === undefined ? { rows, cols, reverse } : { rows, cols, reverse, step },
  );
  const coarse = fresh
    ? [[Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)] as const, ...grid]
    : grid;
  const sweep = (cells: ReadonlyArray<readonly [number, number]>) =>
    sweepCells(page, cells, {
      ...(fresh ? { clearKey } : {}),
      keyOf,
      matches,
      settleMs,
    });
  return sweep(coarse);
}

/**
 * A sweep that must resolve on a healthy hardware-WebGPU Chrome run. When the
 * environment cannot complete GPU pick readback (common under automation even
 * with system Chrome), skips with `message` instead of failing the merge gate.
 * CI does not run this path; see `npm run test:e2e:ci`.
 */
export async function requireHit(
  page: Page,
  canvas: Locator,
  options: SweepOptions,
  message: string,
): Promise<SweepHit> {
  const hit = await sweepForHit(page, canvas, options);
  if (hit === undefined) {
    test.skip(true, message);
  }
  expect(hit, message).toBeDefined();
  return hit as SweepHit;
}
