import { createPart, MAX_PART_ID, type Part } from "../../../../src/geometry/part";

import { translation } from "../../../../src/math/mat4";

import {
  createDrawResources,
  destroyDrawResources,
  EMISSIVE_BYTE_OFFSET,
  encodeInstanceRecord,
  INSTANCE_EDGE_OVERLAY_FLAG,
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_SELECTED_FLAG,
  patchInstances,
  uploadPart,
  ensureEdgePickResources,
  writeDrawOrder,
  writeEdgeOrder,
  writeNodeOrder,
  writeSelectionOrder,
  writeTransparentOrder,
  type DrawCallContext,
} from "../../../../src/renderer/resources/draw-resources";

import { drawBatches } from "../../../../src/renderer/frame/batch";

import { ensureColorTargets } from "../../../../src/renderer/frame/pipelines";

import { beginColorPass } from "../../../../src/renderer/frame/passes";

import { defaultStyle } from "../../../../src/renderer/resources/foundation";

import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
} from "../../../../src/renderer/resources/element-resources";

import type { DrawPipelines } from "../../../../src/renderer/frame/pipelines";

import { fakeGpuDevice, installGpuGlobals } from "../../fake-gpu";

import { syncInstanceEmphasisAdmission } from "../../../../src/renderer/selection/instance-emphasis";

import type { DenseElementSelections } from "../../../../src/renderer/selection/element-selection";

export const part: Part = createPart(1, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
    },
  ],
});

export const authoredEdgePart: Part = createPart(5, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3]),
      faces: [
        {
          elementId: 4,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "face",
          nodeIds: [0, 1, 2],
        },
      ],
      edges: [
        {
          key: "0,1",
          nodeIds: [0, 1],
          incidentElementIds: [4],
          faceRefs: [{ elementId: 4, faceIndex: 0 }],
        },
        {
          key: "0,2",
          nodeIds: [0, 2],
          incidentElementIds: [4],
          faceRefs: [{ elementId: 4, faceIndex: 0 }],
        },
        {
          key: "1,2",
          nodeIds: [1, 2],
          incidentElementIds: [4],
          faceRefs: [{ elementId: 4, faceIndex: 0 }],
        },
      ],
    },
  ],
  elements: [
    { id: 4, primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }] },
  ],
});

export const subsetPart: Part = createPart(2, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      primitive: "triangles" as const,
      faces: [
        {
          elementId: 1,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0,1,2",
          nodeIds: [0, 1, 2],
        },
        {
          elementId: 1,
          faceIndex: 1,
          primitiveStart: 1,
          primitiveCount: 1,
          key: "3,4,5",
          nodeIds: [3, 4, 5],
        },
      ],
      faceSubset: { faceIds: [{ elementId: 1, faceIndex: 1 }] },
    },
  ],
});

export const logicalPointPart: Part = createPart(3, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      indices: new Uint32Array([0, 1]),
      primitive: "points",
      nodePickIds: new Uint32Array([1, 2]),
    },
  ],
  elements: [
    { id: 10, primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }] },
    { id: 11, primitiveRanges: [{ primitive: "points", primitiveStart: 1, primitiveCount: 1 }] },
  ],
});

export const nodePart: Part = createPart(4, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles",
      nodePickIds: new Uint32Array([1, 2, 3]),
    },
  ],
  nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
});

export const mixedPart: Part = createPart(6, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles",
    },
    {
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      indices: new Uint32Array([0, 1]),
      primitive: "lines",
    },
    {
      positions: new Float32Array([0.5, 0.5, 0.5]),
      indices: new Uint32Array([0]),
      primitive: "points",
    },
  ],
  elements: [
    { id: 1, primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }] },
    { id: 2, primitiveRanges: [{ primitive: "lines", primitiveStart: 0, primitiveCount: 1 }] },
    { id: 3, primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }] },
  ],
});

/** Shared renderer test helper. */
export function record(x: number): ArrayBuffer {
  return encodeInstanceRecord(translation(x, 0, 0), defaultStyle, 1);
}

/** Shared renderer test helper. */
export function denseRecord(fill: number): ArrayBuffer {
  const data = new Uint8Array(96);
  data.fill(fill);
  return data.buffer;
}

/** Shared renderer test helper. */
export function instanceWrites(gpu: ReturnType<typeof fakeGpuDevice>) {
  return gpu.writes.filter((write) => write.bytes.byteLength !== 64);
}

/** Shared renderer test helper. */
export function writeRanges(gpu: ReturnType<typeof fakeGpuDevice>, start: number) {
  return instanceWrites(gpu)
    .slice(start)
    .map((write) => [write.offset, write.bytes.byteLength] as const);
}

/** Shared renderer test helper. */
export function drawContext(): DrawCallContext {
  return {
    frameBindGroup: {} as GPUBindGroup,
    instanceLayout: {} as GPUBindGroupLayout,
    parts: new Map([[part.id, part]]),
    pipelines: {} as DrawPipelines,
    resultColors: undefined,
    usesExteriorFaceSubsets: true,
  };
}

export {
  createPart,
  MAX_PART_ID,
  type Part,
  translation,
  createDrawResources,
  destroyDrawResources,
  EMISSIVE_BYTE_OFFSET,
  encodeInstanceRecord,
  INSTANCE_EDGE_OVERLAY_FLAG,
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_SELECTED_FLAG,
  patchInstances,
  uploadPart,
  ensureEdgePickResources,
  writeDrawOrder,
  writeEdgeOrder,
  writeNodeOrder,
  writeSelectionOrder,
  writeTransparentOrder,
  type DrawCallContext,
  drawBatches,
  ensureColorTargets,
  beginColorPass,
  defaultStyle,
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  type DrawPipelines,
  fakeGpuDevice,
  installGpuGlobals,
  syncInstanceEmphasisAdmission,
  type DenseElementSelections,
};
