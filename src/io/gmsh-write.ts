import { topologyFor, type ElementFamily, type ElementShape } from "../elements/shapes";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
} from "../elements/shapes";
import type { FemModel, ModelSet, ModelResultField } from "./model";
import type { WriteOptions } from "./parse";
import { noopProgress } from "./progress";

const GMSH_TYPES: ReadonlyMap<ElementShape, number> = new Map([
  [POINT_SHAPE, 15],
  [LINE_SHAPE, 1],
  [LINE3_SHAPE, 8],
  [TET4_SHAPE, 4],
  [TET10_SHAPE, 11],
  [HEX8_SHAPE, 5],
  [HEX20_SHAPE, 17],
]);

/**
 * Writes an ASCII Gmsh MSH 2.2 file. Element sets become physical groups,
 * node ids and element ids are preserved verbatim, and results are written as
 * `$NodeData`/`$ElementData` blocks.
 */
export function writeGmsh(model: FemModel, options: WriteOptions = {}): string {
  const onProgress = options.onProgress ?? noopProgress;
  const parts: string[] = [];
  const elementSets = model.sets.filter((set) => set.kind === "element");
  parts.push("$MeshFormat", "2.2 0 8", "$EndMeshFormat");
  const physicalOf = writePhysicalNames(parts, model, elementSets);
  onProgress({ fraction: 0.2, message: "Writing nodes" });
  writeNodes(parts, model);
  onProgress({ fraction: 0.5, message: "Writing elements" });
  writeElements(parts, model, physicalOf);
  writeResults(parts, model);
  onProgress({ fraction: 1, message: "Finished writing Gmsh" });
  return parts.join("\n") + "\n";
}

function writePhysicalNames(
  parts: string[],
  model: FemModel,
  sets: readonly ModelSet[],
): ReadonlyMap<number, number> {
  const physicalOf = new Map<number, number>();
  if (sets.length === 0) {
    return physicalOf;
  }
  const shapeOf = elementShapeOf(model);
  parts.push("$PhysicalNames", String(sets.length));
  sets.forEach((set, index) => {
    const dim = setDimension(set, shapeOf);
    parts.push(`${String(dim)} ${String(index + 1)} "${set.name}"`);
    for (const id of set.ids) {
      if (shapeOf.has(id)) {
        physicalOf.set(id, index + 1);
      }
    }
  });
  parts.push("$EndPhysicalNames");
  return physicalOf;
}

function elementShapeOf(model: FemModel): ReadonlyMap<number, ElementShape> {
  const map = new Map<number, ElementShape>();
  for (const block of model.elementBlocks) {
    for (const id of block.ids) {
      map.set(id, block.shape);
    }
  }
  return map;
}

function setDimension(set: ModelSet, shapeOf: ReadonlyMap<number, ElementShape>): number {
  for (const id of set.ids) {
    const shape = shapeOf.get(id);
    if (shape !== undefined) {
      return familyDimension(shape.family);
    }
  }
  return 3;
}

function familyDimension(family: ElementFamily): number {
  if (family === "point") {
    return 0;
  }
  if (family === "line") {
    return 1;
  }
  return 3;
}

function writeNodes(parts: string[], model: FemModel): void {
  parts.push("$Nodes", String(model.nodes.count));
  const coords = model.nodes.coordinates;
  for (let index = 0; index < model.nodes.count; index += 1) {
    const id = model.nodes.ids[index] ?? 0;
    const x = coords[3 * index];
    const y = coords[3 * index + 1];
    const z = coords[3 * index + 2];
    parts.push(`${String(id)} ${formatNumber(x)} ${formatNumber(y)} ${formatNumber(z)}`);
  }
  parts.push("$EndNodes");
}

function writeElements(
  parts: string[],
  model: FemModel,
  physicalOf: ReadonlyMap<number, number>,
): void {
  let count = 0;
  for (const block of model.elementBlocks) {
    count += block.count;
  }
  parts.push("$Elements", String(count));
  for (const block of model.elementBlocks) {
    const type = GMSH_TYPES.get(block.shape) ?? 0;
    const nodeCount = topologyFor(block.shape).nodeCount;
    for (let element = 0; element < block.count; element += 1) {
      const id = block.ids[element] ?? 0;
      const physical = physicalOf.get(id) ?? 0;
      const nodes: string[] = [];
      for (let node = 0; node < nodeCount; node += 1) {
        nodes.push(String(block.connectivity[element * nodeCount + node] ?? 0));
      }
      parts.push(`${String(id)} ${String(type)} 2 ${String(physical)} 0 ${nodes.join(" ")}`);
    }
  }
  parts.push("$EndElements");
}

function writeResults(parts: string[], model: FemModel): void {
  for (const result of model.results) {
    if (result.location === "node") {
      writeDataSection(parts, result, "NodeData");
    } else {
      writeDataSection(parts, result, "ElementData");
    }
  }
}

function writeDataSection(parts: string[], result: ModelResultField, section: string): void {
  if (result.ids.length === 0) {
    return;
  }
  parts.push(
    `$${section}`,
    "1",
    `"${result.name}"`,
    "1",
    "0.0",
    "3",
    "0",
    String(result.components),
    String(result.ids.length),
  );
  for (let index = 0; index < result.ids.length; index += 1) {
    const values: string[] = [];
    for (let component = 0; component < result.components; component += 1) {
      values.push(formatNumber(result.values[index * result.components + component]));
    }
    parts.push(`${String(result.ids[index] ?? 0)} ${values.join(" ")}`);
  }
  parts.push(`$End${section}`);
}

function formatNumber(value: number | undefined): string {
  return String(value ?? 0);
}
