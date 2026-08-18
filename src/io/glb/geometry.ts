import { Primitive } from "@gltf-transform/core";
import type { Material, Mesh, vec4 } from "@gltf-transform/core";
import { createPartRecord, type Bounds, type Part, type PartId } from "../../geometry/part";
import type { StyleOverride } from "../../interaction/state";
import { transformPoint, type Mat4 } from "../../math/mat4";
import type { GlbDiagnostics } from "./diagnostics";
import {
  readPositionData,
  readPrimitiveIndices,
  type GlbGeometryCache,
  type PositionData,
} from "./accessors";

const DEFAULT_COLOR = { r: 0.23, g: 0.51, b: 0.96, a: 1 } as const;

/** One reusable femgx part produced from one glTF mesh material group. */
export interface GlbPartRecord {
  readonly part: Part;
  readonly name: string;
  readonly style: StyleOverride;
}

export interface GlbPlacedPartRecord {
  readonly record: GlbPartRecord;
  readonly transform: Mat4;
}

/** Coalesces single-use display parts by their complete imported style. */
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
  return [...groups.values()].map((group, partId) => flattenPlacedGroup(group, partId));
}

/** Imports the supported primitives of one reusable glTF mesh. */
export function importMeshParts(
  mesh: Mesh,
  firstPartId: PartId,
  diagnostics: GlbDiagnostics,
  cache: GlbGeometryCache,
): readonly GlbPartRecord[] {
  const primitives = mesh.listPrimitives();
  const groups = new Map<Material | null, PrimitiveData[]>();
  for (let index = 0; index < primitives.length; index += 1) {
    const primitive = primitives[index];
    if (primitive === undefined) continue;
    const data = readPrimitive({
      mesh,
      primitive,
      primitiveIndex: index,
      diagnostics,
      cache,
    });
    if (data === undefined) continue;
    const material = primitive.getMaterial();
    const group = groups.get(material);
    if (group === undefined) groups.set(material, [data]);
    else group.push(data);
  }
  return [...groups.entries()].map(([material, group], groupIndex) =>
    importPrimitiveGroup({
      mesh,
      material,
      group,
      primitiveCount: primitives.length,
      partId: firstPartId + groupIndex,
      diagnostics,
    }),
  );
}

interface PrimitiveImport {
  readonly mesh: Mesh;
  readonly primitive: Primitive;
  readonly primitiveIndex: number;
  readonly diagnostics: GlbDiagnostics;
  readonly cache: GlbGeometryCache;
}

interface PrimitiveData extends PositionData {
  readonly primitiveIndex: number;
  readonly indices: Uint32Array;
}

function readPrimitive(input: PrimitiveImport): PrimitiveData | undefined {
  const { mesh, primitive, primitiveIndex, diagnostics, cache } = input;
  if (primitive.getMode() !== Primitive.Mode["TRIANGLES"]) {
    diagnostics.warning(
      "glb-unsupported-primitive-mode",
      `Skipped mesh ${displayName(mesh, "unnamed mesh")} primitive ${primitiveIndex}: only TRIANGLES are supported.`,
      `primitive-mode:${primitive.getMode()}`,
    );
    return undefined;
  }
  const position = primitive.getAttribute("POSITION");
  if (position === null) {
    diagnostics.warning(
      "glb-missing-position",
      `Skipped mesh ${displayName(mesh, "unnamed mesh")} primitive ${primitiveIndex}: POSITION is missing.`,
      `missing-position:${primitiveIndex}`,
    );
    return undefined;
  }
  const positionData = readPositionData(position, primitiveIndex, diagnostics, cache);
  const indices = readPrimitiveIndices(
    primitive,
    positionData.positions.length / 3,
    primitiveIndex,
    diagnostics,
    cache,
  );
  return { ...positionData, primitiveIndex, indices };
}

interface PrimitiveGroupImport {
  readonly mesh: Mesh;
  readonly material: Material | null;
  readonly group: readonly PrimitiveData[];
  readonly primitiveCount: number;
  readonly partId: PartId;
  readonly diagnostics: GlbDiagnostics;
}

function importPrimitiveGroup(input: PrimitiveGroupImport): GlbPartRecord {
  const { mesh, material, group, primitiveCount, partId, diagnostics } = input;
  const geometry = combinedGeometry(group);
  const part = createPartRecord(
    partId,
    { geometries: [{ primitive: "triangles", ...geometry }] },
    geometry.bounds,
  );
  return {
    part,
    name: primitiveGroupName(mesh, material, group, primitiveCount, partId),
    style: materialStyle(material, diagnostics),
  };
}

function combinedGeometry(group: readonly PrimitiveData[]): PositionData & {
  readonly indices: Uint32Array;
} {
  const first = group[0];
  if (first === undefined) throw new Error("GLB primitive group must not be empty");
  if (group.length === 1) return first;
  const sharedPositions = group.every((primitive) => primitive.positions === first.positions);
  const positionLength = sharedPositions
    ? first.positions.length
    : group.reduce((total, primitive) => total + primitive.positions.length, 0);
  const indexLength = group.reduce((total, primitive) => total + primitive.indices.length, 0);
  const positions = sharedPositions ? first.positions : new Float32Array(positionLength);
  const indices = new Uint32Array(indexLength);
  let positionOffset = 0;
  let indexOffset = 0;
  let bounds = first.bounds;
  for (const primitive of group) {
    if (sharedPositions) {
      indices.set(primitive.indices, indexOffset);
      indexOffset += primitive.indices.length;
      continue;
    }
    positions.set(primitive.positions, positionOffset);
    const vertexOffset = positionOffset / 3;
    for (const index of primitive.indices) indices[indexOffset++] = index + vertexOffset;
    positionOffset += primitive.positions.length;
    bounds = mergeBounds(bounds, primitive.bounds);
  }
  return { positions, indices, bounds };
}

