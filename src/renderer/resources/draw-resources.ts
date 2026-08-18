import type { Part, PartId } from "../../geometry/part";
import type { Geometry, Primitive } from "../../geometry/part";
import type { DeformationState } from "../../results/deform";
import type { ResultColorMap } from "../../results/colors";
import type { SectionPlane } from "../../math/section-plane";
import { createEmptyDeformationBuffer } from "../frame/deformation";
import { createEmptyOrderBuffer } from "../resources/instance-storage";
import { createHighlightStorage } from "../selection/highlight-storage";
import { buildNodeSpritePickIds, buildPackedNodeTopologyData } from "../picking/node-topology";
import type { DrawPipelines } from "../frame/pipelines";
import { expandSurfaceGeometry, type SurfaceVertexData } from "./surface-geometry";
import { createBuffer, type PartResource } from "./foundation";
import { createEmptyResultColorBuffer } from "./result-colors";
import {
  buildPartSubsetGeometryData,
  buildPartEdgePickResources,
  buildPartEdgeResources,
  buildPartGeometryData,
  materializeFullGeometry,
} from "../resources/geometry-upload";
import { createColorTargets } from "../resources/color-targets";
import { GpuCostAccumulator } from "../diagnostics/cost";
import { createOrientationGlyphDrawResources } from "../orientation-glyphs/orientation-glyph";
import type { DrawResources } from "./draw-types";
import type { VisibilitySkin } from "../visibility/types";
import { buildNodeSpriteBuffers, expandPointGeometry, type PointVertexData } from "./point-sprites";

export type { DrawResources } from "./draw-types";

export { destroyDrawResources, destroyPartResource, destroyPartResources } from "./draw-lifecycle";

export { destroyInstancePartResources, destroyInstanceResources } from "./instance-lifecycle";

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
  /** Optional compact fully-resident visibility skin for this occurrence group. */
  readonly visibilitySkin?: VisibilitySkin;
  /** Per-call exterior subset override when another occurrence needs a skin. */
  readonly surfaceSubset?: boolean;
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
  readonly resultColors: ResultColorMap | undefined;
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
  const emptyResultColorBuffer = createEmptyResultColorBuffer(device);
  cost.allocateBuffer(emptyOrderBuffer.size);
  cost.allocateBuffer(emptyHighlight.buffer.size);
  cost.allocateBuffer(emptyDeformationBuffer.size);
  cost.allocateBuffer(emptyResultColorBuffer.size);
  return {
    device,
    cost,
    destroyed: false,
    parts: new Map(),
    primitiveParts: new Map(),
    nodeParts: new Map(),
    storages: new Map(),
    visibilitySkins: new Map(),
    admissionCache: new Map(),
    emptyOrderBuffer,
    emptyHighlight,
    emptyDeformationBuffer,
    emptyResultColorBuffer,
    deformations: new Map(),
    resultColors: new Map(),
    orientationGlyphs: createOrientationGlyphDrawResources(device, cost),
    targets: createColorTargets(),
  };
}

/** Uploads the transient node-sprite geometry and its body-owner metadata. */
export function uploadNodePart(draw: DrawResources, part: Part): PartResource {
  const existing = draw.nodeParts.get(part.id);
  if (existing !== undefined) return existing;
  const nodes = part.nodePositions ?? new Float32Array(0);
  const spritePickIds = buildNodeSpritePickIds(part);
  const nodeTopology = buildPackedNodeTopologyData(part, spritePickIds);
  const { positions, ids, indices } = buildNodeSpriteBuffers(nodes, spritePickIds);
  const vertexBuffer = createBuffer(draw.device, positions, GPUBufferUsage.STORAGE);
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer: createBuffer(draw.device, indices, GPUBufferUsage.INDEX),
    facePickIdsBuffer: createBuffer(draw.device, nodeTopology, GPUBufferUsage.STORAGE),
    nodePickIdsBuffer: createBuffer(draw.device, ids, GPUBufferUsage.STORAGE),
    edge: undefined,
    edgePick: undefined,
    indexCount: indices.length,
    subsetIndexCount: 0,
  };
  draw.nodeParts.set(part.id, resource);
  return resource;
}

