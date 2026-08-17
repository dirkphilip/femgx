import { expect, type Locator, type Page } from "@playwright/test";
import { canvasInteractionBox, type Box } from "./browser";
import { gridCells, sweepCells, waitForKey } from "./picking-core";
import { locateHitByRegion } from "./picking-region";
import type { SweepHit, SweepOptions } from "./picking-types";

async function probeCells(
  canvas: Locator,
  canvasBox: Box,
  cells: ReadonlyArray<readonly [number, number]>,
  attribute: "pick" | "hovered",
  prefix: string,
): Promise<{ readonly available: boolean; readonly hit?: SweepHit }> {
  // Locate a candidate through the existing devtools viewport seam without
  // paying one pointer-event timeout per empty pixel. The caller still moves
  // the real pointer to the result and verifies the published interaction key.
  return canvas.evaluate(
    async (element, { attribute: keyName, boxX, boxY, cells: points, prefix: keyPrefix }) => {
      const probe = (
        window as typeof window & {
          femgxDemo?: {
            probePick?: (
              x: number,
              y: number,
            ) => Promise<{ readonly pickKey: string; readonly hoveredKey: string }>;
          };
        }
      ).femgxDemo?.probePick;
      if (probe === undefined) return { available: false };
      for (const [x, y] of points) {
        if (document.elementFromPoint(x, y) !== element) continue;
        const result = await probe(x - boxX, y - boxY);
        const key = keyName === "pick" ? result.pickKey : result.hoveredKey;
        if (key !== "" && (keyPrefix === "" || key.startsWith(keyPrefix))) {
          return { available: true, hit: { x, y, key } };
        }
      }
      return { available: true };
    },
    { attribute, boxX: canvasBox.x, boxY: canvasBox.y, cells, prefix },
  );
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
  const canvasBox = await canvas.boundingBox();
  if (canvasBox === null) {
    throw new Error("canvas has no bounding box");
  }
  const box = await canvasInteractionBox(canvas);
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

  const localized = await locateHitByRegion(page, canvas, box, {
    prefix,
    attribute,
    settleMs,
    fresh,
  });
  if (localized !== undefined) return localized;

  if (prefix !== "") {
    const local = gridCells(box, { rows: 8, cols: 10, reverse: false });
    const direct = await probeCells(canvas, canvasBox, [center, ...local], attribute, prefix);
    if (direct.available) {
      if (direct.hit !== undefined) {
        await clearKey();
        await page.mouse.move(direct.hit.x, direct.hit.y);
        const key = await waitForKey(keyOf, matches, settleMs, page);
        if (matches(key)) return { ...direct.hit, key };
      }
      // Software adapters can expose a stale pick attachment to the direct
      // probe. Give real pointer events a chance before reporting no hit.
      return sweepCells(page, local, {
        clearKey,
        keyOf,
        matches,
        settleMs: Math.min(settleMs, 100),
      });
    }
    return sweepCells(page, local, { clearKey, keyOf, matches, settleMs });
  }

  const grid = gridCells(
    box,
    step === undefined ? { rows, cols, reverse } : { rows, cols, reverse, step },
  );
  const coarse = fresh
    ? [[Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)] as const, ...grid]
    : grid;
  const directCells = reverse
    ? coarse
    : [...coarse].sort(
        (a, b) =>
          Math.hypot(a[0] - center[0], a[1] - center[1]) -
          Math.hypot(b[0] - center[0], b[1] - center[1]),
      );
  const direct = await probeCells(canvas, canvasBox, directCells, attribute, prefix);
  if (direct.available) {
    if (direct.hit !== undefined) {
      await clearKey();
      await page.mouse.move(direct.hit.x, direct.hit.y);
      const key = await waitForKey(keyOf, matches, settleMs, page);
      if (matches(key)) return { ...direct.hit, key };
    }
    // A probe can observe a stale or unavailable pick attachment on a
    // software adapter. Fall back to real pointer events before declaring
    // that the exposed canvas has no hit.
    return sweepCells(page, coarse, {
      ...(fresh ? { clearKey } : {}),
      keyOf,
      matches,
      settleMs,
    });
  }
  const sweep = (cells: ReadonlyArray<readonly [number, number]>) =>
    sweepCells(page, cells, {
      ...(fresh ? { clearKey } : {}),
      keyOf,
      matches,
      settleMs,
    });
  return sweep(coarse);
}

/** A sweep that must resolve on the required hardware-WebGPU Chrome lane. */
export async function requireHit(
  page: Page,
  canvas: Locator,
  options: SweepOptions,
  message: string,
): Promise<SweepHit> {
  const hit = await sweepForHit(page, canvas, options);
  const prefix = options.prefix ?? "<any>";
  expect(hit, `${message} (target prefix: ${prefix}; region search is bounded)`).toBeDefined();
  return hit as SweepHit;
}
