import type { Part, PartId } from "../geometry/part";
import type { Geometry, Primitive } from "../geometry/part";
import {
  destroyDeformationBuffer,
  destroyDeformationBuffers,
  type DeformationStorage,
} from "./gpu-deform";
import { packTopologyData } from "./gpu-geometry-buffers";
import type { InstanceStorage } from "./gpu-instance-storage";
import {
  buildNodeBodyPickData,
  buildNodeBodyOwnerData,
  buildNodeSpritePickIds,
} from "./gpu-pick-ids";
import type { DrawPipelines } from "./gpu-pipelines";
import { expandSurfaceGeometry, type SurfaceVertexData } from "./gpu-surface-geometry";
import { createBuffer, type PartResource } from "./gpu-support";
import { appendResultColorTail, createResultColorTail } from "./gpu-result-colors";
import {
  buildPartEdgePickResources,
  buildPartEdgeResources,
  buildPartGeometryData,
} from "./gpu-geometry-upload";
import { createColorTargets, destroyColorTargets, type ColorTargets } from "./gpu-targets";
import { GpuCostAccumulator } from "./gpu-cost";
import {
  createOrientationGlyphDrawResources,
  destroyOrientationGlyphPart,
  destroyOrientationGlyphDrawResources,
  type OrientationGlyphDrawResources,
} from "./gpu-orientation-glyph";

const POINT_SPRITE_INDICES = [0, 1, 2, 0, 2, 3] as const;

export {
  INSTANCE_STRIDE,
  INSTANCE_SELECTED_FLAG,
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_EDGE_EMPHASIS_FLAG,
  EMISSIVE_BYTE_OFFSET,
  LINE_WIDTH_BYTE_OFFSET,
  encodeInstanceRecord,
  patchInstances,
  writeDrawOrder,
  writeTransparentOrder,
  writeSelectionOrder,
  writeNodeSelectionOrder,
  writeEdgeOrder,
  writeNodeOrder,
  type InstanceStorage,
  type InstanceUpdate,
} from "./gpu-instance-storage";

/** A single instanced draw for one part. */
export interface DrawCall {
  readonly partId: PartId;
  readonly instanceCount: number;
}

/** Per-part geometry and instance storage buffers owned by the draw path. */
export interface DrawResources {
  readonly device: GPUDevice;
  readonly cost: GpuCostAccumulator;
  readonly parts: Map<PartId, PartResource>;
  /** Per-primitive resources for parts that contain more than one topology. */
  readonly primitiveParts: Map<PartId, Map<Primitive, PartResource>>;
  readonly nodeParts: Map<PartId, PartResource>;
  readonly storages: Map<PartId, InstanceStorage>;
  readonly deformations: Map<PartId, DeformationStorage>;
  readonly orientationGlyphs: OrientationGlyphDrawResources;
  /** The complete visible-frame target state and its composite cache. */
  readonly targets: ColorTargets;
}

/** Per-frame inputs shared by every draw batch of a pass. */
export interface DrawCallContext {
  readonly frameBindGroup: GPUBindGroup;
  readonly instanceLayout: GPUBindGroupLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly pipelines: DrawPipelines;
  readonly resultColors: ReadonlyMap<PartId, Float32Array> | undefined;
}

/** Creates the draw-path resource owner. */
export function createDrawResources(
  device: GPUDevice,
  cost = new GpuCostAccumulator(),
): DrawResources {
  return {
    device,
    cost,
    parts: new Map(),
    primitiveParts: new Map(),
    nodeParts: new Map(),
    storages: new Map(),
    deformations: new Map(),
    orientationGlyphs: createOrientationGlyphDrawResources(device, cost),
    targets: createColorTargets(),
  };
}

