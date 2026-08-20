import { createPart, MAX_PART_ID, type Part } from "@/geometry/part";

import { identityMatrix, translationMatrix } from "@/math/mat4";

import { createPackedSceneRuntime } from "@/scene-runtime/runtime";

import { createSceneBuilder } from "@/scene/scene";
import { emptyPart } from "../../../support/scene-fixtures";
export { emptyPart as part };

import {
  buildDrawOrder,
  buildNodeOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  buildInstanceLayout,
  buildTransparentOrder,
} from "@/renderer/runtime-state";

import {
  createInteractionState,
  setElementSelected,
  setPartOccurrenceSelected,
  setPartSelected,
} from "@/interaction/interaction";

import { setFaceSelected } from "@/interaction/faces";

import { setNodeSelected } from "@/interaction/nodes";

import { setTargetsSelected } from "@/interaction/targets";

import { buildSelectionDrawCalls as buildSelectionDrawCallsInternal } from "@/renderer/selection/draw-ranges";
import {
  collectDenseElementSelections,
  type DenseElementSelections,
} from "@/renderer/selection/element-selection";

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

function selectionSkinPart(
  id: number,
  faceIds: readonly { readonly elementId: number; readonly faceIndex: number }[],
) {
  return createPart(id, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2, 0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0, 2, 1, 0]),
        primitive: "triangles",
        faces: selectionSkinFaces,
        faceSubset: { faceIds },
      },
    ],
    elements: selectionSkinElements,
  });
}

const selectionSkinFaces = [
  {
    elementId: 101,
    faceIndex: 0,
    primitiveStart: 0,
    primitiveCount: 1,
    key: "a",
    nodeIds: [0, 1, 2],
  },
  {
    elementId: 101,
    faceIndex: 1,
    primitiveStart: 1,
    primitiveCount: 1,
    key: "b",
    nodeIds: [0, 1, 2],
    neighborElementId: 102,
  },
  {
    elementId: 102,
    faceIndex: 0,
    primitiveStart: 2,
    primitiveCount: 1,
    key: "b",
    nodeIds: [0, 1, 2],
    neighborElementId: 101,
  },
  {
    elementId: 102,
    faceIndex: 1,
    primitiveStart: 3,
    primitiveCount: 1,
    key: "c",
    nodeIds: [0, 1, 2],
    neighborElementId: 103,
  },
  {
    elementId: 103,
    faceIndex: 0,
    primitiveStart: 4,
    primitiveCount: 1,
    key: "c",
    nodeIds: [0, 1, 2],
    neighborElementId: 102,
  },
  {
    elementId: 103,
    faceIndex: 1,
    primitiveStart: 5,
    primitiveCount: 1,
    key: "d",
    nodeIds: [0, 1, 2],
  },
] as const;

const selectionSkinElements = [101, 102, 103].map((id, index) => ({
  id,
  primitiveRanges: [
    { primitive: "triangles" as const, primitiveStart: index * 2, primitiveCount: 2 },
  ],
}));

export const interiorSubsetPart = selectionSkinPart(5, [{ elementId: 101, faceIndex: 1 }]);
export const denseSelectionPart = selectionSkinPart(6, [
  { elementId: 101, faceIndex: 0 },
  { elementId: 103, faceIndex: 1 },
]);

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
  identityMatrix,
  translationMatrix,
  createPackedSceneRuntime,
  createSceneBuilder,
  buildDrawOrder,
  buildNodeOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  buildInstanceLayout,
  buildTransparentOrder,
  createInteractionState,
  setElementSelected,
  setPartOccurrenceSelected,
  setPartSelected,
  setFaceSelected,
  setNodeSelected,
  setTargetsSelected,
};

type SelectionDrawCallOptions = Omit<
  Parameters<typeof buildSelectionDrawCallsInternal>[0],
  "denseSelections"
> & { readonly denseSelections?: DenseElementSelections };

/** Builds test selection calls while supplying the production dense payload. */
export function buildSelectionDrawCallsForTest(
  options: SelectionDrawCallOptions,
): ReturnType<typeof buildSelectionDrawCallsInternal> {
  const denseSelections =
    options.denseSelections ??
    collectDenseElementSelections(
      options.runtime,
      options.layout,
      new Map([[options.partId, options.part]]),
      options.interaction,
    );
  return buildSelectionDrawCallsInternal({ ...options, denseSelections });
}
