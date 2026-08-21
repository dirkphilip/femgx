import type { Geometry, Part, Primitive } from "../../../geometry/part";
import { expandPointGeometry, type PointVertexData } from "../point-sprites";
import { expandSurfaceGeometry, type SurfaceVertexData } from "../surface-geometry";
import {
  buildPartGeometryData,
  triangleUploadData,
  type UploadVertexData,
} from "../geometry-upload";
import { createBuffer, type PartResource } from "../foundation";
import type { DrawResources } from "../draw-types";

/** Uploads and publishes one complete geometry resource or releases every local buffer. */
export function uploadFullGeometry(
  draw: DrawResources,
  part: Part,
  geometry: Geometry,
  resources: Map<Primitive, PartResource>,
  primitiveColorBuffer: GPUBuffer | undefined,
): PartResource {
  const vertexData: SurfaceVertexData | PointVertexData | UploadVertexData =
    geometry.primitive === "points"
      ? expandPointGeometry(geometry)
      : geometry.primitive === "triangles"
        ? triangleUploadData(geometry)
        : expandSurfaceGeometry(geometry);
  const allocated: GPUBuffer[] = [];
  try {
    const vertexBuffer = trackBuffer(
      allocated,
      createBuffer(
        draw.device,
        vertexData.positions,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
      ),
    );
    const indexBuffer = trackBuffer(
      allocated,
      createBuffer(draw.device, vertexData.indices, GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE),
    );
    const geometryData = buildPartGeometryData(draw.device, part, geometry, vertexData);
    trackGeometryData(allocated, geometryData);
    const resource = fullGeometryResource(
      vertexData,
      vertexBuffer,
      indexBuffer,
      geometryData,
      primitiveColorBuffer,
    );
    resources.set(geometry.primitive, resource);
    draw.primitiveParts.set(part.id, resources);
    if (!draw.parts.has(part.id)) draw.parts.set(part.id, resource);
    return resource;
  } catch (error) {
    for (const buffer of new Set(allocated)) buffer.destroy();
    throw error;
  }
}

function fullGeometryResource(
  vertexData: SurfaceVertexData | PointVertexData | UploadVertexData,
  vertexBuffer: GPUBuffer,
  indexBuffer: GPUBuffer,
  geometryData: ReturnType<typeof buildPartGeometryData>,
  primitiveColorBuffer: GPUBuffer | undefined,
): PartResource {
  return {
    vertexBuffer,
    indexBuffer,
    nodePickIdsBuffer: geometryData.nodePickIdsBuffer,
    facePickIdsBuffer: geometryData.facePickIdsBuffer,
    edge: undefined,
    edgePick: undefined,
    indexCount: vertexData.indices.length,
    fullVertexBuffer: vertexBuffer,
    fullIndexBuffer: indexBuffer,
    ...(geometryData.cornerIndexOffset === undefined
      ? {}
      : {
          minimalIndexBuffer: geometryData.facePickIdsBuffer,
          minimalIndexOffset: geometryData.cornerIndexOffset,
          fullMinimalIndexBuffer: geometryData.facePickIdsBuffer,
          fullMinimalIndexOffset: geometryData.cornerIndexOffset,
        }),
    fullFacePickIdsBuffer: geometryData.facePickIdsBuffer,
    fullNodePickIdsBuffer: geometryData.nodePickIdsBuffer,
    fullIndexCount: vertexData.indices.length,
    ...(primitiveColorBuffer === undefined ? {} : { primitiveColorBuffer }),
    ...geometryData.subsetBuffers,
    subsetIndexCount: geometryData.subsetIndices?.length ?? 0,
  };
}

function trackGeometryData(
  allocated: GPUBuffer[],
  data: ReturnType<typeof buildPartGeometryData>,
): void {
  allocated.push(data.nodePickIdsBuffer, data.facePickIdsBuffer);
  for (const buffer of [
    data.subsetBuffers.subsetIndexBuffer,
    data.subsetBuffers.subsetMinimalIndexBuffer,
    data.subsetBuffers.subsetVertexBuffer,
    data.subsetBuffers.subsetNodePickIdsBuffer,
    data.subsetBuffers.subsetTopologyBuffer,
  ]) {
    if (buffer !== undefined) allocated.push(buffer);
  }
}

function trackBuffer(buffers: GPUBuffer[], buffer: GPUBuffer): GPUBuffer {
  buffers.push(buffer);
  return buffer;
}
