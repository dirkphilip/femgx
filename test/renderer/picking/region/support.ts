import { createPart, type Geometry, type GeometryInput } from "@/geometry/part";

import { identityMatrix } from "@/math/mat4";

import {
  pickEdgeTargetsFromRegion,
  pickTargetsFromRegion,
  renderPixelRect,
} from "@/renderer/picking/region";

import { createPickRegionTargetResolver } from "@/renderer/picking/region-resolver";

import { createPickRegionTargetCollector } from "@/renderer/picking/region-targets";

import {
  createPickTargets,
  ensureEdgePickTarget,
  ensurePickTargets,
  resetPickTargets,
  type PickTargets,
} from "@/renderer/picking/pick";

import type { DrawResources } from "@/renderer/resources/draw-resources";

import type { InteractionGranularity } from "@/picking/types";

import type { PickContext, ResolvedPickIds } from "@/picking/pick";

import type { PartOccurrence } from "@/scene/types";

import type { BoxSelectionRect } from "@/interaction/box-selection";

import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../../fake-gpu";

import { createPickDepthReadback } from "@/renderer/picking/depth";

import { getPartSemanticIndex } from "@/geometry/part-semantic-index";

/** Shared renderer test helper. */
export function rect(overrides: Partial<BoxSelectionRect> = {}): BoxSelectionRect {
  return {
    left: 10,
    top: 20,
    right: 110,
    bottom: 120,
    width: 100,
    height: 100,
    ...overrides,
  };
}

/** Shared renderer test helper. */
export function instance(partId = 1): PartOccurrence {
  return { partOccurrenceId: "root/0", partId, worldTransform: identityMatrix() };
}

/** Shared renderer test helper. */
export function triangleGeometry(): GeometryInput {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles",
  };
}

/** Shared renderer test helper. */
export function trianglePart(): ReturnType<typeof createPart> {
  return createPart(1, {
    geometries: [triangleGeometry()],
    elements: [
      {
        id: 4,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
    ],
  });
}

/** Shared renderer test helper. */
export function richTrianglePart(): ReturnType<typeof createPart> {
  return createPart(1, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
        nodePickIds: new Uint32Array([1, 2, 3]),
        faces: [
          {
            elementId: 4,
            faceIndex: 2,
            primitiveStart: 0,
            primitiveCount: 1,
            bodyId: 7,
            key: "0:1:2",
            nodeIds: [0, 1, 2],
          },
        ],
      },
    ],
    elements: [
      {
        id: 4,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        bodyId: 7,
      },
    ],
    bodies: [{ id: 7, elementIds: [4] }],
    nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  });
}

/** Shared renderer test helper. */
export function ids(overrides: Partial<ResolvedPickIds> = {}): ResolvedPickIds {
  return { instancePickId: 1, elementPickId: 0, facePickId: 0, nodePickId: 0, ...overrides };
}

/** Shared renderer test helper. */
export async function targets(
  gpu: ReturnType<typeof fakeGpuDevice>,
  context: PickContext,
  granularity: InteractionGranularity,
  selection = rect(),
  existingPick?: PickTargets,
) {
  const pick = existingPick ?? createPickTargets(await createPickDepthReadback(gpu.device));
  ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
  return pickTargetsFromRegion({
    device: gpu.device,
    canvas: fakeCanvas(),
    pick,
    readback: pick.readback,
    context,
    rect: selection,
    granularity,
  });
}

export {
  createPart,
  type Geometry,
  identityMatrix,
  pickEdgeTargetsFromRegion,
  pickTargetsFromRegion,
  renderPixelRect,
  createPickRegionTargetResolver,
  createPickRegionTargetCollector,
  createPickTargets,
  ensureEdgePickTarget,
  ensurePickTargets,
  resetPickTargets,
  type PickTargets,
  type DrawResources,
  type InteractionGranularity,
  type PickContext,
  type ResolvedPickIds,
  type PartOccurrence,
  type BoxSelectionRect,
  fakeCanvas,
  fakeGpuDevice,
  installGpuGlobals,
  createPickDepthReadback,
  getPartSemanticIndex,
};
