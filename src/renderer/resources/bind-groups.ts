import { orderBufferFor, type InstanceStorage } from "./instance-storage";
import type { PartResource } from "../resources/foundation";

/** The per-part draw inputs a bind group addresses. */
export interface PartDrawInputs {
  readonly geometry: PartResource;
  /** Nodal displacement buffer; empty for parts without deformation data. */
  readonly deformation: GPUBuffer;
  /** Dense nodal or elemental scalar colors; inactive header when absent. */
  readonly resultColors: GPUBuffer;
  /** Binds endpoint-aligned node ids for the wireframe pass. */
  readonly edge?: boolean;
  /** Binds the optional widened authored-edge pick geometry. */
  readonly edgePick?: boolean;
  /** Binds expanded face-subset surface data instead of the full part data. */
  readonly surfaceSubset?: boolean;
  /** Whether to retain the per-path bind group; edge-pick bindings stay transient. */
  readonly cache?: boolean;
  /** Aligned byte offset into the active occurrence order buffer. */
  readonly orderByteOffset?: number;
  /** Selects the binding layout admitted for this draw. */
  readonly admission?: "minimal" | "topology" | "feature";
}

/**
 * Returns the cached per-part bind group addressing the surface or edge order.
 * Both bind groups bind the part's deformation buffer so displaced vertices are
 * drawn identically in the solid, pick, and edge-overlay passes.
 */
export function orderBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  storage: InstanceStorage,
  orderKind: "opaque" | "transparent" | "edge" | "node" | "selection" | "node-selection",
  part: PartDrawInputs,
): GPUBindGroup {
  const orderBuffer = orderBufferFor(storage, orderKind);
  const create = (): GPUBindGroup =>
    part.admission === "minimal"
      ? minimalInstanceBindGroup(device, layout, storage, orderBuffer)
      : instanceBindGroup(device, layout, storage, orderBuffer, part);
  if (part.cache === false || part.orderByteOffset !== undefined) return create();
  if (part.admission === "minimal") {
    return orderKind === "transparent"
      ? (storage.minimalTransparentBindGroup ??= create())
      : (storage.minimalBindGroup ??= create());
  }
  return cachedOrderBindGroup(storage, orderKind, part.surfaceSubset === true, create);
}

function minimalInstanceBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  storage: InstanceStorage,
  orderBuffer: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    label: "femgx minimal part draw bind group",
    layout,
    entries: [
      { binding: 0, resource: { buffer: storage.buffer } },
      { binding: 1, resource: { buffer: orderBuffer } },
    ],
  });
}

function orderBinding(buffer: GPUBuffer, offset: number | undefined): GPUBufferBinding {
  return offset === undefined ? { buffer } : { buffer, offset };
}

function cachedOrderBindGroup(
  storage: InstanceStorage,
  orderKind: "opaque" | "transparent" | "edge" | "node" | "selection" | "node-selection",
  surfaceSubset: boolean,
  create: () => GPUBindGroup,
): GPUBindGroup {
  if (surfaceSubset && orderKind === "transparent") {
    return (storage.subsetTransparentBindGroup ??= create());
  }
  if (surfaceSubset && orderKind === "opaque") {
    return (storage.subsetBindGroup ??= create());
  }
  if (surfaceSubset && orderKind === "selection") {
    return (storage.subsetSelectionBindGroup ??= create());
  }
  if (orderKind === "edge") {
    return (storage.edgeBindGroup ??= create());
  }
  if (orderKind === "transparent") {
    return (storage.transparentBindGroup ??= create());
  }
  if (orderKind === "selection") {
    return (storage.selectionBindGroup ??= create());
  }
  if (orderKind === "node-selection") {
    return (storage.nodeSelectionBindGroup ??= create());
  }
  if (orderKind === "node") {
    return (storage.nodeBindGroup ??= create());
  }
  return (storage.bindGroup ??= create());
}

/** Creates the per-part bind group addressing the given order buffer. */
function instanceBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  storage: InstanceStorage,
  orderBuffer: GPUBuffer,
  part: PartDrawInputs,
): GPUBindGroup {
  const geometry = part.geometry;
  const edgeResource = part.edge && !part.edgePick ? requireEdgeResource(geometry) : undefined;
  const edgePickResource = part.edgePick ? requireEdgePickResource(geometry) : undefined;
  const nodePickIdsBuffer =
    edgePickResource !== undefined
      ? edgePickResource.nodePickIdsBuffer
      : edgeResource !== undefined
        ? edgeResource.edgeNodePickIdsBuffer
        : part.surfaceSubset
          ? (geometry.subsetNodePickIdsBuffer ?? geometry.nodePickIdsBuffer)
          : (geometry.fullNodePickIdsBuffer ?? geometry.nodePickIdsBuffer);
  const topologyBuffer =
    edgePickResource !== undefined
      ? edgePickResource.topologyBuffer
      : edgeResource !== undefined
        ? edgeResource.edgeTopologyBuffer
        : part.surfaceSubset
          ? (geometry.subsetTopologyBuffer ?? geometry.facePickIdsBuffer)
          : (geometry.fullFacePickIdsBuffer ?? geometry.facePickIdsBuffer);
  const geometryPositionsBuffer =
    edgePickResource !== undefined
      ? edgePickResource.vertexBuffer
      : edgeResource !== undefined
        ? edgeResource.edgeVertexBuffer
        : part.surfaceSubset
          ? (geometry.subsetVertexBuffer ?? geometry.vertexBuffer)
          : (geometry.fullVertexBuffer ?? geometry.vertexBuffer);
  return device.createBindGroup({
    label: "femgx part draw bind group",
    layout,
    entries: [
      { binding: 0, resource: { buffer: storage.buffer } },
      { binding: 1, resource: orderBinding(orderBuffer, part.orderByteOffset) },
      { binding: 3, resource: { buffer: storage.highlight.buffer } },
      { binding: 4, resource: { buffer: part.deformation } },
      { binding: 5, resource: { buffer: topologyBuffer } },
      { binding: 6, resource: { buffer: nodePickIdsBuffer } },
      { binding: 7, resource: { buffer: geometryPositionsBuffer } },
      { binding: 8, resource: { buffer: part.resultColors } },
    ],
  });
}

function requireEdgeResource(geometry: PartResource): NonNullable<PartResource["edge"]> {
  if (geometry.edge === undefined) {
    throw new Error("Edge bind-group creation requires materialized edge resources");
  }
  return geometry.edge;
}

function requireEdgePickResource(geometry: PartResource): NonNullable<PartResource["edgePick"]> {
  if (geometry.edgePick === undefined) {
    throw new Error("Edge pick bind-group creation requires materialized edge pick resources");
  }
  return geometry.edgePick;
}
