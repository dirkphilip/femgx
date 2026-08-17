import { afterEach } from "vitest";

import { createWebGpuRenderer, readGpuCostSnapshot } from "../../../../src/renderer/gpu-renderer";

import { createGpuBundle, destroyGpuBundle } from "../../../../src/renderer/recovery";

import { RendererAttachment } from "../../../../src/renderer/attachment";

import { uploadPart } from "../../../../src/renderer/resources/draw-resources";

import { createPart } from "../../../../src/geometry/part";

import { createElement } from "../../../../src/elements/element";

import { createElementModel } from "../../../../src/elements/model";

import { TET4_SHAPE } from "../../../../src/elements/shapes";

import { elementPart } from "../../../../src/geometry/element-part";

import { createPackedSceneRuntime } from "../../../../src/scene-runtime/runtime";

import {
  createInteractionState,
  setElementOverride,
  setElementSelected,
  setInstanceOverride,
  setInstanceSelected,
  setPartOverride,
} from "../../../../src/interaction/interaction";

import {
  setBodyHighlighted,
  setBodyOverride,
  setBodySelected,
  setBodyVisible,
} from "../../../../src/interaction/bodies";

import { setElementVisible } from "../../../../src/interaction/elements";

import { setNodeSelected } from "../../../../src/interaction/nodes";

import { setTargetHovered } from "../../../../src/interaction/targets";

import { createScene, type Scene } from "../../../../src/scene/scene";

import { identity, translation } from "../../../../src/math/mat4";

import {
  projectPoint,
  unprojectPoint,
  type Camera,
  zoomCamera,
} from "../../../../src/camera/camera";

import {
  fakeCanvas,
  fakeGpuDevice,
  installFreshDeviceNavigator,
  installGpuGlobals,
} from "../../fake-gpu";

export const originalNavigator = globalThis.navigator;

export const originalDevicePixelRatio = globalThis.devicePixelRatio;

export let restoreGpuGlobals: (() => void) | undefined;

afterEach(() => {
  restoreGpuGlobals?.();
  restoreGpuGlobals = undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "devicePixelRatio", {
    configurable: true,
    value: originalDevicePixelRatio,
  });
});

/** Shared renderer test helper. */
export function installNavigator(device: GPUDevice): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: () => {
          return Promise.resolve({ requestDevice: () => Promise.resolve(device) });
        },
      },
    },
  });
}

/** Shared renderer test helper. */
export function buildScene(): Scene {
  const geometry = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
    nodePickIds: new Uint32Array([1, 2, 3]),
  };
  return createScene()
    .addPart(createPart(1, { geometries: [geometry], nodePositions: geometry.positions }))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        { kind: "part", partId: 1, transform: translation(0, 0, 0) },
        { kind: "part", partId: 1, transform: translation(2, 0, 0) },
        { kind: "part", partId: 1, transform: translation(4, 0, 0) },
      ],
    })
    .withRoot(1)
    .build();
}

