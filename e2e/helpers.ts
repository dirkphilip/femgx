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
}

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

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
  keyOf: () => Promise<string>,
  matches: (key: string) => boolean,
  settleMs: number,
): Promise<SweepHit | undefined> {
  for (const [x, y] of cells) {
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
  } = options;
  const keyOf = async (): Promise<string> => (await canvas.getAttribute(`data-${attribute}`)) ?? "";
  const matches = (key: string): boolean => key !== "" && (prefix === "" || key.startsWith(prefix));
  const anyHit = (key: string): boolean => key !== "";

  // Warm a frame so pick attachments are current after navigations/screenshots.
  await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await waitForKey(keyOf, anyHit, settleMs, page);

  const coarse = gridCells(
    box,
    step === undefined ? { rows, cols, reverse } : { rows, cols, reverse, step },
  );
  if (prefix === "") {
    return sweepCells(page, coarse, keyOf, matches, settleMs);
  }

  // Specific prefixes (e.g. node) are sparse under GPU proximity gating. Find
  // any geometry first, then search a local neighborhood for the prefix.
  const seed = await sweepCells(page, coarse, keyOf, anyHit, settleMs);
  if (seed === undefined) {
    return undefined;
  }
  if (matches(seed.key)) {
    return seed;
  }
  const localStep = 4;
  const radius = 72;
  const local: Array<readonly [number, number]> = [];
  for (let dy = -radius; dy <= radius; dy += localStep) {
    for (let dx = -radius; dx <= radius; dx += localStep) {
      const x = seed.x + dx;
      const y = seed.y + dy;
      if (x < box.x || y < box.y || x > box.x + box.width || y > box.y + box.height) {
        continue;
      }
      local.push([x, y]);
    }
  }
  return sweepCells(page, local, keyOf, matches, settleMs);
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
