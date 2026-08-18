import type { ElementTessellation, Geometry, Part } from "../../geometry/part";

/** Dense node topology packed for the shared face and ownership binding. */
export interface NodeTopologyData {
  readonly faceBodyPickIds: Uint32Array;
  readonly bodyRanges: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly elementIds: Uint32Array;
}

/** Builds node face records and variable-length owners with dense count/fill passes. */
export function buildNodeTopologyData(
  part: Part,
  spritePickIds?: ArrayLike<number>,
): NodeTopologyData {
  const nodeCount = Math.floor((part.nodePositions?.length ?? 0) / 3);
  const sprites = spritePickIds ?? sequentialNodePickIds(nodeCount);
  const elements = part.elements ?? [];
  const canonicalOwners = elementsAreCanonical(elements);
  const stamps = new Uint32Array(nodeCount);
  const counts = new Uint32Array(nodeCount);
  const spriteMap = mapNodeSprites(sprites, nodeCount);
  const pass = {
    geometries: part.geometries,
    elements,
    stamps,
    counts,
    ...spriteMap,
  };
  accumulateNodeOwners(pass);
  const bodyRanges = buildNodeBodyRanges(sprites, counts, nodeCount);
  const ownerCount = totalNodeOwners(bodyRanges, sprites.length);
  const faceBodyPickIds = new Uint32Array(Math.max(5, sprites.length * 5));
  const bodyIds = new Uint32Array(ownerCount * 2);
  const elementIds = new Uint32Array(ownerCount * 2);
  const output = { faceBodyPickIds, bodyRanges, bodyIds, elementIds };
  stamps.fill(0);
  accumulateNodeOwners({
    ...pass,
    cursors: buildNodeOwnerCursors(bodyRanges, sprites.length),
    output,
  });
  if (!canonicalOwners) sortNodeOwners(output);
  writeNodeFaceOwners(output);
  return withNodeTopologySentinels(output);
}

function buildNodeBodyRanges(
  sprites: ArrayLike<number>,
  counts: Uint32Array,
  nodeCount: number,
): Uint32Array {
  const ranges = new Uint32Array(sprites.length * 2);
  let ownerCount = 0;
  for (let sprite = 0; sprite < sprites.length; sprite += 1) {
    const nodeId = (sprites[sprite] ?? 0) - 1;
    const count = nodeId >= 0 && nodeId < nodeCount ? (counts[nodeId] ?? 0) : 0;
    ranges[sprite * 2] = ownerCount;
    ranges[sprite * 2 + 1] = count;
    ownerCount += count;
  }
  return ranges;
}

function totalNodeOwners(ranges: Uint32Array, spriteCount: number): number {
  if (spriteCount === 0) return 0;
  const last = (spriteCount - 1) * 2;
  return (ranges[last] ?? 0) + (ranges[last + 1] ?? 0);
}

function buildNodeOwnerCursors(ranges: Uint32Array, spriteCount: number): Uint32Array {
  const cursors = new Uint32Array(spriteCount);
  for (let sprite = 0; sprite < spriteCount; sprite += 1) {
    cursors[sprite] = ranges[sprite * 2] ?? 0;
  }
  return cursors;
}

function withNodeTopologySentinels(output: NodeTopologyData): NodeTopologyData {
  return {
    faceBodyPickIds: output.faceBodyPickIds,
    bodyRanges: output.bodyRanges.length === 0 ? new Uint32Array([0, 0]) : output.bodyRanges,
    bodyIds: output.bodyIds.length === 0 ? new Uint32Array([0, 0]) : output.bodyIds,
    elementIds: output.elementIds.length === 0 ? new Uint32Array([0, 0]) : output.elementIds,
  };
}

interface NodeOwnerPass {
  readonly geometries: readonly Geometry[];
  readonly elements: readonly ElementTessellation[];
  readonly stamps: Uint32Array;
  readonly counts: Uint32Array;
  readonly spriteByNode: Int32Array;
  readonly nextSprite: Int32Array;
  readonly cursors?: Uint32Array;
  readonly output?: NodeTopologyData;
}