/** Uploads the transient node-sprite geometry and its body-owner metadata. */
export function uploadNodePart(
  draw: DrawResources,
  part: Part,
  resultColors?: Float32Array,
): PartResource {
  const existing = draw.nodeParts.get(part.id);
  if (existing !== undefined) return existing;
  const nodes = part.nodePositions ?? part.geometry.nodePositions ?? new Float32Array(0);
  const spritePickIds = buildNodeSpritePickIds(part);
  const nodeBodyData = buildNodeBodyOwnerData(part, spritePickIds);
  const { positions, ids, indices } = buildNodeSpriteBuffers(nodes, spritePickIds);
  const resultTail = createResultColorTail(ids, resultColors);
  const vertexWithResults = appendResultColorTail(positions, resultTail);
  const vertexBuffer = createBuffer(
    draw.device,
    vertexWithResults.data,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer: createBuffer(draw.device, indices, GPUBufferUsage.INDEX),
    resultColorBuffers: [{ buffer: vertexBuffer, offset: vertexWithResults.offset }],
    resultColorNodeCount: resultTail.resultColorNodeCount,
    resultColorsSource: resultColors,
    resultColorsActive: resultColors !== undefined,
    elementOrdinalsBuffer: createBuffer(
      draw.device,
      new Uint32Array(spritePickIds.length),
      GPUBufferUsage.STORAGE,
    ),
    facePickIdsBuffer: createBuffer(
      draw.device,
      packTopologyData(
        buildNodeBodyPickData(part, spritePickIds),
        nodeBodyData.bodyRanges,
        nodeBodyData.bodyIds,
        nodeBodyData.elementIds,
        { primitiveIds: [], edgeIds: [], blockIds: nodeBodyData.blockIds },
      ),
      GPUBufferUsage.STORAGE,
    ),
    nodePickIdsBuffer: createBuffer(draw.device, ids, GPUBufferUsage.STORAGE),
    edge: undefined,
    edgePick: undefined,
    indexCount: indices.length,
    subsetIndexCount: 0,
  };
  draw.nodeParts.set(part.id, resource);
  return resource;
}

function buildNodeSpriteBuffers(
  nodes: Float32Array,
  spritePickIds: Uint32Array,
): { readonly positions: Float32Array; readonly ids: Uint32Array; readonly indices: Uint32Array } {
  const positions = new Float32Array(spritePickIds.length * 12);
  const ids = new Uint32Array(spritePickIds.length * 4);
  const indices = new Uint32Array(spritePickIds.length * 6);
  for (let sprite = 0; sprite < spritePickIds.length; sprite += 1) {
    const pickId = spritePickIds[sprite] ?? 0;
    const source = (pickId - 1) * 3;
    for (let corner = 0; corner < 4; corner += 1) {
      positions.set(nodes.subarray(source, source + 3), (sprite * 4 + corner) * 3);
      ids[sprite * 4 + corner] = pickId;
    }
    writePointSpriteIndices(indices, sprite);
  }
  return { positions, ids, indices };
}

/**
 * Returns the cached mandatory geometry buffers for a part, uploading them once.
 */
export function uploadPart(
  draw: DrawResources,
  part: Part,
  resultColors?: Float32Array,
): PartResource {
  return uploadGeometryPart(draw, part, part.geometry, resultColors);
}

/** Uploads and caches one homogeneous primitive leaf of a semantic part. */
export function uploadGeometryPart(
  draw: DrawResources,
  part: Part,
  geometry: Geometry,
  resultColors?: Float32Array,
): PartResource {
  const resources = draw.primitiveParts.get(part.id) ?? new Map<Primitive, PartResource>();
  const existing = resources.get(geometry.primitive);
  if (existing !== undefined) return existing;
  const vertexData: SurfaceVertexData | PointVertexData =
    geometry.primitive === "points"
      ? expandPointGeometry(geometry)
      : expandSurfaceGeometry(geometry);
  const resultTail = createResultColorTail(vertexData.nodePickIds, resultColors);
  const vertexWithResults = appendResultColorTail(vertexData.positions, resultTail);
  const vertexBuffer = createBuffer(
    draw.device,
    vertexWithResults.data,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  const indexBuffer = createBuffer(draw.device, vertexData.indices, GPUBufferUsage.INDEX);
  const geometryData = buildPartGeometryData(draw.device, part, geometry, vertexData, resultTail);
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer,
    resultColorBuffers: [
      { buffer: vertexBuffer, offset: vertexWithResults.offset },
      ...(geometryData.subsetResultColorBinding === undefined
        ? []
        : [geometryData.subsetResultColorBinding]),
    ],
    resultColorNodeCount: resultTail.resultColorNodeCount,
    resultColorsSource: resultColors,
    resultColorsActive: resultColors !== undefined,
    ...geometryData.picks,
    facePickIdsBuffer: geometryData.facePickIdsBuffer,
    edge: undefined,
    edgePick: undefined,
    indexCount: vertexData.indices.length,
    ...geometryData.subsetBuffers,
    subsetIndexCount: geometryData.subsetIndices?.length ?? 0,
  };
  resources.set(geometry.primitive, resource);
  draw.primitiveParts.set(part.id, resources);
  if (!draw.parts.has(part.id)) draw.parts.set(part.id, resource);
  return resource;
}

