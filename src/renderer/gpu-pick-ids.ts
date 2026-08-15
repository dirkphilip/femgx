import {
  logicalPrimitiveCount,
  primitiveRangesForElement,
  type ElementTessellation,
  type Geometry,
  type Part,
} from "../geometry/part";

type NodeMetadataSource = Geometry | Part;

/**
 * Builders for the per-primitive and per-vertex pick-id buffers uploaded with a
 * part's geometry. All ids are 1-based (`0` = none), mirroring the encoding of
 * the pick fragment shader and `pick-format.ts`.
 */

/** Builds the per-primitive element pick id map (`elementId + 1`, 0 = none). */
export function buildElementPrimitivePickIds(
  geometry: Geometry,
  elements: readonly ElementTessellation[] = [],
): Uint32Array {
  const primitiveCount = logicalPrimitiveCount(geometry);
  const pickIds = new Uint32Array(primitiveCount);
  for (const element of elements) {
    for (const range of primitiveRangesForElement(element, geometry.primitive)) {
      for (
        let primitiveIndex = range.start;
        primitiveIndex < range.start + range.count;
        primitiveIndex++
      ) {
        pickIds[primitiveIndex] = element.id + 1;
      }
    }
  }
  return pickIds;
}

/** Builds the per-primitive private part-wide dense element ordinal map. */
export function buildElementPrimitiveOrdinals(
  geometry: Geometry,
  elements: readonly ElementTessellation[],
  elementOrdinalById: ReadonlyMap<number, number>,
): Uint32Array {
  const primitiveCount = logicalPrimitiveCount(geometry);
  const ordinals = new Uint32Array(primitiveCount);
  for (const element of elements) {
    const ordinal = elementOrdinalById.get(element.id);
    if (ordinal === undefined) continue;
    for (const range of primitiveRangesForElement(element, geometry.primitive)) {
      for (
        let primitiveIndex = range.start;
        primitiveIndex < range.start + range.count;
        primitiveIndex++
      ) {
        ordinals[primitiveIndex] = ordinal;
      }
    }
  }
  return ordinals;
}

/** Builds the per-primitive body pick id map (`bodyId + 1`, 0 = ungrouped). */
export function buildBodyPrimitivePickIds(
  geometry: Geometry,
  elements: readonly ElementTessellation[] = [],
): Uint32Array {
  const primitiveCount = logicalPrimitiveCount(geometry);
  const pickIds = new Uint32Array(primitiveCount);
  for (const element of elements) {
    const bodyId = element.bodyId;
    if (bodyId === undefined) continue;
    for (const range of primitiveRangesForElement(element, geometry.primitive)) {
      for (
        let primitiveIndex = range.start;
        primitiveIndex < range.start + range.count;
        primitiveIndex++
      ) {
        pickIds[primitiveIndex] = bodyId + 1;
      }
    }
  }
  return pickIds;
}

/** Builds the per-triangle face pick id map (`faceId + 1`, 0 = none). */
export function buildFacePrimitivePickIds(geometry: Geometry): Uint32Array {
  const primitiveCount = logicalPrimitiveCount(geometry);
  const pickIds = new Uint32Array(primitiveCount);
  if (geometry.primitive !== "triangles") return pickIds;
  for (let face = 0; face < (geometry.faces?.length ?? 0); face += 1) {
    const range = geometry.faces?.[face];
    if (range === undefined) continue;
    const end = range.primitiveStart + range.primitiveCount;
    for (let primitive = range.primitiveStart; primitive < end; primitive += 1) {
      pickIds[primitive] = face + 1;
    }
  }
  return pickIds;
}

/** Builds interleaved per-triangle face/owner/neighbor ids for one storage binding. */
export function buildPrimitiveFaceBodyPickData(
  geometry: Geometry,
  elements: readonly ElementTessellation[] = [],
  blocks: readonly { readonly id: number; readonly elementIds: readonly number[] }[] = [],
): Uint32Array {
  const facePickIds = buildFacePrimitivePickIds(geometry);
  const bodyPickIds = buildBodyPrimitivePickIds(geometry, elements);
  const elementPickIds = buildElementPrimitivePickIds(geometry, elements);
  const blockAware = blocks.length > 0;
  const bodyByElement = new Map(elements.map((element) => [element.id, element.bodyId] as const));
  const blockByElement = blockIdsByElement({ elements, blocks });
  const blockPickIds = buildBlockPrimitivePickIds(geometry, elements, blockByElement);
  const stride = blockAware ? 7 : 5;
  const data = new Uint32Array(facePickIds.length * stride);
  for (let triangle = 0; triangle < facePickIds.length; triangle += 1) {
    const facePickId = facePickIds[triangle] ?? 0;
    const face = geometry.primitive === "triangles" ? geometry.faces?.[facePickId - 1] : undefined;
    const base = triangle * stride;
    data[base] = facePickId;
    data[base + 1] = bodyPickIds[triangle] ?? 0;
    const neighborElementId = face?.neighborElementIds[0];
    const neighborBody =
      neighborElementId === undefined ? undefined : bodyByElement.get(neighborElementId);
    data[base + 2] =
      neighborBody === undefined || neighborBody + 1 === data[base + 1] ? 0 : neighborBody + 1;
    data[base + 3] = elementPickIds[triangle] ?? 0;
    data[base + 4] = neighborElementId === undefined ? 0 : neighborElementId + 1;
    if (blockAware) {
      const blockId = blockPickIds[triangle] ?? 0;
      const neighborBlockId =
        neighborElementId === undefined ? undefined : blockByElement.get(neighborElementId);
      data[base + 5] = blockId;
      data[base + 6] =
        neighborBlockId === undefined || neighborBlockId + 1 === blockId ? 0 : neighborBlockId + 1;
    }
  }
  return data;
}

