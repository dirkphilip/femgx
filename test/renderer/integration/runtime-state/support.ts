import { createPart, MAX_PART_ID, type Part } from "../../../../src/geometry/part";

import { identity, translation } from "../../../../src/math/mat4";

import { createPackedSceneRuntime } from "../../../../src/scene-runtime/runtime";

import { createScene } from "../../../../src/scene/scene";

import {
  buildDrawOrder,
  buildNodeOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  buildInstanceLayout,
  buildTransparentOrder,
} from "../../../../src/renderer/runtime-state";

import {
  createInteractionState,
  setElementSelected,
  setInstanceSelected,
  setPartSelected,
} from "../../../../src/interaction/interaction";

import { setFaceSelected } from "../../../../src/interaction/faces";

import { setNodeSelected } from "../../../../src/interaction/nodes";

import { setTargetsSelected } from "../../../../src/interaction/targets";

import { buildSelectionDrawCalls } from "../../../../src/renderer/selection/draw-ranges";

/** Shared renderer test helper. */
export function part(id: number): Part {
  const geometry = {
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint32Array(),
    primitive: "triangles" as const,
  };
  return createPart(id, { geometries: [geometry] });
}

export const rangedSelectionPart = createPart(3, {
  geometries: [
    {
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 2, 1, 0, 2, 0, 1, 2,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      primitive: "triangles" as const,
      faces: [
        {
          elementId: 101,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0,1,2",
          nodeIds: [0, 1, 2],
        },
        {
          elementId: 102,
          faceIndex: 0,
          primitiveStart: 1,
          primitiveCount: 1,
          key: "3,4,5",
          nodeIds: [3, 4, 5],
        },
        {
          elementId: 103,
          faceIndex: 0,
          primitiveStart: 2,
          primitiveCount: 1,
          key: "6,7,8",
          nodeIds: [6, 7, 8],
        },
      ],
      faceSubset: { faceIds: [{ elementId: 101, faceIndex: 0 }] },
    },
  ],
  elements: [
    {
      id: 101,
      primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
    },
    {
      id: 102,
      primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
    },
    {
      id: 103,
      primitiveRanges: [{ primitive: "triangles", primitiveStart: 2, primitiveCount: 1 }],
    },
  ],
});

export const fragmentedSelectionPart = createPart(4, {
  geometries: [
    {
      positions: new Float32Array(2049 * 9),
      indices: Uint32Array.from({ length: 2049 * 3 }, (_, index) => index),
      primitive: "triangles" as const,
    },
  ],
  elements: Array.from({ length: 2049 }, (_, index) => ({
    id: index + 1,
    primitiveRanges: [
      { primitive: "triangles" as const, primitiveStart: index, primitiveCount: 1 },
    ],
  })),
});

export {
  createPart,
  MAX_PART_ID,
  type Part,
  identity,
  translation,
  createPackedSceneRuntime,
  createScene,
  buildDrawOrder,
  buildNodeOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  buildInstanceLayout,
  buildTransparentOrder,
  createInteractionState,
  setElementSelected,
  setInstanceSelected,
  setPartSelected,
  setFaceSelected,
  setNodeSelected,
  setTargetsSelected,
  buildSelectionDrawCalls,
};
