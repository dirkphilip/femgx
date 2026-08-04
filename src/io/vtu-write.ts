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
import type { FemModel, ResultField } from "./model";
import type { WriteOptions } from "./parse";
import { noopProgress } from "./progress";

const VTK_TYPES: ReadonlyMap<ElementShape, number> = new Map([
  [POINT_SHAPE, 1],
  [LINE_SHAPE, 3],
  [LINE3_SHAPE, 21],
  [TET4_SHAPE, 10],
  [TET10_SHAPE, 24],
  [HEX8_SHAPE, 12],
  [HEX20_SHAPE, 25],
]);

const NUMBERS_PER_LINE = 8;

/**
 * Writes a VTK XML UnstructuredGrid (`.vtu`) with ASCII data arrays. Results
 * are exported when their ids are the contiguous entity sequence; metadata is
 * stored in a `FieldData` block so it round-trips.
 */
export function writeVtu(model: FemModel, options: WriteOptions = {}): string {
  const onProgress = options.onProgress ?? noopProgress;
  const cellCount = totalCells(model);
  const parts: string[] = [];
  parts.push('<?xml version="1.0"?>');
  parts.push('<VTKFile type="UnstructuredGrid" version="1.0" byte_order="LittleEndian">');
  parts.push("  <UnstructuredGrid>");
  parts.push(
    `    <Piece NumberOfPoints="${String(model.nodes.count)}" NumberOfCells="${String(cellCount)}">`,
  );
  parts.push("      <Points>");
  parts.push('        <DataArray type="Float64" NumberOfComponents="3" format="ascii">');
  pushNumbers(parts, model.nodes.coordinates);
  parts.push("        </DataArray>");
  parts.push("      </Points>");
  parts.push("      <Cells>");
  pushCellArrays(parts, model);
  parts.push("      </Cells>");
  onProgress({ fraction: 0.5, message: "Writing data arrays" });
  pushPointData(parts, model);
  pushCellData(parts, model);
  pushFieldData(parts, model);
  parts.push("    </Piece>");
  parts.push("  </UnstructuredGrid>");
  parts.push("</VTKFile>");
  onProgress({ fraction: 1, message: "Finished writing VTU" });
  return parts.join("\n") + "\n";
}

function totalCells(model: FemModel): number {
  let count = 0;
  for (const block of model.elementBlocks) {
    count += block.count;
  }
  return count;
}

function pushCellArrays(parts: string[], model: FemModel): void {
  const connectivity: number[] = [];
  const offsets: number[] = [];
  const types: number[] = [];
  let offset = 0;
  for (const block of model.elementBlocks) {
    const nodeCount = topologyFor(block.shape).nodeCount;
    const type = VTK_TYPES.get(block.shape);
    for (let element = 0; element < block.count; element += 1) {
      offset += nodeCount;
      offsets.push(offset);
      types.push(type ?? 0);
      for (let node = 0; node < nodeCount; node += 1) {
        connectivity.push(block.connectivity[element * nodeCount + node] ?? 0);
      }
    }
  }
  parts.push('        <DataArray type="Int64" Name="connectivity" format="ascii">');
  pushNumbers(parts, connectivity);
  parts.push("        </DataArray>");
  parts.push('        <DataArray type="Int64" Name="offsets" format="ascii">');
  pushNumbers(parts, offsets);
  parts.push("        </DataArray>");
  parts.push('        <DataArray type="Int64" Name="types" format="ascii">');
  pushNumbers(parts, types);
  parts.push("        </DataArray>");
}

function pushPointData(parts: string[], model: FemModel): void {
  const results = model.results.filter(
    (result) => result.location === "node" && isContiguous(result.ids, model.nodes.count),
  );
  pushResults(parts, results, "PointData");
}

function pushCellData(parts: string[], model: FemModel): void {
  const cellCount = totalCells(model);
  const results = model.results.filter(
    (result) => result.location === "element" && isContiguous(result.ids, cellCount),
  );
  pushResults(parts, results, "CellData");
}

function pushResults(parts: string[], results: readonly ResultField[], section: string): void {
  if (results.length === 0) {
    return;
  }
  parts.push(`      <${section}>`);
  for (const result of results) {
    parts.push(
      `        <DataArray type="Float64" Name="${escapeXml(result.name)}" NumberOfComponents="${String(result.components)}" format="ascii">`,
    );
    pushNumbers(parts, result.values);
    parts.push("        </DataArray>");
  }
  parts.push(`      </${section}>`);
}

function pushFieldData(parts: string[], model: FemModel): void {
  const entries = Object.entries(model.metadata);
  if (entries.length === 0) {
    return;
  }
  parts.push("      <FieldData>");
  for (const [key, value] of entries) {
    const metaType = typeof value;
    parts.push(
      `        <DataArray type="String" Name="${escapeXml(key)}" NumberOfTuples="1" femgx-type="${metaType}">${escapeXml(String(value))}</DataArray>`,
    );
  }
  parts.push("      </FieldData>");
}

function pushNumbers(parts: string[], values: ArrayLike<number>): void {
  const line: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    line.push(formatNumber(values[index]));
    if (line.length === NUMBERS_PER_LINE) {
      parts.push(`          ${line.join(" ")}`);
      line.length = 0;
    }
  }
  if (line.length > 0) {
    parts.push(`          ${line.join(" ")}`);
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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