/** Builds the per-primitive semantic block pick ids (`blockId + 1`). */
function buildBlockPrimitivePickIds(
  geometry: Geometry,
  elements: readonly ElementTessellation[],
  blockByElement: ReadonlyMap<number, number>,
): Uint32Array {
  const primitiveCount = logicalPrimitiveCount(geometry);
  const pickIds = new Uint32Array(primitiveCount);
  for (const element of elements) {
    const blockId = blockByElement.get(element.id);
    if (blockId === undefined) continue;
    for (const range of primitiveRangesForElement(element, geometry.primitive)) {
      for (
        let primitiveIndex = range.start;
        primitiveIndex < range.start + range.count;
        primitiveIndex++
      ) {
        pickIds[primitiveIndex] = blockId + 1;
      }
    }
  }
  return pickIds;
}

/** Builds one face/owner/neighbor record per authored node sprite. */
export function buildNodeBodyPickData(
  source: NodeMetadataSource,
  spritePickIds?: ArrayLike<number>,
): Uint32Array {
  const nodeCount = (sourceNodePositions(source)?.length ?? 0) / 3;
  const elementOwners = nodeElementOwners(source);
  const blockByElement = blockIdsByElement({
    elements: sourceElements(source),
    blocks: sourceBlocks(source),
  });
  // The shared binding is array<vec3<u32>>, whose minimum valid storage
  // is one complete 12-byte record even when this part has no nodes. Node
  // topology ownership remains an array of owner/neighbor pairs below.
  const sprites =
    spritePickIds ?? Uint32Array.from({ length: nodeCount }, (_, nodeId) => nodeId + 1);
  const blockAware = sourceBlocks(source).length > 0;
  const stride = blockAware ? 7 : 5;
  const data = new Uint32Array(Math.max(stride, sprites.length * stride));
  for (let sprite = 0; sprite < sprites.length; sprite += 1) {
    const pickId = sprites[sprite] ?? 0;
    const elements = elementOwners.get(pickId - 1);
    const bodyIds = new Set((elements ?? []).map((owner) => owner.bodyId));
    const blockIds = new Set(
      (elements ?? [])
        .map((owner) => blockByElement.get(owner.elementId))
        .filter((blockId): blockId is number => blockId !== undefined),
    );
    const base = sprite * stride;
    const bodyId = bodyIds.size === 1 ? [...bodyIds][0] : undefined;
    const elementId = elements?.length === 1 ? elements[0]?.elementId : undefined;
    if (bodyId !== undefined) data[base + 1] = bodyId + 1;
    if (elementId !== undefined) data[base + 3] = elementId + 1;
    const blockId = blockIds.size === 1 ? [...blockIds][0] : undefined;
    if (blockAware && blockId !== undefined) data[base + 5] = blockId + 1;
  }
  return data;
}

/** Builds variable-length body-owner ranges for each authored node sprite. */
export function buildNodeBodyOwnerData(
  source: NodeMetadataSource,
  spritePickIds: ArrayLike<number>,
): {
  readonly bodyRanges: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly elementIds: Uint32Array;
  readonly blockIds?: Uint32Array;
} {
  const elementOwners = nodeElementOwners(source);
  const blockByElement = blockIdsByElement({
    elements: sourceElements(source),
    blocks: sourceBlocks(source),
  });
  const bodyIds: number[] = [];
  const elementIds: number[] = [];
  const blockIds: number[] = [];
  const blockAware = sourceBlocks(source).length > 0;
  const bodyRanges = new Uint32Array(spritePickIds.length * 2);
  for (let sprite = 0; sprite < spritePickIds.length; sprite += 1) {
    const pickId = spritePickIds[sprite] ?? 0;
    const ownerIds = [...(elementOwners.get(pickId - 1) ?? [])].sort(
      (a, b) => (a.bodyId ?? -1) - (b.bodyId ?? -1) || a.elementId - b.elementId,
    );
    bodyRanges[sprite * 2] = bodyIds.length / 2;
    bodyRanges[sprite * 2 + 1] = ownerIds.length;
    for (const { bodyId, elementId } of ownerIds) {
      bodyIds.push(bodyId === undefined ? 0 : bodyId + 1, 0);
      elementIds.push(elementId + 1, 0);
      if (blockAware) {
        const blockId = blockByElement.get(elementId);
        blockIds.push(blockId === undefined ? 0 : blockId + 1, 0);
      }
    }
  }
  return {
    bodyRanges: bodyRanges.length === 0 ? new Uint32Array([0, 0]) : bodyRanges,
    bodyIds: bodyIds.length === 0 ? new Uint32Array([0, 0]) : new Uint32Array(bodyIds),
    elementIds: elementIds.length === 0 ? new Uint32Array([0, 0]) : new Uint32Array(elementIds),
    ...(blockAware
      ? { blockIds: blockIds.length === 0 ? new Uint32Array([0, 0]) : new Uint32Array(blockIds) }
      : {}),
  };
}

