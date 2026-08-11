import { topologyFor, type ElementShape } from "../elements/shapes";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
} from "../elements/shapes";
import type { FemModel, ModelResultField } from "./model";

const VTK_TYPES: ReadonlyMap<ElementShape, number> = new Map([
  [POINT_SHAPE, 1],
  [LINE_SHAPE, 3],
  [TRIANGLE_SHAPE, 5],
  [QUAD_SHAPE, 9],
  [LINE3_SHAPE, 21],
  [TET4_SHAPE, 10],
  [TET10_SHAPE, 24],
  [HEX8_SHAPE, 12],
  [HEX20_SHAPE, 25],
]);

/**
 * Writes an ASCII VTK legacy unstructured grid. Nodes are written in row order
 * with implicit ids 0..n-1, so results are exported only when their ids are
 * exactly the contiguous entity sequence.
 */
export function writeVtk(model: FemModel): string {
  const lines: string[] = [];
  const cellCount = totalCells(model);
  lines.push("# vtk DataFile Version 5.0", "femgx export", "ASCII", "DATASET UNSTRUCTURED_GRID");
  lines.push(`POINTS ${String(model.nodes.count)} double`);
  writeCoordinates(model, lines);
  writeCells(model, lines, cellCount);
  writePointData(model, lines);
  writeCellData(model, lines, cellCount);
  return lines.join("\n") + "\n";
}

function totalCells(model: FemModel): number {
  let count = 0;
  for (const block of model.elementBlocks) {
    count += block.count;
  }
  return count;
}

function writeCoordinates(model: FemModel, lines: string[]): void {
  const coords = model.nodes.coordinates;
  for (let index = 0; index < model.nodes.count; index += 1) {
    const x = coords[3 * index];
    const y = coords[3 * index + 1];
    const z = coords[3 * index + 2];
    lines.push(`${formatNumber(x)} ${formatNumber(y)} ${formatNumber(z)}`);
  }
}

function writeCells(model: FemModel, lines: string[], cellCount: number): void {
  let connectivitySize = 0;
  for (const block of model.elementBlocks) {
    connectivitySize += block.count * topologyFor(block.shape).nodeCount;
  }
  lines.push(`CELLS ${String(cellCount)} ${String(connectivitySize + cellCount)}`);
  for (const block of model.elementBlocks) {
    const nodeCount = topologyFor(block.shape).nodeCount;
    for (let element = 0; element < block.count; element += 1) {
      const start = element * nodeCount;
      const connectivity: string[] = [];
      for (let node = 0; node < nodeCount; node += 1) {
        connectivity.push(formatNumber(block.connectivity[start + node] ?? 0));
      }
      lines.push(`${String(nodeCount)} ${connectivity.join(" ")}`);
    }
  }
  lines.push(`CELL_TYPES ${String(cellCount)}`);
  for (const block of model.elementBlocks) {
    const type = VTK_TYPES.get(block.shape);
    for (let element = 0; element < block.count; element += 1) {
      lines.push(formatNumber(type));
    }
  }
}

function writePointData(model: FemModel, lines: string[]): void {
  const results = model.results.filter(
    (result) => result.location === "node" && isContiguous(result.ids, model.nodes.count),
  );
  if (results.length === 0) {
    return;
  }
  lines.push(`POINT_DATA ${String(model.nodes.count)}`);
  writeAttributes(lines, results);
}

function writeCellData(model: FemModel, lines: string[], cellCount: number): void {
  const results = model.results.filter(
    (result) => result.location === "element" && isContiguous(result.ids, cellCount),
  );
  if (results.length === 0) {
    return;
  }
  lines.push(`CELL_DATA ${String(cellCount)}`);
  writeAttributes(lines, results);
}

function writeAttributes(lines: string[], results: readonly ModelResultField[]): void {
  for (const result of results) {
    if (result.components === 1) {
      lines.push(`SCALARS ${result.name} double`, "LOOKUP_TABLE default");
    } else if (result.components === 3) {
      lines.push(`VECTORS ${result.name} double`);
    } else {
      continue;
    }
    writeResultValues(lines, result);
  }
}

function writeResultValues(lines: string[], result: ModelResultField): void {
  for (const value of result.values) {
    lines.push(formatNumber(value));
  }
}

function isContiguous(ids: Uint32Array, expected: number): boolean {
  if (ids.length !== expected) {
    return false;
  }
  for (let index = 0; index < ids.length; index += 1) {
    if ((ids[index] ?? 0) !== index) {
      return false;
    }
  }
  return true;
}

function formatNumber(value: number | undefined): string {
  return String(value ?? 0);
}
