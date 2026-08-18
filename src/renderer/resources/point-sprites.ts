import type { Geometry } from "../../geometry/part";

export interface PointVertexData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
  readonly primitiveIds: Uint32Array;
}

interface PointSpriteBuffers {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/** Expands authored node centers into renderer-owned point-sprite buffers. */
export function buildNodeSpriteBuffers(
  nodes: Float32Array,
  spritePickIds: Uint32Array,
): { readonly positions: Float32Array; readonly ids: Uint32Array; readonly indices: Uint32Array } {
  const positions = new Float32Array(spritePickIds.length * 12);
  const ids = new Uint32Array(spritePickIds.length * 4);
  const indices = new Uint32Array(spritePickIds.length * 6);
  const buffers = { positions, indices };
  for (let sprite = 0; sprite < spritePickIds.length; sprite += 1) {
    const pickId = spritePickIds[sprite] ?? 0;
    const source = (pickId - 1) * 3;
    writePointSprite(
      buffers,
      sprite,
      nodes[source] ?? 0,
      nodes[source + 1] ?? 0,
      nodes[source + 2] ?? 0,
    );
    writeFour(ids, sprite * 4, pickId);
  }
  return { positions, ids, indices };
}

/** Expands logical point centers into camera-facing sprite vertices. */
export function expandPointGeometry(
  geometry: Extract<Geometry, { primitive: "points" }>,
): PointVertexData {
  const pointCount = geometry.indices.length;
  const positions = new Float32Array(pointCount * 12);
  const indices = new Uint32Array(pointCount * 6);
  const nodePickIds = new Uint32Array(pointCount * 4);
  const primitiveIds = new Uint32Array(pointCount * 4);
  const buffers = { positions, indices };
  for (let point = 0; point < pointCount; point += 1) {
    const sourceIndex = geometry.indices[point] ?? 0;
    const source = sourceIndex * 3;
    writePointSprite(
      buffers,
      point,
      geometry.positions[source] ?? 0,
      geometry.positions[source + 1] ?? 0,
      geometry.positions[source + 2] ?? 0,
    );
    const vertex = point * 4;
    writeFour(nodePickIds, vertex, geometry.nodePickIds?.[sourceIndex] ?? 0);
    writeFour(primitiveIds, vertex, point);
  }
  return { positions, indices, nodePickIds, primitiveIds };
}

function writePointSprite(
  buffers: PointSpriteBuffers,
  sprite: number,
  x: number,
  y: number,
  z: number,
): void {
  const { positions, indices } = buffers;
  const position = sprite * 12;
  positions[position] = x;
  positions[position + 1] = y;
  positions[position + 2] = z;
  positions[position + 3] = x;
  positions[position + 4] = y;
  positions[position + 5] = z;
  positions[position + 6] = x;
  positions[position + 7] = y;
  positions[position + 8] = z;
  positions[position + 9] = x;
  positions[position + 10] = y;
  positions[position + 11] = z;

  const vertex = sprite * 4;
  const index = sprite * 6;
  indices[index] = vertex;
  indices[index + 1] = vertex + 1;
  indices[index + 2] = vertex + 2;
  indices[index + 3] = vertex;
  indices[index + 4] = vertex + 2;
  indices[index + 5] = vertex + 3;
}

function writeFour(target: Uint32Array, offset: number, value: number): void {
  target[offset] = value;
  target[offset + 1] = value;
  target[offset + 2] = value;
  target[offset + 3] = value;
}
