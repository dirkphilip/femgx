import {
  createPart,
  type ElementTessellation,
  type Geometry,
  type GeometryBody,
  type Part,
} from "../../../../src/geometry/part";

import {
  createInteractionState,
  setElementHighlighted,
  setElementOverride,
  setElementSelected,
} from "../../../../src/interaction/interaction";

import {
  setBodyOverride,
  setBodySelected,
  setBodyVisible,
} from "../../../../src/interaction/bodies";

import { setFaceSelected } from "../../../../src/interaction/faces";

import { setEdgeSelected } from "../../../../src/interaction/edges";

import { setNodeSelected } from "../../../../src/interaction/nodes";

import { setTargetHovered } from "../../../../src/interaction/targets";

import { translation } from "../../../../src/math/mat4";

import {
  createPackedSceneRuntime,
  type PackedSceneRuntime as SceneRuntime,
} from "../../../../src/scene-runtime/runtime";

import { createScene, type Scene } from "../../../../src/scene/scene";

import {
  collectEmphasisUpdates,
  ELEMENT_RECORD_STRIDE,
  encodeEmphasisRecord,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
  type EmphasisUpdate,
} from "../../../../src/renderer/resources/element-resources";

import { getPartSemanticIndex } from "../../../../src/geometry/part-semantic-index";

import {
  createHighlightStorage,
  syncElementHighlights,
  writeElementHighlights,
} from "../../../../src/renderer/selection/highlight-storage";

import { collectDenseElementSelections } from "../../../../src/renderer/selection/element-selection";

import {
  buildBodyPrimitivePickIds,
  buildElementPrimitiveOrdinals,
  buildElementPrimitivePickIds,
  buildFacePrimitivePickIds,
  buildPrimitiveFaceBodyPickData,
} from "../../../../src/renderer/picking/ids";
import {
  buildNodeSpritePickIds,
  buildPackedNodeTopologyData,
} from "../../../../src/renderer/picking/node-topology";

import { HIGHLIGHT_BUCKET_SIZE } from "../../../../src/renderer/selection/highlight-table";

import {
  createDrawResources,
  encodeInstanceRecord,
  patchInstances,
} from "../../../../src/renderer/resources/draw-resources";

import { defaultStyle } from "../../../../src/renderer/resources/foundation";

import type { InstanceStorage } from "../../../../src/renderer/resources/draw-resources";

import { buildInstanceLayout } from "../../../../src/renderer/runtime-state";

import { fakeGpuDevice, installGpuGlobals } from "../../fake-gpu";

import { createBoltedPlateFixture } from "../../../../demo/fixtures/bolted-plate";

export type SemanticTestGeometry = Geometry & {
  readonly elements?: readonly ElementTessellation[];
  readonly bodies?: readonly GeometryBody[];
  readonly nodePositions?: Float32Array;
};

/** Shared renderer test helper. */
export function partFor(geometry: SemanticTestGeometry): Part {
  const { elements, bodies, nodePositions, ...localGeometry } = geometry;
  return createPart(1, {
    geometries: [localGeometry],
    ...(elements === undefined ? {} : { elements }),
    ...(bodies === undefined ? {} : { bodies }),
    ...(nodePositions === undefined ? {} : { nodePositions }),
  });
}

export const style = {
  color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
  emissive: 0.5,
  opacity: 1,
  lineWidthPixels: 2,
  edge: false,
  nodes: false,
};

/** Shared renderer test helper. */
export function elementUpdate(slot: number, elementId: number): EmphasisUpdate {
  return { slot, elementPickId: elementId + 1, facePickId: 0, nodePickId: 0, style };
}

/** Shared renderer test helper. */
export function bodyUpdate(slot: number, bodyId: number): EmphasisUpdate {
  return {
    slot,
    elementPickId: 0,
    facePickId: 0,
    nodePickId: 0,
    bodyPickId: bodyId + 1,
    style,
  };
}

/** Shared renderer test helper. */
export function elementScene(): { readonly scene: Scene; readonly runtime: SceneRuntime } {
  const geometry: SemanticTestGeometry = {
    positions: new Float32Array(18),
    indices: new Uint32Array(18),
    primitive: "triangles" as const,
    elements: [
      {
        id: 0,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 6 }],
        bodyId: 3,
      },
    ],
    bodies: [{ id: 3, name: "body", elementIds: [0] }],
    nodePickIds: new Uint32Array([1, 2, 3, 1, 2, 3]),
    nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    faces: [
      {
        elementId: 0,
        faceIndex: 0,
        primitiveStart: 0,
        primitiveCount: 2,
        key: "0,1,2",
        nodeIds: [0, 1, 2],
        bodyId: 3,
      },
      {
        elementId: 0,
        faceIndex: 1,
        primitiveStart: 2,
        primitiveCount: 2,
        key: "0,1,3",
        nodeIds: [0, 1, 3],
        bodyId: 3,
      },
      {
        elementId: 0,
        faceIndex: 2,
        primitiveStart: 4,
        primitiveCount: 2,
        key: "0,2,3",
        nodeIds: [0, 2, 3],
        bodyId: 3,
      },
    ],
  };
  const part: Part = partFor(geometry);
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        { kind: "part", partId: 1, transform: translation(0, 0, 0) },
        { kind: "part", partId: 1, transform: translation(2, 0, 0) },
      ],
    })
    .withRoot(1)
    .build();
  return { scene, runtime: createPackedSceneRuntime(scene) };
}

/** Shared renderer test helper. */
export function partsMap(scene: Scene): Map<number, Part> {
  return new Map(scene.parts);
}

/** Shared renderer test helper. */
export function makeStorage(gpu: ReturnType<typeof fakeGpuDevice>): InstanceStorage {
  const emptyHighlight = createHighlightStorage(gpu.device, 1);
  return {
    highlight: emptyHighlight,
    emptyHighlight,
    highlightOwned: false,
    bindGroup: undefined,
  } as unknown as InstanceStorage;
}

export {
  createPart,
  type ElementTessellation,
  type Geometry,
  type GeometryBody,
  type Part,
  createInteractionState,
  setElementHighlighted,
  setElementOverride,
  setElementSelected,
  setBodyOverride,
  setBodySelected,
  setBodyVisible,
  setFaceSelected,
  setEdgeSelected,
  setNodeSelected,
  setTargetHovered,
  translation,
  createPackedSceneRuntime,
  type SceneRuntime,
  createScene,
  type Scene,
  collectEmphasisUpdates,
  ELEMENT_RECORD_STRIDE,
  encodeEmphasisRecord,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
  type EmphasisUpdate,
  getPartSemanticIndex,
  createHighlightStorage,
  syncElementHighlights,
  writeElementHighlights,
  collectDenseElementSelections,
  buildBodyPrimitivePickIds,
  buildElementPrimitiveOrdinals,
  buildElementPrimitivePickIds,
  buildFacePrimitivePickIds,
  buildNodeSpritePickIds,
  buildPackedNodeTopologyData,
  buildPrimitiveFaceBodyPickData,
  HIGHLIGHT_BUCKET_SIZE,
  createDrawResources,
  encodeInstanceRecord,
  patchInstances,
  defaultStyle,
  type InstanceStorage,
  buildInstanceLayout,
  fakeGpuDevice,
  installGpuGlobals,
  createBoltedPlateFixture,
};