function primitiveName(
  mesh: Mesh,
  material: Material | null,
  primitiveIndex: number,
  primitiveCount: number,
  partId: PartId,
): string {
  const meshName = displayName(mesh, "");
  const materialName = material === null ? "" : displayName(material, "");
  const base = meshName || materialName || `Part ${partId}`;
  return primitiveCount === 1 ? base : `${base} primitive ${primitiveIndex}`;
}

function primitiveGroupName(
  mesh: Mesh,
  material: Material | null,
  group: readonly PrimitiveData[],
  primitiveCount: number,
  partId: PartId,
): string {
  const first = group[0];
  if (first === undefined) return `Part ${partId}`;
  if (group.length === 1) {
    return primitiveName(mesh, material, first.primitiveIndex, primitiveCount, partId);
  }
  const meshName = displayName(mesh, "");
  const materialName = material === null ? "" : displayName(material, "");
  return `${meshName || materialName || `Part ${partId}`} (${group.length} primitives)`;
}

function mergeBounds(first: Bounds, second: Bounds): Bounds {
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    minZ: Math.min(first.minZ, second.minZ),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
    maxZ: Math.max(first.maxZ, second.maxZ),
  };
}

function flattenPlacedGroup(group: readonly GlbPlacedPartRecord[], partId: PartId): GlbPartRecord {
  const first = group[0];
  if (first === undefined) throw new Error("GLB placed-part group must not be empty");
  const geometries = group.flatMap(({ record }) => record.part.geometries);
  const positionLength = geometries.reduce(
    (total, geometry) => total + geometry.positions.length,
    0,
  );
  const indexLength = geometries.reduce((total, geometry) => total + geometry.indices.length, 0);
  const positions = new Float32Array(positionLength);
  const indices = new Uint32Array(indexLength);
  let positionOffset = 0;
  let indexOffset = 0;
  for (const { record, transform } of group) {
    for (const geometry of record.part.geometries) {
      appendTransformedPositions(positions, positionOffset, geometry.positions, transform);
      const vertexOffset = positionOffset / 3;
      for (const index of geometry.indices) indices[indexOffset++] = index + vertexOffset;
      positionOffset += geometry.positions.length;
    }
  }
  return {
    part: createPartRecord(partId, {
      geometries: [{ primitive: "triangles", positions, indices }],
    }),
    name: group.length === 1 ? first.record.name : `${group.length} GLB meshes`,
    style: first.record.style,
  };
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
    target[offset + index] = point[0];
    target[offset + index + 1] = point[1];
    target[offset + index + 2] = point[2];
  }
}

function styleKey(style: StyleOverride): string {
  const color = style.color;
  return color === undefined ? "default" : `${color.r},${color.g},${color.b},${color.a}`;
}

function materialStyle(material: Material | null, diagnostics: GlbDiagnostics): StyleOverride {
  if (material === null) return { color: DEFAULT_COLOR };
  if (material.getBaseColorTexture() !== null) {
    diagnostics.warning(
      "glb-ignored-texture",
      "Ignored base-color texture; GLB import maps only baseColorFactor.",
      "base-color-texture",
    );
  }
  if (
    material.getNormalTexture() !== null ||
    material.getOcclusionTexture() !== null ||
    material.getMetallicRoughnessTexture() !== null ||
    material.getEmissiveTexture() !== null
  ) {
    diagnostics.warning(
      "glb-ignored-material-feature",
      "Ignored material textures; femgx display styles do not upload PBR textures.",
      "material-textures",
    );
  }
  const factor = material.getBaseColorFactor();
  validateColorFactor(factor, diagnostics);
  const alphaMode = material.getAlphaMode();
  const alpha = alphaForMode(material, factor[3], alphaMode, diagnostics);
  return { color: { r: factor[0], g: factor[1], b: factor[2], a: alpha } };
}

function validateColorFactor(factor: vec4, diagnostics: GlbDiagnostics): void {
  if (factor.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    diagnostics.fatal(
      "glb-invalid-primitive",
      "Material baseColorFactor must contain values in [0, 1].",
    );
  }
}

function alphaForMode(
  material: Material,
  factorAlpha: number,
  alphaMode: string,
  diagnostics: GlbDiagnostics,
): number {
  if (alphaMode === "OPAQUE") return 1;
  if (alphaMode === "BLEND") return factorAlpha;
  diagnostics.warning(
    "glb-mask-alpha-approximation",
    `Approximated MASK alpha with a primitive-wide cutoff of ${material.getAlphaCutoff()}.`,
    "mask-alpha",
  );
  return factorAlpha >= material.getAlphaCutoff() ? 1 : 0;
}

function displayName(property: { getName(): string }, fallback: string): string {
  const name = property.getName().trim();
  return name.length === 0 ? fallback : name;
}