function accumulateNodeOwners(input: NodeOwnerPass): void {
  const { elements } = input;
  for (let ordinal = 0; ordinal < elements.length; ordinal += 1) {
    const element = elements[ordinal];
    if (element === undefined) continue;
    accumulateElementNodeOwners(input, element, ordinal + 1);
  }
}

function accumulateElementNodeOwners(
  input: NodeOwnerPass,
  element: ElementTessellation,
  token: number,
): void {
  const { geometries, stamps, counts, spriteByNode } = input;
  for (const geometry of geometries) {
    const verticesPerPrimitive =
      geometry.primitive === "triangles" ? 3 : geometry.primitive === "lines" ? 2 : 1;
    for (const range of element.primitiveRanges) {
      if (range.primitive !== geometry.primitive) continue;
      const start = range.primitiveStart * verticesPerPrimitive;
      const end = (range.primitiveStart + range.primitiveCount) * verticesPerPrimitive;
      for (let vertex = start; vertex < end; vertex += 1) {
        const vertexIndex = geometry.indices[vertex];
        const pickId = vertexIndex === undefined ? 0 : (geometry.nodePickIds?.[vertexIndex] ?? 0);
        const nodeId = pickId - 1;
        if (
          nodeId < 0 ||
          nodeId >= stamps.length ||
          (spriteByNode[nodeId] ?? -1) < 0 ||
          stamps[nodeId] === token
        ) {
          continue;
        }
        stamps[nodeId] = token;
        const { cursors, output } = input;
        if (output === undefined || cursors === undefined) {
          counts[nodeId] = (counts[nodeId] ?? 0) + 1;
          continue;
        }
        writeNodeOwner(input, cursors, output, nodeId, element);
      }
    }
  }
}

function writeNodeOwner(
  input: NodeOwnerPass,
  cursors: Uint32Array,
  output: NodeTopologyData,
  nodeId: number,
  element: ElementTessellation,
): void {
  const bodyPickId = element.bodyId === undefined ? 0 : element.bodyId + 1;
  for (
    let sprite = input.spriteByNode[nodeId] ?? -1;
    sprite >= 0;
    sprite = input.nextSprite[sprite] ?? -1
  ) {
    const owner = cursors[sprite] ?? 0;
    cursors[sprite] = owner + 1;
    output.bodyIds[owner * 2] = bodyPickId;
    output.elementIds[owner * 2] = element.id + 1;
  }
}

function mapNodeSprites(
  sprites: ArrayLike<number>,
  nodeCount: number,
): { readonly spriteByNode: Int32Array; readonly nextSprite: Int32Array } {
  const spriteByNode = new Int32Array(nodeCount).fill(-1);
  const nextSprite = new Int32Array(sprites.length).fill(-1);
  for (let sprite = 0; sprite < sprites.length; sprite += 1) {
    const nodeId = (sprites[sprite] ?? 0) - 1;
    if (nodeId < 0 || nodeId >= nodeCount) continue;
    nextSprite[sprite] = spriteByNode[nodeId] ?? -1;
    spriteByNode[nodeId] = sprite;
  }
  return { spriteByNode, nextSprite };
}

function elementsAreCanonical(elements: readonly ElementTessellation[]): boolean {
  for (let ordinal = 1; ordinal < elements.length; ordinal += 1) {
    const previous = elements[ordinal - 1];
    const current = elements[ordinal];
    if (previous === undefined || current === undefined) continue;
    if ((previous.bodyId ?? -1) > (current.bodyId ?? -1)) return false;
    if ((previous.bodyId ?? -1) === (current.bodyId ?? -1) && previous.id > current.id)
      return false;
  }
  return true;
}

function sortNodeOwners(output: NodeTopologyData): void {
  const spriteCount = output.bodyRanges.length / 2;
  for (let sprite = 0; sprite < spriteCount; sprite += 1) {
    const start = output.bodyRanges[sprite * 2] ?? 0;
    const count = output.bodyRanges[sprite * 2 + 1] ?? 0;
    if (count > 1) heapSortNodeOwners(output, start, count);
  }
}