/** Returns a cached resource for one primitive leaf, when it has been uploaded. */
export function getPartResource(
  draw: DrawResources,
  partId: PartId,
  primitive?: Primitive,
): PartResource | undefined {
  if (primitive !== undefined) return draw.primitiveParts.get(partId)?.get(primitive);
  return draw.parts.get(partId);
}

/** Materializes and caches a part's optional edge resource on first use. */
export function ensureEdgeResources(
  draw: DrawResources,
  part: Part,
  geometryOrResource: Extract<Geometry, { primitive: "triangles" }> | PartResource,
  resourceMaybe?: PartResource,
): NonNullable<PartResource["edge"]> | undefined {
  const geometry = (resourceMaybe === undefined ? part.geometry : geometryOrResource) as Extract<
    Geometry,
    { primitive: "triangles" }
  >;
  const resource = resourceMaybe ?? (geometryOrResource as PartResource);
  if (resourceMaybe === undefined && part.geometry.primitive !== "triangles") return undefined;
  if (resource.edge !== undefined) return resource.edge;
  const resultTail = createResultColorTail(
    new Uint32Array([resource.resultColorNodeCount - 1]),
    resource.resultColorsSource,
  );
  const edge = buildPartEdgeResources(draw.device, geometry, resultTail);
  if (edge === undefined) return undefined;
  resource.edge = edge;
  resource.resultColorBuffers = [...resource.resultColorBuffers, edge.resultColorBinding];
  return edge;
}

/** Materializes authored-edge pick resources only when edge granularity is requested. */
export function ensureEdgePickResources(
  draw: DrawResources,
  part: Part,
  geometryOrResource: Extract<Geometry, { primitive: "triangles" }> | PartResource,
  resourceMaybe?: PartResource,
): NonNullable<PartResource["edgePick"]> | undefined {
  const geometry = (resourceMaybe === undefined ? part.geometry : geometryOrResource) as Extract<
    Geometry,
    { primitive: "triangles" }
  >;
  const resource = resourceMaybe ?? (geometryOrResource as PartResource);
  if (resourceMaybe === undefined && part.geometry.primitive !== "triangles") return undefined;
  if (resource.edgePick !== undefined) return resource.edgePick;
  const edgePick = buildPartEdgePickResources(draw.device, geometry);
  if (edgePick === undefined) return undefined;
  resource.edgePick = edgePick;
  return edgePick;
}

interface PointVertexData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
  readonly primitiveIds: Uint32Array;
}

/** Expands logical point centers into the camera-facing sprite vertices. */
function expandPointGeometry(
  geometry: Extract<Part["geometry"], { primitive: "points" }>,
): PointVertexData {
  const pointCount = geometry.indices.length;
  const positions = new Float32Array(pointCount * 12);
  const indices = new Uint32Array(pointCount * 6);
  const nodePickIds = new Uint32Array(pointCount * 4);
  const primitiveIds = new Uint32Array(pointCount * 4);
  for (let point = 0; point < pointCount; point += 1) {
    const sourceIndex = geometry.indices[point] ?? 0;
    const sourceOffset = sourceIndex * 3;
    const targetOffset = point * 12;
    const x = geometry.positions[sourceOffset] ?? 0;
    const y = geometry.positions[sourceOffset + 1] ?? 0;
    const z = geometry.positions[sourceOffset + 2] ?? 0;
    for (let corner = 0; corner < 4; corner += 1) {
      const offset = targetOffset + corner * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
      nodePickIds[point * 4 + corner] = geometry.nodePickIds?.[sourceIndex] ?? 0;
      primitiveIds[point * 4 + corner] = point;
    }
    writePointSpriteIndices(indices, point);
  }
  return { positions, indices, nodePickIds, primitiveIds };
}

