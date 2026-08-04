import { topologyFor, type ElementShape } from "../elements/shapes";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
} from "../elements/shapes";
import type { FemModel } from "./model";
import type { WriteOptions } from "./parse";
import { noopProgress } from "./progress";

const ABAQUS_TYPES: ReadonlyMap<ElementShape, string> = new Map([
  [POINT_SHAPE, "MASS"],
  [LINE_SHAPE, "T3D2"],
  [LINE3_SHAPE, "T3D3"],
  [TET4_SHAPE, "C3D4"],
  [TET10_SHAPE, "C3D10"],
  [HEX8_SHAPE, "C3D8"],
  [HEX20_SHAPE, "C3D20"],
]);

const ITEMS_PER_LINE = 16;

/**
 * Writes an Abaqus input deck. Node and element ids are preserved verbatim,
 * element blocks use their native types, and node/element sets become
 * `*NSET`/`*ELSET` blocks. Long data lines are wrapped with continuation
 * commas.
 */
export function writeAbaqus(model: FemModel, options: WriteOptions = {}): string {
  const onProgress = options.onProgress ?? noopProgress;
  const parts: string[] = [];
  parts.push("*HEADING", "femgx export", "*NODE");
  writeNodes(parts, model);
  onProgress({ fraction: 0.5, message: "Writing elements" });
  writeElementBlocks(parts, model);
  writeSets(parts, model);
  onProgress({ fraction: 1, message: "Finished writing Abaqus" });
  return parts.join("\n") + "\n";
}

function writeNodes(parts: string[], model: FemModel): void {
  const coords = model.nodes.coordinates;
  for (let index = 0; index < model.nodes.count; index += 1) {
    const id = model.nodes.ids[index] ?? 0;
    const x = coords[3 * index];
    const y = coords[3 * index + 1];
    const z = coords[3 * index + 2];
    parts.push(`${String(id)}, ${formatNumber(x)}, ${formatNumber(y)}, ${formatNumber(z)}`);
  }
}

function writeElementBlocks(parts: string[], model: FemModel): void {
  for (const block of model.elementBlocks) {
    const type = ABAQUS_TYPES.get(block.shape);
    if (type === undefined) {
      continue;
    }
    const nodeCount = topologyFor(block.shape).nodeCount;
    parts.push(`*ELEMENT, TYPE=${type}`);
    for (let element = 0; element < block.count; element += 1) {
      const items: number[] = [block.ids[element] ?? 0];
      for (let node = 0; node < nodeCount; node += 1) {
        items.push(block.connectivity[element * nodeCount + node] ?? 0);
      }
      parts.push(...wrapItems(items));
    }
  }
}

function writeSets(parts: string[], model: FemModel): void {
  for (const set of model.sets) {
    const keyword = set.kind === "node" ? "NSET" : "ELSET";
    parts.push(`*${keyword}, ${keyword}=${set.name}`);
    parts.push(...wrapItems(set.ids));
  }
}

function wrapItems(items: ArrayLike<number>): string[] {
  const lines: string[] = [];
  for (let start = 0; start < items.length; start += ITEMS_PER_LINE) {
    const slice: number[] = [];
    const end = Math.min(start + ITEMS_PER_LINE, items.length);
    for (let index = start; index < end; index += 1) {
      slice.push(items[index] ?? 0);
    }
    const isLast = end === items.length;
    lines.push(`${slice.join(", ")}${isLast ? "" : ","}`);
  }
  return lines;
}

function formatNumber(value: number | undefined): string {
  return String(value ?? 0);
}
