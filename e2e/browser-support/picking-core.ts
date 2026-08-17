import { type Page } from "@playwright/test";
import type { Box } from "./browser";
import type { SweepHit } from "./picking-types";

const MAX_DISCOVERY_CELLS = 100;

/**
 * Polls the canvas dataset after a move until a key appears, matches the
 * prefix, or `settleMs` elapses. Non-matching non-empty keys settle early so
 * the sweep can advance.
 */
export async function waitForKey(
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

/** Builds a bounded pointer-discovery grid for a canvas interaction area. */
export function gridCells(
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
        if (cells.length >= MAX_DISCOVERY_CELLS) {
          return options.reverse ? [...cells].reverse() : cells;
        }
      }
    }
  } else {
    for (let y = 0; y < box.height; y += options.step) {
      for (let x = 0; x < box.width; x += options.step) {
        cells.push([
          Math.round(box.x + x + options.step / 2),
          Math.round(box.y + y + options.step / 2),
        ]);
        if (cells.length >= MAX_DISCOVERY_CELLS) {
          return options.reverse ? [...cells].reverse() : cells;
        }
      }
    }
  }
  return options.reverse ? [...cells].reverse() : cells;
}

/** Moves the real browser pointer through cells until a dataset key matches. */
export async function sweepCells(
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