function writePointSpriteIndices(indices: Uint32Array, sprite: number): void {
  indices.set(
    POINT_SPRITE_INDICES.map((index) => index + sprite * 4),
    sprite * POINT_SPRITE_INDICES.length,
  );
}

/** Releases one uploaded part geometry resource, including optional overlays. */
export function destroyPartResource(resource: PartResource): void {
  resource.vertexBuffer.destroy();
  resource.indexBuffer.destroy();
  resource.elementOrdinalsBuffer.destroy();
  resource.facePickIdsBuffer.destroy();
  resource.nodePickIdsBuffer.destroy();
  resource.edge?.edgeNodePickIdsBuffer.destroy();
  resource.edge?.edgeVertexBuffer.destroy();
  resource.edge?.edgeIndexBuffer.destroy();
  resource.edge?.edgeTopologyBuffer.destroy();
  resource.edgePick?.vertexBuffer.destroy();
  resource.edgePick?.indexBuffer.destroy();
  resource.edgePick?.nodePickIdsBuffer.destroy();
  resource.edgePick?.topologyBuffer.destroy();
  resource.subsetIndexBuffer?.destroy();
  resource.subsetVertexBuffer?.destroy();
  resource.subsetNodePickIdsBuffer?.destroy();
  resource.subsetTopologyBuffer?.destroy();
}

/** Releases all per-placement instance and highlight buffers while retaining geometry. */
export function destroyInstanceResources(draw: DrawResources): void {
  for (const storage of draw.storages.values()) {
    storage.buffer.destroy();
    storage.orderBuffer.destroy();
    storage.selectionOrderBuffer.destroy();
    storage.nodeSelectionOrderBuffer.destroy();
    storage.transparentOrderBuffer.destroy();
    storage.edgeOrderBuffer.destroy();
    storage.nodeOrderBuffer.destroy();
    storage.highlight.buffer.destroy();
  }
  draw.storages.clear();
}

/** Releases every part, storage, deformation, and depth resource owned by the draw path. */
export function destroyDrawResources(draw: DrawResources): void {
  const destroyed = new Set<PartResource>();
  for (const resources of draw.primitiveParts.values()) {
    for (const resource of resources.values()) {
      destroyPartResource(resource);
      destroyed.add(resource);
    }
  }
  for (const resource of draw.parts.values()) {
    if (!destroyed.has(resource)) destroyPartResource(resource);
  }
  draw.primitiveParts.clear();
  for (const resource of draw.nodeParts.values()) destroyPartResource(resource);
  draw.parts.clear();
  draw.nodeParts.clear();
  destroyInstanceResources(draw);
  destroyDeformationBuffers(draw.deformations);
  draw.deformations.clear();
  destroyOrientationGlyphDrawResources(draw.orientationGlyphs);
  destroyColorTargets(draw.targets);
}

/** Releases all cached resources derived from one changed part definition. */
export function destroyPartResources(draw: DrawResources, partId: PartId): void {
  const resources = draw.primitiveParts.get(partId);
  if (resources !== undefined) {
    for (const resource of resources.values()) destroyPartResource(resource);
    draw.primitiveParts.delete(partId);
  } else {
    const resource = draw.parts.get(partId);
    if (resource !== undefined) destroyPartResource(resource);
  }
  draw.parts.delete(partId);
  const nodeResource = draw.nodeParts.get(partId);
  if (nodeResource !== undefined) {
    destroyPartResource(nodeResource);
    draw.nodeParts.delete(partId);
  }
  destroyDeformationBuffer(draw.deformations, partId);
  destroyOrientationGlyphPart(draw.orientationGlyphs, partId);
}
