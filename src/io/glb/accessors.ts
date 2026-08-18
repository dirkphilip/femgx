import { Accessor } from "@gltf-transform/core";
import type { Primitive } from "@gltf-transform/core";
import { computePositionsBounds, type Bounds } from "../../geometry/part";
import type { GlbDiagnostics } from "./diagnostics";

export interface PositionData {
  readonly positions: Float32Array;
  readonly bounds: Bounds;
}

interface IndexData {
  readonly indices: Uint32Array;
  readonly maxIndex: number;
}

/** Per-import accessor cache shared by every reusable glTF mesh. */
export interface GlbGeometryCache {
  readonly positions: Map<Accessor, PositionData>;
  readonly indices: Map<Accessor, IndexData>;
  readonly sequentialIndices: Map<number, Uint32Array>;
}

/** Creates the accessor-identity caches owned by one import operation. */
export function createGlbGeometryCache(): GlbGeometryCache {
  return { positions: new Map(), indices: new Map(), sequentialIndices: new Map() };
}

/** Reads, validates, and bounds one POSITION accessor at most once per import. */
export function readPositionData(
  accessor: Accessor,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
  cache: GlbGeometryCache,
): PositionData {
  validatePositionAccessor(accessor, primitiveIndex, diagnostics);
  const cached = cache.positions.get(accessor);
  if (cached !== undefined) return cached;
  const packed = accessor.getArray();
  const positions =
    packed instanceof Float32Array && packed.length === accessor.getCount() * 3
      ? packed
      : unpackPositions(accessor, primitiveIndex, diagnostics);
  validateFinitePositions(positions, primitiveIndex, diagnostics);
  const result = { positions, bounds: computePositionsBounds(positions) };
  cache.positions.set(accessor, result);
  return result;
}

/** Reads and validates one primitive's promoted triangle index order. */
export function readPrimitiveIndices(
  primitive: Primitive,
  vertexCount: number,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
  cache: GlbGeometryCache,
): Uint32Array {
  const accessor = primitive.getIndices();
  if (accessor === null) {
    return nonIndexedTriangles(vertexCount, primitiveIndex, diagnostics, cache);
  }
  validateIndexAccessor(accessor, primitiveIndex, diagnostics);
  const cached = cache.indices.get(accessor);
  if (cached !== undefined) {
    validateIndexValue(cached.maxIndex, vertexCount, primitiveIndex, diagnostics);
    return cached.indices;
  }
  const data = unpackIndices(accessor, vertexCount, primitiveIndex, diagnostics);
  cache.indices.set(accessor, data);
  return data.indices;
}

function validatePositionAccessor(
  accessor: Accessor,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
): void {
  if (
    accessor.getType() !== "VEC3" ||
    accessor.getComponentType() !== Accessor.ComponentType["FLOAT"]
  ) {
    diagnostics.fatal(
      "glb-invalid-primitive",
      `Primitive ${primitiveIndex} POSITION must be a FLOAT VEC3 accessor.`,
    );
  }
  if (accessor.getCount() === 0) {
    diagnostics.fatal(
      "glb-invalid-primitive",
      `Primitive ${primitiveIndex} POSITION must not be empty.`,
    );
  }
}

function unpackPositions(
  accessor: Accessor,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
): Float32Array {
  const positions = new Float32Array(accessor.getCount() * 3);
  const value: number[] = [0, 0, 0];
  for (let index = 0; index < accessor.getCount(); index += 1) {
    accessor.getElement(index, value);
    for (let component = 0; component < 3; component += 1) {
      const componentValue = value[component];
      if (componentValue === undefined || !Number.isFinite(componentValue)) {
        diagnostics.fatal(
          "glb-invalid-position",
          `Primitive ${primitiveIndex} contains a non-finite POSITION component.`,
        );
      }
      positions[index * 3 + component] = componentValue;
    }
  }
  return positions;
}

function validateFinitePositions(
  positions: Float32Array,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
): void {
  for (const value of positions) {
    if (!Number.isFinite(value)) {
      diagnostics.fatal(
        "glb-invalid-position",
        `Primitive ${primitiveIndex} contains a non-finite POSITION component.`,
      );
    }
  }
}

function nonIndexedTriangles(
  vertexCount: number,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
  cache: GlbGeometryCache,
): Uint32Array {
  if (vertexCount % 3 !== 0) {
    diagnostics.fatal(
      "glb-invalid-index",
      `Primitive ${primitiveIndex} has ${vertexCount} non-indexed vertices, not a multiple of three.`,
    );
  }
  let indices = cache.sequentialIndices.get(vertexCount);
  if (indices === undefined) {
    indices = new Uint32Array(vertexCount);
    for (let index = 0; index < vertexCount; index += 1) indices[index] = index;
    cache.sequentialIndices.set(vertexCount, indices);
  }
  return indices;
}

function validateIndexAccessor(
  accessor: Accessor,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
): void {
  if (accessor.getType() !== "SCALAR" || !isUnsignedIndexType(accessor.getComponentType())) {
    diagnostics.fatal(
      "glb-invalid-index",
      `Primitive ${primitiveIndex} indices must use an unsigned byte, short, or int scalar accessor.`,
    );
  }
  if (accessor.getCount() % 3 !== 0) {
    diagnostics.fatal(
      "glb-invalid-index",
      `Primitive ${primitiveIndex} has ${accessor.getCount()} indices, not a multiple of three.`,
    );
  }
}

function unpackIndices(
  accessor: Accessor,
  vertexCount: number,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
): IndexData {
  const packed = accessor.getArray();
  const promoted = new Uint32Array(accessor.getCount());
  const packedAvailable =
    packed !== null && packed.length === promoted.length && !accessor.getNormalized();
  let maxIndex = 0;
  for (let index = 0; index < promoted.length; index += 1) {
    const value = packedAvailable ? (packed[index] ?? 0) : accessor.getScalar(index);
    validateIndexValue(value, vertexCount, primitiveIndex, diagnostics);
    promoted[index] = value;
    if (value > maxIndex) maxIndex = value;
  }
  return {
    indices: packedAvailable && packed instanceof Uint32Array ? packed : promoted,
    maxIndex,
  };
}

function validateIndexValue(
  value: number,
  vertexCount: number,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
): void {
  if (Number.isInteger(value) && value >= 0 && value < vertexCount) return;
  diagnostics.fatal(
    "glb-invalid-index",
    `Primitive ${primitiveIndex} index ${String(value)} is outside its POSITION accessor.`,
  );
}

function isUnsignedIndexType(componentType: number): boolean {
  return (
    componentType === Accessor.ComponentType["UNSIGNED_BYTE"] ||
    componentType === Accessor.ComponentType["UNSIGNED_SHORT"] ||
    componentType === Accessor.ComponentType["UNSIGNED_INT"]
  );
}
