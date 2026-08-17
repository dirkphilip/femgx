import type { Part, PartId } from "../../geometry/part";
import type { Geometry, Primitive } from "../../geometry/part";
import type { DeformationState } from "../../results/deform";
import type { SectionPlane } from "../../math/section-plane";
import { createEmptyDeformationBuffer } from "../frame/deformation";
import { packTopologyData } from "../resources/geometry-buffers";
import { createEmptyOrderBuffer } from "../resources/instance-storage";
import { createHighlightStorage } from "../selection/highlight-storage";
import {
  buildNodeBodyPickData,
  buildNodeBodyOwnerData,
  buildNodeSpritePickIds,
} from "../picking/ids";
import type { DrawPipelines } from "../frame/pipelines";
import { expandSurfaceGeometry, type SurfaceVertexData } from "./surface-geometry";
import { createBuffer, type PartResource } from "./foundation";
import { appendResultColorTail, createResultColorTail } from "./result-colors";
import {
  buildPartEdgePickResources,
  buildPartEdgeResources,
  buildPartGeometryData,
} from "../resources/geometry-upload";
import { createColorTargets } from "../resources/color-targets";
import { GpuCostAccumulator } from "../diagnostics/cost";
import { createOrientationGlyphDrawResources } from "../orientation-glyphs/orientation-glyph";
import type { DrawResources } from "./draw-types";

export type { DrawResources } from "./draw-types";

export { destroyDrawResources, destroyPartResource, destroyPartResources } from "./draw-lifecycle";

export { destroyInstancePartResources, destroyInstanceResources } from "./instance-lifecycle";

const POINT_SPRITE_INDICES = [0, 1, 2, 0, 2, 3] as const;

export {
  INSTANCE_STRIDE,
  INSTANCE_SELECTED_FLAG,
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_EDGE_EMPHASIS_FLAG,
  INSTANCE_EDGE_OVERLAY_FLAG,
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
} from "../resources/instance-storage";

/** A single instanced draw for one part. */
export interface DrawCall {
  readonly partId: PartId;
  readonly instanceCount: number;
  /** First entry in the bound order buffer, used by ranged selection draws. */
  readonly firstInstance?: number;
  /** Optional selected primitive ranges reused from the main index buffer. */
  readonly selectionRanges?: readonly SelectionDrawRange[];
}

/** One index-buffer range for a selected primitive group. */
export interface SelectionDrawRange {
  readonly primitive: Primitive;
  readonly firstIndex: number;
  readonly indexCount: number;
}

/** Per-frame inputs shared by every draw batch of a pass. */
export interface DrawCallContext {
  readonly frameBindGroup: GPUBindGroup;
  readonly minimalFrameBindGroup?: GPUBindGroup;
  readonly instanceLayout: GPUBindGroupLayout;
  readonly minimalInstanceLayout?: GPUBindGroupLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly pipelines: DrawPipelines;
  readonly resultColors: ReadonlyMap<PartId, Float32Array> | undefined;
  readonly deformation?: DeformationState;
  readonly sectionPlane?: SectionPlane;
  readonly usesExteriorFaceSubsets: boolean;
}

/** Creates the draw-path resource owner. */
export function createDrawResources(
  device: GPUDevice,
  cost = new GpuCostAccumulator(),
): DrawResources {
  const emptyOrderBuffer = createEmptyOrderBuffer(device);
  const emptyHighlight = createHighlightStorage(device, 1);
  const emptyDeformationBuffer = createEmptyDeformationBuffer(device);
  cost.allocateBuffer(emptyOrderBuffer.size);
  cost.allocateBuffer(emptyHighlight.buffer.size);
  cost.allocateBuffer(emptyDeformationBuffer.size);
  return {
    device,
    cost,
    destroyed: false,
    parts: new Map(),
    primitiveParts: new Map(),
    nodeParts: new Map(),
    storages: new Map(),
    admissionCache: new Map(),
    emptyOrderBuffer,
    emptyHighlight,
    emptyDeformationBuffer,
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
  const nodes = part.nodePositions ?? new Float32Array(0);
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
        { primitiveIds: [], edgeIds: [] },
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

/** Uploads and caches one homogeneous primitive leaf of a semantic part. */
export function uploadPart(
  draw: DrawResources,
  part: Part,
  resultColors?: Float32Array,
): PartResource {
  if (part.geometries.length !== 1) {
    throw new Error("uploadPart requires one explicit geometry group");
  }
  const geometry = part.geometries[0];
  if (geometry === undefined) throw new Error("Part has no geometry groups");
  return uploadGeometryPart(draw, part, geometry, resultColors);
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
  const geometry =
    "primitive" in geometryOrResource
      ? geometryOrResource
      : part.geometries.find((candidate) => candidate.primitive === "triangles");
  const resource = "primitive" in geometryOrResource ? resourceMaybe : geometryOrResource;
  if (resource === undefined) throw new Error("Edge geometry requires its uploaded resource");
  if (geometry?.primitive !== "triangles") return undefined;
  if (resource.edge !== undefined) return resource.edge;
  const resultTail = createResultColorTail(
    new Uint32Array([resource.resultColorNodeCount - 1]),
    resource.resultColorsSource,
  );
  const edge = buildPartEdgeResources(draw.device, part, geometry, resultTail);
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
  const geometry =
    "primitive" in geometryOrResource
      ? geometryOrResource
      : part.geometries.find((candidate) => candidate.primitive === "triangles");
  const resource = "primitive" in geometryOrResource ? resourceMaybe : geometryOrResource;
  if (resource === undefined) throw new Error("Edge-pick geometry requires its uploaded resource");
  if (geometry?.primitive !== "triangles") return undefined;
  if (resource.edgePick !== undefined) return resource.edgePick;
  const edgePick = buildPartEdgePickResources(draw.device, part, geometry);
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
  geometry: Extract<Geometry, { primitive: "points" }>,
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
