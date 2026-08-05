import { expect, type Locator, type Page } from "@playwright/test";

/** True when the canvas drawing buffer contains any non-transparent pixel. */
export async function drawnPixels(canvas: Locator): Promise<boolean> {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (context === null) {
      return false;
    }
    const { data } = context.getImageData(0, 0, element.width, element.height);
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index + 3] ?? 0) !== 0) {
        return true;
      }
    }
    return false;
  });
}

/** A deterministic fingerprint of the canvas drawing buffer. */
export async function pixelHash(canvas: Locator): Promise<string> {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (context === null) {
      return "no-context";
    }
    const { data } = context.getImageData(0, 0, element.width, element.height);
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
  });
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
  /** Milliseconds to wait after each move so async pick readback settles. */
  readonly settleMs?: number;
  /** Sweep from the bottom-right toward the top-left (for edge-near targets). */
  readonly reverse?: boolean;
  /** When set, scan with a fixed pixel step instead of the fractional grid. */
  readonly step?: number;
}

/**
 * Sweeps the pointer across the canvas until the dataset key resolves a hit
 * matching `options.prefix`. The demo pick is CPU raycasting with a 10px node
 * radius in both renderers, so a resolved hit is deterministic on the default
 * CPU lane. Returns the canvas point and key, or `undefined` when no grid
 * point resolves.
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
    settleMs = 0,
    reverse = false,
    step,
  } = options;
  const keyOf = async (): Promise<string> => (await canvas.getAttribute(`data-${attribute}`)) ?? "";
  const cells: Array<readonly [number, number]> = [];
  if (step === undefined) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        cells.push([
          Math.round(box.x + ((col + 0.5) / cols) * box.width),
          Math.round(box.y + ((row + 0.5) / rows) * box.height),
        ]);
      }
    }
  } else {
    for (let y = 0; y < box.height; y += step) {
      for (let x = 0; x < box.width; x += step) {
        cells.push([Math.round(box.x + x + step / 2), Math.round(box.y + y + step / 2)]);
      }
    }
  }
  const ordered = reverse ? [...cells].reverse() : cells;
  for (const [x, y] of ordered) {
    await page.mouse.move(x, y);
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    const key = await keyOf();
    if (key !== "" && (prefix === "" || key.startsWith(prefix))) {
      return { x, y, key };
    }
  }
  return undefined;
}

/**
 * A sweep that must resolve. On the deterministic CPU lane a miss means the
 * picking path is broken, so this is a real assertion: it fails the test with
 * `message` instead of letting the caller skip.
 */
export async function requireHit(
  page: Page,
  canvas: Locator,
  options: SweepOptions,
  message: string,
): Promise<SweepHit> {
  const hit = await sweepForHit(page, canvas, options);
  expect(hit, message).toBeDefined();
  if (hit === undefined) {
    throw new Error(message);
  }
  return hit;
}