function heapSortNodeOwners(output: NodeTopologyData, start: number, count: number): void {
  for (let root = Math.floor(count / 2) - 1; root >= 0; root -= 1) {
    siftNodeOwnerDown(output, start, root, count);
  }
  for (let end = count - 1; end > 0; end -= 1) {
    swapNodeOwners(output, start, start + end);
    siftNodeOwnerDown(output, start, 0, end);
  }
}

function siftNodeOwnerDown(
  output: NodeTopologyData,
  start: number,
  root: number,
  count: number,
): void {
  let current = root;
  while (current * 2 + 1 < count) {
    const left = current * 2 + 1;
    const right = left + 1;
    const largest =
      right < count && compareNodeOwners(output, start + left, start + right) < 0 ? right : left;
    if (compareNodeOwners(output, start + current, start + largest) >= 0) return;
    swapNodeOwners(output, start + current, start + largest);
    current = largest;
  }
}

function compareNodeOwners(output: NodeTopologyData, first: number, second: number): number {
  return (
    (output.bodyIds[first * 2] ?? 0) - (output.bodyIds[second * 2] ?? 0) ||
    (output.elementIds[first * 2] ?? 0) - (output.elementIds[second * 2] ?? 0)
  );
}

function swapNodeOwners(output: NodeTopologyData, first: number, second: number): void {
  swapOwnerPair(output.bodyIds, first, second);
  swapOwnerPair(output.elementIds, first, second);
}

function swapOwnerPair(values: Uint32Array, first: number, second: number): void {
  const firstOffset = first * 2;
  const secondOffset = second * 2;
  const owner = values[firstOffset] ?? 0;
  const neighbor = values[firstOffset + 1] ?? 0;
  values[firstOffset] = values[secondOffset] ?? 0;
  values[firstOffset + 1] = values[secondOffset + 1] ?? 0;
  values[secondOffset] = owner;
  values[secondOffset + 1] = neighbor;
}

function writeNodeFaceOwners(output: NodeTopologyData): void {
  const spriteCount = output.bodyRanges.length / 2;
  for (let sprite = 0; sprite < spriteCount; sprite += 1) {
    const start = output.bodyRanges[sprite * 2] ?? 0;
    const count = output.bodyRanges[sprite * 2 + 1] ?? 0;
    if (count === 0) continue;
    const bodyPickId = output.bodyIds[start * 2] ?? 0;
    const end = start + count;
    let oneBody = true;
    for (let owner = start + 1; owner < end; owner += 1) {
      if (output.bodyIds[owner * 2] !== bodyPickId) oneBody = false;
    }
    const base = sprite * 5;
    if (oneBody) output.faceBodyPickIds[base + 1] = bodyPickId;
    if (count === 1) output.faceBodyPickIds[base + 3] = output.elementIds[start * 2] ?? 0;
  }
}

function sequentialNodePickIds(nodeCount: number): Uint32Array {
  const ids = new Uint32Array(nodeCount);
  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) ids[nodeId] = nodeId + 1;
  return ids;
}

/** Builds deterministic, ascending 1-based ids for the node sprites a part uses. */
export function buildNodeSpritePickIds(part: Part): Uint32Array {
  const nodeCount = (part.nodePositions?.length ?? 0) / 3;
  const used = new Uint8Array(nodeCount);
  let usedCount = 0;
  for (const geometry of part.geometries) {
    if (geometry.primitive === "points") continue;
    for (const pickId of geometry.nodePickIds ?? []) {
      if (pickId <= 0 || pickId > nodeCount || used[pickId - 1] !== 0) continue;
      used[pickId - 1] = 1;
      usedCount += 1;
    }
  }
  const ids = new Uint32Array(usedCount);
  let target = 0;
  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    if (used[nodeId] === 0) continue;
    ids[target] = nodeId + 1;
    target += 1;
  }
  return ids;
}
