import { createPartRecord, type Geometry, type PartId } from "../../geometry/part";
import type { StyleOverride } from "../../interaction/state";
import { transformPoint, type Mat4 } from "../../math/mat4";
import type { GlbPartRecord } from "./geometry";

const DEFAULT_COLOR = { r: 0.23, g: 0.51, b: 0.96, a: 1 } as const;
// The renderer expands indexed triangles for picking metadata. Bounded batches
// keep the resulting storage bindings inside WebGPU's portable 128 MiB limit.
const MAX_FLATTENED_TRIANGLES = 1_000_000;

export interface GlbPlacedPartRecord {
  readonly record: GlbPartRecord;
  readonly transform: Mat4;
}

/** Coalesces single-use display parts into bounded alpha-compatible batches. */
export function flattenPlacedParts(
  placed: readonly GlbPlacedPartRecord[],
): readonly GlbPartRecord[] {
  const groups = new Map<string, GlbPlacedPartRecord[]>();
  for (const entry of placed) {
    const key = styleKey(entry.record.style);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }
  return [...groups.values()]
    .flatMap(chunkPlacedGroup)
    .map((group, partId) => flattenPlacedGroup(group, partId));
}

function chunkPlacedGroup(group: readonly GlbPlacedPartRecord[]): GlbPlacedPartRecord[][] {
  const chunks: GlbPlacedPartRecord[][] = [];
  let chunk: GlbPlacedPartRecord[] = [];
  let triangleCount = 0;
  for (const entry of group) {
    const entryTriangles = triangleCountFor(entry.record.part.geometries);
    if (chunk.length > 0 && triangleCount + entryTriangles > MAX_FLATTENED_TRIANGLES) {
      chunks.push(chunk);
      chunk = [];
      triangleCount = 0;
    }
    chunk.push(entry);
    triangleCount += entryTriangles;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function flattenPlacedGroup(group: readonly GlbPlacedPartRecord[], partId: PartId): GlbPartRecord {
  const first = group[0];
  if (first === undefined) throw new Error("GLB placed-part group must not be empty");
  const geometries = group.flatMap(({ record }) => record.part.geometries);
  const output = allocateFlattenedGeometry(geometries);
  const offsets: FlattenOffsets = { position: 0, index: 0, edge: 0, color: 0 };
  for (const entry of group) appendPlacedRecord(output, offsets, entry);
  const firstColor = first.record.style.color ?? DEFAULT_COLOR;
  return {
    part: createPartRecord(partId, { geometries: [{ primitive: "triangles", ...output }] }),
    name: group.length === 1 ? first.record.name : `${group.length} GLB meshes`,
    style:
      group.length === 1
        ? first.record.style
        : { ...first.record.style, color: { r: 1, g: 1, b: 1, a: firstColor.a } },
  };
}

interface FlattenedGeometry {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly presentationEdges: Uint32Array;
  readonly primitiveColors: Float32Array;
}

interface FlattenOffsets {
  position: number;
  index: number;
  edge: number;
  color: number;
}

function allocateFlattenedGeometry(geometries: readonly Geometry[]): FlattenedGeometry {
  const sum = (length: (geometry: Geometry) => number): number =>
    geometries.reduce((total, geometry) => total + length(geometry), 0);
  return {
    positions: new Float32Array(sum((geometry) => geometry.positions.length)),
    indices: new Uint32Array(sum((geometry) => geometry.indices.length)),
    presentationEdges: new Uint32Array(
      sum((geometry) =>
        geometry.primitive === "triangles" ? (geometry.presentationEdges?.length ?? 0) : 0,
      ),
    ),
    primitiveColors: new Float32Array(
      sum((geometry) =>
        geometry.primitive === "triangles" ? (geometry.indices.length / 3) * 4 : 0,
      ),
    ),
  };
}

function appendPlacedRecord(
  output: FlattenedGeometry,
  offsets: FlattenOffsets,
  entry: GlbPlacedPartRecord,
): void {
  const color = entry.record.style.color ?? DEFAULT_COLOR;
  for (const geometry of entry.record.part.geometries) {
    appendTransformedPositions(
      output.positions,
      offsets.position,
      geometry.positions,
      entry.transform,
    );
    const vertexOffset = offsets.position / 3;
    for (const index of geometry.indices) output.indices[offsets.index++] = index + vertexOffset;
    if (geometry.primitive === "triangles") appendTriangleData(output, offsets, geometry, color);
    offsets.position += geometry.positions.length;
  }
}

function appendTriangleData(
  output: FlattenedGeometry,
  offsets: FlattenOffsets,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  color: { readonly r: number; readonly g: number; readonly b: number },
): void {
  const vertexOffset = offsets.position / 3;
  for (const index of geometry.presentationEdges ?? [])
    output.presentationEdges[offsets.edge++] = index + vertexOffset;
  const primitiveCount = geometry.indices.length / 3;
  if (geometry.primitiveColors === undefined) {
    for (let primitive = 0; primitive < primitiveCount; primitive += 1) {
      output.primitiveColors.set([color.r, color.g, color.b, 1], offsets.color + primitive * 4);
    }
  } else output.primitiveColors.set(geometry.primitiveColors, offsets.color);
  offsets.color += primitiveCount * 4;
}

function appendTransformedPositions(
  target: Float32Array,
  offset: number,
  source: Float32Array,
  transform: Mat4,
): void {
  for (let index = 0; index < source.length; index += 3) {
    const point = transformPoint(
      transform,
      source[index] ?? 0,
      source[index + 1] ?? 0,
      source[index + 2] ?? 0,
    );
    target.set(point, offset + index);
  }
}

function triangleCountFor(geometries: readonly Geometry[]): number {
  return geometries.reduce(
    (count, geometry) =>
      count + (geometry.primitive === "triangles" ? geometry.indices.length / 3 : 0),
    0,
  );
}

function styleKey(style: StyleOverride): string {
  return style.color === undefined ? "default" : `alpha:${style.color.a}`;
}
