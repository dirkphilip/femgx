import { validatePartId } from "../id-validation";
import { createPartRecord, type Part, type PartId } from "../part";
import type { Geometry, GeometryBody } from "../types";
import {
  lazyPackedArray,
  packedEdge,
  packedElement,
  packedFace,
  packedFaceSubset,
  registerPackedSemanticGeometry,
  registerPackedSemanticStorage,
  type PackedSemanticStorage,
} from "./packed-semantic";
import { normalizePackedBodyMembership, validatePackedPartBoundary } from "./packed-validation";

/** Constructs one internal packed part after validating its authored columns. */
export function createPackedPart(
  id: PartId,
  input: {
    readonly geometries: readonly Geometry[];
    readonly semantic: PackedSemanticStorage;
    readonly nodePositions?: Float32Array;
    readonly bodies?: readonly GeometryBody[];
  },
): Part {
  validatePartId(id);
  if (input.geometries.length === 0)
    throw new Error("Part must contain at least one geometry group");
  const semantic = normalizePackedBodyMembership(input.semantic, input.bodies);
  const bodies = input.bodies ?? semantic.bodies;
  validatePackedPartBoundary({ ...input, semantic });
  const elements = lazyPackedArray(semantic.elementIds.length, (ordinal) =>
    packedElement(semantic, ordinal),
  );
  const geometries = input.geometries.map((source) => packedGeometry(source, semantic));
  const part = createPartRecord(id, {
    geometries,
    elements,
    ...(input.nodePositions === undefined ? {} : { nodePositions: input.nodePositions }),
    ...(bodies === undefined ? {} : { bodies }),
  });
  registerPackedSemanticStorage(part, semantic);
  return part;
}

function packedGeometry(source: Geometry, semantic: PackedSemanticStorage): Geometry {
  if (source.primitive !== semantic.primitive) return source;
  const faces = lazyPackedArray(semantic.faceOwnerElementOrdinals.length, (ordinal) =>
    packedFace(semantic, ordinal),
  );
  const edges =
    semantic.edgeNodeOffsets === undefined
      ? undefined
      : lazyPackedArray(semantic.edgeNodeOffsets.length - 1, (ordinal) =>
          packedEdge(semantic, ordinal),
        );
  const geometry: Geometry = {
    ...source,
    ...(faces.length === 0 ? {} : { faces }),
    ...(edges === undefined ? {} : { edges }),
    ...(semantic.faceSubsetOrdinals === undefined
      ? {}
      : { faceSubset: { faceIds: packedFaceSubset(semantic) } }),
  };
  registerPackedSemanticGeometry(geometry, semantic);
  return geometry;
}
