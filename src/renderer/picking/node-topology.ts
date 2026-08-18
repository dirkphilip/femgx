import type { ElementTessellation, Geometry, Part } from "../../geometry/part";
import { nodeOwnersAreCanonical, sortNodeOwners } from "./node-topology-order";

interface NodeTopologyData {
  readonly faceBodyPickIds: Uint32Array;
  readonly bodyRanges: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly elementIds: Uint32Array;
}

/** Builds the node topology directly in its immutable GPU binding layout. */
export function buildPackedNodeTopologyData(
  part: Part,
  spritePickIds?: ArrayLike<number>,
): Uint32Array {
  const build = prepareNodeTopology(part, spritePickIds);
  const ownerCount = countNodeOwners(build);
  const faceCount = Math.max(1, build.sprites.length);
  const rangeCount = Math.max(1, build.sprites.length);
  const faceLength = faceCount * 5;
  const rangeLength = rangeCount * 2;
  const ownerLength = ownerCount * 2;
  const metadataLength = build.sprites.length;
  const data = new Uint32Array(4 + faceLength + rangeLength + ownerLength * 2 + metadataLength + 1);
  data[0] = faceCount;
  data[1] = rangeCount;
  data[2] = ownerCount;
  data[3] = metadataLength;
  const bodyRangeOffset = 4 + faceLength;
  const bodyIdOffset = bodyRangeOffset + rangeLength;
  const elementIdOffset = bodyIdOffset + ownerLength;
  const output = {
    faceBodyPickIds: data.subarray(4, bodyRangeOffset),
    bodyRanges: data.subarray(bodyRangeOffset, bodyIdOffset),
    bodyIds: data.subarray(bodyIdOffset, elementIdOffset),
    elementIds: data.subarray(elementIdOffset, elementIdOffset + ownerLength),
  };
  writeNodeBodyRanges(output.bodyRanges, build);
  fillNodeTopology(build, output);
  return data;
}

interface NodeTopologyBuild extends NodeOwnerPass {
  readonly sprites: ArrayLike<number>;
  readonly nodeCount: number;
  readonly canonicalOwners: boolean;
}

function prepareNodeTopology(
  part: Part,
  spritePickIds: ArrayLike<number> | undefined,
): NodeTopologyBuild {
  const nodeCount = Math.floor((part.nodePositions?.length ?? 0) / 3);
  const sprites = spritePickIds ?? sequentialNodePickIds(nodeCount);
  const elements = part.elements ?? [];
  const build = {
    geometries: part.geometries,
    elements,
    stamps: new Uint32Array(nodeCount),
    counts: new Uint32Array(nodeCount),
    ...mapNodeSprites(sprites, nodeCount),
    sprites,
    nodeCount,
    canonicalOwners: nodeOwnersAreCanonical(elements),
  };
  accumulateNodeOwners(build);
  return build;
}

function countNodeOwners(build: NodeTopologyBuild): number {
  let ownerCount = 0;
  for (let sprite = 0; sprite < build.sprites.length; sprite += 1) {
    const nodeId = (build.sprites[sprite] ?? 0) - 1;
    if (nodeId >= 0 && nodeId < build.nodeCount) ownerCount += build.counts[nodeId] ?? 0;
  }
  return ownerCount;
}

function writeNodeBodyRanges(ranges: Uint32Array, build: NodeTopologyBuild): void {
  let ownerCount = 0;
  for (let sprite = 0; sprite < build.sprites.length; sprite += 1) {
    const nodeId = (build.sprites[sprite] ?? 0) - 1;
    const count = nodeId >= 0 && nodeId < build.nodeCount ? (build.counts[nodeId] ?? 0) : 0;
    ranges[sprite * 2] = ownerCount;
    ranges[sprite * 2 + 1] = count;
    ownerCount += count;
  }
}

function fillNodeTopology(build: NodeTopologyBuild, output: NodeTopologyData): void {
  build.stamps.fill(0);
  accumulateNodeOwners({
    ...build,
    cursors: buildNodeOwnerCursors(output.bodyRanges, build.sprites.length),
    output,
  });
  if (!build.canonicalOwners) sortNodeOwners(output);
  writeNodeFaceOwners(output);
}

function buildNodeOwnerCursors(ranges: Uint32Array, spriteCount: number): Uint32Array {
  const cursors = new Uint32Array(spriteCount);
  for (let sprite = 0; sprite < spriteCount; sprite += 1) {
    cursors[sprite] = ranges[sprite * 2] ?? 0;
  }
  return cursors;
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
