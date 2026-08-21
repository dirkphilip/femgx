import { type Locator, type Page } from "@playwright/test";
import type { Box } from "./browser";
import { sweepCells } from "./picking-core";
import type { RegionRect, SweepHit, SweepOptions } from "./picking-types";

/** Selects the region-query granularity implied by a dataset key. */
export function regionGranularityForKey(
  prefix: string,
  selectedGranularity: string | null,
): string {
  const kind = prefix.split(":", 1)[0];
  if (kind === "n") return "node";
  if (kind === "f") return "face";
  if (kind === "e") return "element";
  if (kind === "i") return "partOccurrence";
  if (kind === "p") return "part";
  if (kind === "ed") return "edge";
  return selectedGranularity ?? "element";
}

/** Converts one region-query identity into the workbench dataset key format. */
export function regionTargetKey(target: unknown): string | undefined {
  if (typeof target !== "object" || target === null || !("kind" in target)) return undefined;
  const value = target as Record<string, unknown>;
  const kind = value["kind"];
  const text = (key: string): string | undefined => {
    const result = value[key];
    return typeof result === "string" || typeof result === "number" ? String(result) : undefined;
  };
  const partOccurrenceId = text("partOccurrenceId");
  switch (kind) {
    case "node":
      return partOccurrenceId === undefined || text("nodeId") === undefined
        ? undefined
        : `n:${partOccurrenceId}:${text("nodeId")}`;
    case "face":
      return partOccurrenceId === undefined ||
        text("elementId") === undefined ||
        text("faceIndex") === undefined
        ? undefined
        : `f:${partOccurrenceId}:${text("elementId")}:${text("faceIndex")}`;
    case "element":
      return partOccurrenceId === undefined || text("elementId") === undefined
        ? undefined
        : `e:${partOccurrenceId}:${text("elementId")}`;
    case "partOccurrence":
      return partOccurrenceId === undefined ? undefined : `i:${partOccurrenceId}`;
    case "part": {
      const partId = text("partId");
      return partId === undefined ? undefined : `p:${partId}`;
    }
    case "edge":
      return partOccurrenceId === undefined || text("key") === undefined
        ? undefined
        : `ed:${partOccurrenceId}:${text("key")}`;
    default:
      return undefined;
  }
}

/** Subdivides one region in stable top-left, top-right, bottom-left, bottom-right order. */
export function subdivideRegion(region: RegionRect): readonly RegionRect[] {
  const middleX = region.left + region.width / 2;
  const middleY = region.top + region.height / 2;
  return [
    regionRect(region.left, region.top, middleX, middleY),
    regionRect(middleX, region.top, region.right, middleY),
    regionRect(region.left, middleY, middleX, region.bottom),
    regionRect(middleX, middleY, region.right, region.bottom),
  ];
}

function regionRect(left: number, top: number, right: number, bottom: number): RegionRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

async function regionKeys(
  canvas: Locator,
  region: RegionRect,
  granularity: string,
): Promise<readonly string[] | undefined> {
  return canvas.evaluate(
    async (_element, { value, level }) => {
      const pickRegionKeys = (
        window as typeof window & {
          femgxDemo?: {
            pickRegionKeys?: (rect: RegionRect, requested: string) => Promise<readonly string[]>;
          };
        }
      ).femgxDemo?.pickRegionKeys;
      return pickRegionKeys === undefined ? undefined : pickRegionKeys(value, level);
    },
    { value: region, level: granularity },
  );
}

async function locateRegionCell(
  canvas: Locator,
  region: RegionRect,
  granularity: string,
  prefix: string,
  depth = 0,
): Promise<{ readonly region: RegionRect; readonly key: string } | undefined> {
  const targets = await regionKeys(canvas, region, granularity);
  const key = targets?.find((value) => value.startsWith(prefix));
  if (key === undefined) return undefined;
  if (region.width <= 4 || region.height <= 4 || depth >= 8) return { region, key };
  for (const child of subdivideRegion(region)) {
    const result = await locateRegionCell(canvas, child, granularity, prefix, depth + 1);
    if (result !== undefined) return result;
  }
  return { region, key };
}

function regionProbePoints(region: RegionRect): readonly (readonly [number, number])[] {
  const points: Array<readonly [number, number]> = [];
  for (let y = Math.floor(region.top); y <= Math.ceil(region.bottom); y += 1) {
    for (let x = Math.floor(region.left); x <= Math.ceil(region.right); x += 1) {
      points.push([x, y]);
    }
  }
  return points;
}

/** Narrows a region-query hit to a small pointer-probe rectangle. */
export async function locateHitByRegion(
  page: Page,
  canvas: Locator,
  box: Box,
  options: Required<Pick<SweepOptions, "prefix" | "attribute" | "settleMs" | "fresh">>,
): Promise<SweepHit | undefined> {
  const canvasBox = await canvas.boundingBox();
  if (canvasBox === null) return undefined;
  const granularity = regionGranularityForKey(
    options.prefix,
    await canvas.getAttribute("data-selection-granularity"),
  );
  const localRegion = regionRect(
    box.x - canvasBox.x,
    box.y - canvasBox.y,
    box.x - canvasBox.x + box.width,
    box.y - canvasBox.y + box.height,
  );
  const located = await locateRegionCell(canvas, localRegion, granularity, options.prefix);
  if (located === undefined) return undefined;
  const keyOf = async (): Promise<string> =>
    (await canvas.getAttribute(`data-${options.attribute}`)) ?? "";
  const clearKey = async (): Promise<void> => {
    await canvas.evaluate((node, name) => {
      (node as HTMLElement).dataset[name] = "";
    }, options.attribute);
  };
  const matches = (key: string): boolean => key === located.key;
  const points = regionProbePoints(located.region).map(
    ([x, y]) => [Math.round(canvasBox.x + x), Math.round(canvasBox.y + y)] as const,
  );
  return sweepCells(page, points, {
    ...(options.fresh ? { clearKey } : {}),
    keyOf,
    matches,
    settleMs: options.settleMs,
  });
}