/** Shared renderer test helper. */
export function buildPointScene(): Scene {
  const geometry = {
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint32Array([0]),
    primitive: "points" as const,
  };
  return createScene()
    .addPart(createPart(1, { geometries: [geometry] }))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

/** Shared renderer test helper. */
export function buildVariantScene(
  parts: readonly ReturnType<typeof createPart>[],
  bindings: readonly { readonly placementId: string; readonly partId: number }[],
): Scene {
  const builder = createScene();
  for (const part of parts) builder.addPart(part);
  return builder
    .addAssembly({
      id: 1,
      name: "root",
      placements: bindings.map(({ placementId, partId }, index) => ({
        kind: "part" as const,
        placementId,
        partId,
        transform: translation(index, 0, 0),
      })),
    })
    .withRoot(1)
    .build();
}

/** Shared renderer test helper. */
export function buildSectionScene(): Scene {
  const model = createElementModel(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    [createElement(7, TET4_SHAPE, [0, 1, 2, 3])],
  );
  const part = elementPart(1, model);
  return createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: part.id, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

/** Shared renderer test helper. */
export function buildFaceScene(): Scene {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const geometry = {
    positions,
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
    nodePositions: positions,
    faces: [
      {
        elementId: 0,
        faceIndex: 0,
        primitiveStart: 0,
        primitiveCount: 1,
        key: "0:1:2",
        nodeIds: [0, 1, 2],
      },
    ],
    edges: [
      {
        key: "0,1",
        nodeIds: [0, 1],
        incidentElementIds: [0],
        faceRefs: [{ elementId: 0, faceIndex: 0 }],
      },
      {
        key: "0,2",
        nodeIds: [0, 2],
        incidentElementIds: [0],
        faceRefs: [{ elementId: 0, faceIndex: 0 }],
      },
      {
        key: "1,2",
        nodeIds: [1, 2],
        incidentElementIds: [0],
        faceRefs: [{ elementId: 0, faceIndex: 0 }],
      },
    ],
    elements: [
      {
        id: 0,
        primitiveRanges: [
          { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
        ],
      },
    ],
  };
  const { elements, nodePositions, ...localGeometry } = geometry;
  return createScene()
    .addPart(createPart(1, { geometries: [localGeometry], elements, nodePositions }))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

/** Shared renderer test helper. */
export function buildBodyScene(): Scene {
  const geometry = {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
    elements: [
      {
        id: 0,
        primitiveRanges: [
          { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
        ],
        bodyId: 3,
      },
    ],
    bodies: [{ id: 3, name: "body", elementIds: [0] }],
  };
  const { elements, bodies, ...localGeometry } = geometry;
  return createScene()
    .addPart(createPart(1, { geometries: [localGeometry], elements, bodies }))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

/** Shared renderer test helper. */
export function buildSelectablePart(
  elementRanges: readonly (readonly [number, number])[],
): ReturnType<typeof createPart> {
  const primitiveCount = elementRanges.reduce(
    (end, [primitiveStart, primitiveCount]) => Math.max(end, primitiveStart + primitiveCount),
    0,
  );
  return createPart(1, {
    geometries: [
      {
        positions: new Float32Array(primitiveCount * 9),
        indices: Uint32Array.from({ length: primitiveCount * 3 }, (_, index) => index),
        primitive: "triangles",
      },
    ],
    elements: elementRanges.map(([primitiveStart, primitiveCount], index) => ({
      id: 101 + index,
      primitiveRanges: [{ primitive: "triangles", primitiveStart, primitiveCount }],
    })),
  });
}

/** Shared renderer test helper. */
export function buildSubsetPart(): ReturnType<typeof createPart> {
  return createPart(1, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]),
        indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
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
    ],
  });
}

export const camera: Camera = {
  mode: "perspective",
  position: [3, 3, 5],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fovY: Math.PI / 3,
  near: 0.01,
  far: 100,
  orthoHeight: 6,
  width: 800,
  height: 600,
};

/** Shared renderer test helper. */
export function uniformWrite(gpu: ReturnType<typeof fakeGpuDevice>) {
  const buffer = gpu.buffers.find(
    (candidate) => candidate.size === 16 && (candidate.usage & 1) !== 0,
  );
  return gpu.writes.find((write) => write.buffer === buffer?.resource);
}

export {
  createWebGpuRenderer,
  readGpuCostSnapshot,
  createGpuBundle,
  destroyGpuBundle,
  RendererAttachment,
  uploadPart,
  createPart,
  createElement,
  createElementModel,
  TET4_SHAPE,
  elementPart,
  createPackedSceneRuntime,
  createInteractionState,
  setElementOverride,
  setElementSelected,
  setInstanceOverride,
  setInstanceSelected,
  setPartOverride,
  setBodyHighlighted,
  setBodyOverride,
  setBodySelected,
  setBodyVisible,
  setElementVisible,
  setNodeSelected,
  setTargetHovered,
  createScene,
  type Scene,
  identity,
  translation,
  projectPoint,
  unprojectPoint,
  type Camera,
  zoomCamera,
  fakeCanvas,
  fakeGpuDevice,
  installFreshDeviceNavigator,
  installGpuGlobals,
};

/** Shared renderer test helper. */
export function installGpuTestGlobals() {
  restoreGpuGlobals = installGpuGlobals();
}
