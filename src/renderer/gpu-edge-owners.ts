import type { ElementTessellation, Geometry, GeometryElementBlock } from "../geometry/part";
import { buildFacePrimitivePickIds } from "./gpu-pick-ids";

type TriangleOwnerPair = readonly [number, number, number, number, number, number];

interface TriangleOwnership {
  readonly facePickIds: Uint32Array | undefined;
  readonly bodyByElement: ReadonlyMap<number, number | undefined>;
  readonly blockByElement: ReadonlyMap<number, number | undefined>;
  readonly bodyPickIds: Uint32Array;
  readonly elementPickIds: Uint32Array;
}

interface TriangleBodyPairInput {
  readonly geometry: Geometry;
  readonly sourceIndices: Uint32Array;
  readonly bodyPickIds: Uint32Array;
  readonly elementPickIds: Uint32Array;
  readonly elements: readonly ElementTessellation[];
  readonly blocks: readonly GeometryElementBlock[];
}

/** Derives body, element, and block owners for each source triangle. */
export function triangleBodyPairs({
  geometry,
  sourceIndices,
  bodyPickIds,
  elementPickIds,
  elements,
  blocks,
}: TriangleBodyPairInput): TriangleOwnerPair[] {
  const facePickIds =
    geometry.primitive === "triangles" ? buildFacePrimitivePickIds(geometry) : undefined;
  const bodyByElement = new Map(elements.map((element) => [element.id, element.bodyId] as const));
  const blockByElement = new Map(elements.map((element) => [element.id, element.blockId] as const));
  for (const block of blocks) {
    for (const elementId of block.elementIds) {
      if (blockByElement.get(elementId) === undefined) blockByElement.set(elementId, block.id);
    }
  }
  const pairFor = trianglePairResolver(geometry, {
    facePickIds,
    bodyByElement,
    blockByElement,
    bodyPickIds,
    elementPickIds,
  });
  if (sourceIndices === geometry.indices) {
    return Array.from({ length: Math.floor(sourceIndices.length / 3) }, (_, triangle) =>
      pairFor(triangle),
    );
  }
  return expandedTrianglePairs(geometry, sourceIndices, pairFor);
}

function trianglePairResolver(
  geometry: Geometry,
  ownership: TriangleOwnership,
): (triangle: number) => TriangleOwnerPair {
  return (triangle) => {
    const owner = ownership.bodyPickIds[triangle] ?? 0;
    const element = ownership.elementPickIds[triangle] ?? 0;
    const faceId = (ownership.facePickIds?.[triangle] ?? 0) - 1;
    const neighborElementId =
      geometry.primitive === "triangles"
        ? geometry.faces?.[faceId]?.neighborElementIds[0]
        : undefined;
    const neighborBody =
      neighborElementId === undefined ? undefined : ownership.bodyByElement.get(neighborElementId);
    const neighborPickId = neighborBody === undefined ? 0 : neighborBody + 1;
    const neighborElementPickId = neighborElementId === undefined ? 0 : neighborElementId + 1;
    const block = ownership.blockByElement.get(element - 1);
    const neighborBlock =
      neighborElementId === undefined ? undefined : ownership.blockByElement.get(neighborElementId);
    return [
      owner,
      neighborPickId === owner ? 0 : neighborPickId,
      element,
      neighborElementPickId,
      block === undefined ? 0 : block + 1,
      neighborBlock === undefined || neighborBlock === block ? 0 : neighborBlock + 1,
    ];
  };
}

function expandedTrianglePairs(
  geometry: Geometry,
  sourceIndices: Uint32Array,
  pairFor: (triangle: number) => TriangleOwnerPair,
): TriangleOwnerPair[] {
  const byTriangle = new Map<string, TriangleOwnerPair>();
  for (let triangle = 0; triangle < geometry.indices.length / 3; triangle++) {
    const base = triangle * 3;
    byTriangle.set(
      triangleKey(
        geometry.indices[base] ?? 0,
        geometry.indices[base + 1] ?? 0,
        geometry.indices[base + 2] ?? 0,
      ),
      pairFor(triangle),
    );
  }
  const result: TriangleOwnerPair[] = [];
  for (let triangle = 0; triangle < sourceIndices.length / 3; triangle++) {
    const base = triangle * 3;
    result.push(
      byTriangle.get(
        triangleKey(
          sourceIndices[base] ?? 0,
          sourceIndices[base + 1] ?? 0,
          sourceIndices[base + 2] ?? 0,
        ),
      ) ?? [0, 0, 0, 0, 0, 0],
    );
  }
  return result;
}

function triangleKey(a: number, b: number, c: number): string {
  return `${a},${b},${c}`;
}