/** Uploads and caches one homogeneous primitive leaf of a semantic part. */
export function uploadPart(draw: DrawResources, part: Part): PartResource {
  if (part.geometries.length !== 1) {
    throw new Error("uploadPart requires one explicit geometry group");
  }
  const geometry = part.geometries[0];
  if (geometry === undefined) throw new Error("Part has no geometry groups");
  return uploadGeometryPart(draw, part, geometry);
}

/** Uploads and caches one homogeneous primitive leaf of a semantic part. */
export function uploadGeometryPart(
  draw: DrawResources,
  part: Part,
  geometry: Geometry,
  preferSubset = false,
): PartResource {
  const resources = draw.primitiveParts.get(part.id) ?? new Map<Primitive, PartResource>();
  const existing = resources.get(geometry.primitive);
  if (existing !== undefined) {
    if (!preferSubset && geometry.primitive !== "points") {
      materializeFullGeometry(draw.device, part, geometry, existing);
    }
    return existing;
  }
  if (preferSubset && geometry.primitive === "triangles") {
    const subset = buildPartSubsetGeometryData(draw.device, part, geometry);
    if (subset !== undefined) {
      const resource = subsetResource(subset.subsetBuffers, subset.subsetIndices.length);
      resources.set(geometry.primitive, resource);
      draw.primitiveParts.set(part.id, resources);
      if (!draw.parts.has(part.id)) draw.parts.set(part.id, resource);
      return resource;
    }
  }
  const vertexData: SurfaceVertexData | PointVertexData =
    geometry.primitive === "points"
      ? expandPointGeometry(geometry)
      : expandSurfaceGeometry(geometry);
  const vertexBuffer = createBuffer(
    draw.device,
    vertexData.positions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  const indexBuffer = createBuffer(draw.device, vertexData.indices, GPUBufferUsage.INDEX);
  const geometryData = buildPartGeometryData(draw.device, part, geometry, vertexData);
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer,
    nodePickIdsBuffer: geometryData.nodePickIdsBuffer,
    facePickIdsBuffer: geometryData.facePickIdsBuffer,
    edge: undefined,
    edgePick: undefined,
    indexCount: vertexData.indices.length,
    fullVertexBuffer: vertexBuffer,
    fullIndexBuffer: indexBuffer,
    fullFacePickIdsBuffer: geometryData.facePickIdsBuffer,
    fullNodePickIdsBuffer: geometryData.nodePickIdsBuffer,
    fullIndexCount: vertexData.indices.length,
    ...geometryData.subsetBuffers,
    subsetIndexCount: geometryData.subsetIndices?.length ?? 0,
  };
  resources.set(geometry.primitive, resource);
  draw.primitiveParts.set(part.id, resources);
  if (!draw.parts.has(part.id)) draw.parts.set(part.id, resource);
  return resource;
}

function subsetResource(
  buffers: NonNullable<ReturnType<typeof buildPartSubsetGeometryData>>["subsetBuffers"],
  indexCount: number,
): PartResource {
  if (
    buffers.subsetVertexBuffer === undefined ||
    buffers.subsetIndexBuffer === undefined ||
    buffers.subsetNodePickIdsBuffer === undefined ||
    buffers.subsetTopologyBuffer === undefined
  ) {
    throw new Error("Subset geometry did not produce complete GPU buffers");
  }
  return {
    vertexBuffer: buffers.subsetVertexBuffer,
    indexBuffer: buffers.subsetIndexBuffer,
    nodePickIdsBuffer: buffers.subsetNodePickIdsBuffer,
    facePickIdsBuffer: buffers.subsetTopologyBuffer,
    edge: undefined,
    edgePick: undefined,
    indexCount,
    subsetIndexCount: indexCount,
  };
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
  const edge = buildPartEdgeResources(draw.device, part, geometry);
  if (edge === undefined) return undefined;
  resource.edge = edge;
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
