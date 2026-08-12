import { Accessor, Primitive } from "@gltf-transform/core";
import type { Material, Mesh, vec4 } from "@gltf-transform/core";
import { createPart, type Part, type PartId } from "../geometry/part";
import type { StyleOverride } from "../interaction/state";
import type { GlbDiagnostics } from "./glb-diagnostics";

const DEFAULT_COLOR = { r: 0.23, g: 0.51, b: 0.96, a: 1 } as const;

/** One reusable femgx part produced from one glTF mesh primitive. */
export interface GlbPartRecord {
  readonly part: Part;
  readonly name: string;
  readonly style: StyleOverride;
}

/** Imports the supported primitives of one reusable glTF mesh. */
export function importMeshParts(
  mesh: Mesh,
  firstPartId: PartId,
  diagnostics: GlbDiagnostics,
): readonly GlbPartRecord[] {
  const primitives = mesh.listPrimitives();
  const records: GlbPartRecord[] = [];
  for (let index = 0; index < primitives.length; index += 1) {
    const primitive = primitives[index];
    if (primitive === undefined) continue;
    const record = importPrimitive({
      mesh,
      primitive,
      primitiveIndex: index,
      primitiveCount: primitives.length,
      partId: firstPartId + records.length,
      diagnostics,
    });
    if (record !== undefined) records.push(record);
  }
  return records;
}

interface PrimitiveImport {
  readonly mesh: Mesh;
  readonly primitive: Primitive;
  readonly primitiveIndex: number;
  readonly primitiveCount: number;
  readonly partId: PartId;
  readonly diagnostics: GlbDiagnostics;
}

function importPrimitive(input: PrimitiveImport): GlbPartRecord | undefined {
  const { mesh, primitive, primitiveIndex, primitiveCount, partId, diagnostics } = input;
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
  validatePositionAccessor(position, primitiveIndex, diagnostics);
  const positions = readPositions(position, primitiveIndex, diagnostics);
  const indices = readIndices(primitive, positions.length / 3, primitiveIndex, diagnostics);
  const material = primitive.getMaterial();
  const part = createPart(partId, {
    primitive: "triangles",
    positions,
    indices,
  });
  return {
    part,
    name: primitiveName(mesh, material, primitiveIndex, primitiveCount, partId),
    style: materialStyle(material, diagnostics),
  };
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

function readPositions(
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

function readIndices(
  primitive: Primitive,
  vertexCount: number,
  primitiveIndex: number,
  diagnostics: GlbDiagnostics,
): Uint32Array {
  const accessor = primitive.getIndices();
  if (accessor === null) {
    if (vertexCount % 3 !== 0) {
      diagnostics.fatal(
        "glb-invalid-index",
        `Primitive ${primitiveIndex} has ${vertexCount} non-indexed vertices, not a multiple of three.`,
      );
    }
    return sequentialIndices(vertexCount);
  }
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
  const indices = new Uint32Array(accessor.getCount());
  for (let index = 0; index < indices.length; index += 1) {
    const value = accessor.getScalar(index);
    if (!Number.isInteger(value) || value < 0 || value >= vertexCount) {
      diagnostics.fatal(
        "glb-invalid-index",
        `Primitive ${primitiveIndex} index ${String(value)} is outside its POSITION accessor.`,
      );
    }
    indices[index] = value;
  }
  return indices;
}

function isUnsignedIndexType(componentType: number): boolean {
  return (
    componentType === Accessor.ComponentType["UNSIGNED_BYTE"] ||
    componentType === Accessor.ComponentType["UNSIGNED_SHORT"] ||
    componentType === Accessor.ComponentType["UNSIGNED_INT"]
  );
}

function sequentialIndices(count: number): Uint32Array {
  const indices = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) indices[index] = index;
  return indices;
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