interface NodeElementOwner {
  readonly bodyId: number | undefined;
  readonly elementId: number;
}

function blockIdsByElement(source: {
  readonly elements?: readonly ElementTessellation[];
  readonly blocks?: readonly { readonly id: number; readonly elementIds: readonly number[] }[];
}): ReadonlyMap<number, number> {
  const blockIds = new Map<number, number>();
  for (const element of source.elements ?? []) {
    if (element.blockId !== undefined) blockIds.set(element.id, element.blockId);
  }
  for (const block of source.blocks ?? []) {
    for (const elementId of block.elementIds) {
      if (!blockIds.has(elementId)) blockIds.set(elementId, block.id);
    }
  }
  return blockIds;
}

function nodeElementOwners(source: NodeMetadataSource): Map<number, NodeElementOwner[]> {
  const owners = new Map<number, Map<string, NodeElementOwner>>();
  for (const geometry of sourceGeometries(source)) {
    for (const element of sourceElements(source)) {
      const bodyId = element.bodyId;
      const verticesPerPrimitive =
        geometry.primitive === "lines" ? 2 : geometry.primitive === "points" ? 1 : 3;
      for (const range of primitiveRangesForElement(element, geometry.primitive)) {
        appendNodeElementRangeOwners({
          owners,
          geometry,
          element,
          bodyId,
          range,
          verticesPerPrimitive,
        });
      }
    }
  }
  return new Map([...owners].map(([nodeId, values]) => [nodeId, [...values.values()]]));
}

function appendNodeElementRangeOwners(input: {
  readonly owners: Map<number, Map<string, NodeElementOwner>>;
  readonly geometry: Geometry;
  readonly element: ElementTessellation;
  readonly bodyId: number | undefined;
  readonly range: { readonly start: number; readonly count: number };
  readonly verticesPerPrimitive: number;
}): void {
  const { owners, geometry, element, bodyId, range, verticesPerPrimitive } = input;
  const start = range.start * verticesPerPrimitive;
  const end = (range.start + range.count) * verticesPerPrimitive;
  for (let vertex = start; vertex < end; vertex += 1) {
    const vertexIndex = geometry.indices[vertex];
    if (vertexIndex === undefined) continue;
    const pickId = geometry.nodePickIds?.[vertexIndex] ?? 0;
    if (pickId === 0) continue;
    const byElement = owners.get(pickId - 1) ?? new Map<string, NodeElementOwner>();
    byElement.set(`${bodyId ?? "unowned"}/${element.id}`, { bodyId, elementId: element.id });
    owners.set(pickId - 1, byElement);
  }
}

/** Builds deterministic, ascending 1-based ids for the node sprites a part uses. */
export function buildNodeSpritePickIds(source: NodeMetadataSource): Uint32Array {
  const nodeCount = (sourceNodePositions(source)?.length ?? 0) / 3;
  const ids = new Set<number>();
  for (const geometry of sourceGeometries(source)) {
    if (geometry.primitive === "points") continue;
    for (const pickId of geometry.nodePickIds ?? []) {
      if (pickId > 0 && pickId <= nodeCount) ids.add(pickId);
    }
  }
  return Uint32Array.from([...ids].sort((a, b) => a - b));
}

function sourceGeometries(source: NodeMetadataSource): readonly Geometry[] {
  return "geometries" in source ? source.geometries : [source];
}

function sourceNodePositions(source: NodeMetadataSource): Float32Array | undefined {
  return "geometries" in source ? source.nodePositions : undefined;
}

function sourceElements(source: NodeMetadataSource): readonly ElementTessellation[] {
  return "geometries" in source ? (source.elements ?? []) : [];
}

function sourceBlocks(
  source: NodeMetadataSource,
): readonly { readonly id: number; readonly elementIds: readonly number[] }[] {
  return "geometries" in source ? (source.blocks ?? []) : [];
}
