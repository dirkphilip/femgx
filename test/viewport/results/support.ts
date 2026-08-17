import { afterEach } from "vitest";

import { createElement } from "../../../src/elements/element";

import { createElementModel } from "../../../src/elements/model";

import { HEX20_SHAPE } from "../../../src/elements/shapes";

import { elementPart } from "../../../src/geometry/element-part";

import { createPart } from "../../../src/geometry/part";

import { createInteractionState, setPartOverride } from "../../../src/interaction/interaction";

import { readInteractionState } from "../../../src/interaction/state";

import { identity, scale } from "../../../src/math/mat4";

import { GpuRenderer } from "../../../src/renderer/renderer-core";

import { createResultField } from "../../../src/results/fields";

import { createScene } from "../../../src/scene/scene";

import { createViewport } from "../../../src/viewport/viewport";

import type { ViewportResultsConfig } from "../../../src/viewport/results";

import {
  applyViewportResultInteraction,
  resolveViewportResults,
  viewportOrientationRecords,
  viewportResultColors,
} from "../../../src/viewport/results";

import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";

export let restoreGpuGlobals: (() => void) | undefined;

export const originalNavigator = globalThis.navigator;

afterEach(() => {
  restoreGpuGlobals?.();
  restoreGpuGlobals = undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

/** Shared core test helper. */
export function installNavigator(): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
}

/** Shared core test helper. */
export function createTestScene(transform = identity()) {
  const geometry = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
    elements: [
      {
        id: 0,
        primitiveRanges: [
          { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
        ],
      },
    ],
    nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    nodePickIds: new Uint32Array([1, 2, 3]),
  };
  const { elements, nodePositions, ...localGeometry } = geometry;
  return createScene()
    .addPart(createPart(1, { geometries: [localGeometry], elements, nodePositions }))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform }],
    })
    .withRoot(1)
    .build();
}

/** Shared core test helper. */
export function createHex20ViewportScene() {
  const nodes = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
    [0.5, 0, 0],
    [1, 0.5, 0],
    [0.5, 1, 0],
    [0, 0.5, 0],
    [0.5, 0, 1],
    [1, 0.5, 1],
    [0.5, 1, 1],
    [0, 0.5, 1],
    [0, 0, 0.5],
    [1, 0, 0.5],
    [1, 1, 0.5],
    [0, 1, 0.5],
  ].flat();
  const model = createElementModel(nodes, [
    createElement(
      1,
      HEX20_SHAPE,
      Array.from({ length: 20 }, (_, index) => index),
    ),
  ]);
  const part = elementPart(7, model);
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 7,
      name: "hex20",
      placements: [{ kind: "part", partId: 7, transform: identity() }],
    })
    .withRoot(7)
    .build();
  return { model, scene, part };
}

/** Shared core test helper. */
export function elementalScalar() {
  return createResultField({
    id: "authored-stress",
    name: "Authored stress",
    location: "elemental",
    shape: "scalar",
    count: 1,
    unit: "MPa",
    values: new Float32Array([3]),
  });
}

/** Shared core test helper. */
export function elementalVector() {
  return createResultField({
    id: "authored-direction",
    name: "Authored direction",
    location: "elemental",
    shape: "vector",
    count: 1,
    unit: "source",
    values: new Float32Array([1, 0, 0]),
  });
}

/** Shared core test helper. */
export function nodalDisplacement() {
  return createResultField({
    id: "displacement",
    name: "Displacement",
    location: "nodal",
    shape: "vector",
    count: 3,
    unit: "mm",
    values: new Float32Array([0.1, 0, 0, 0, 0.2, 0, 0, 0, 0.3]),
  });
}

/** Shared core test helper. */
export function nodalScalar() {
  return createResultField({
    id: "temperature",
    name: "Temperature",
    location: "nodal",
    shape: "scalar",
    count: 3,
    unit: "C",
    values: new Float32Array([0, 5, 10]),
  });
}

/** Shared core test helper. */
export function installTestGpuGlobals(): void {
  restoreGpuGlobals = installGpuGlobals();
}

export {
  createElement,
  createElementModel,
  HEX20_SHAPE,
  elementPart,
  createPart,
  createInteractionState,
  setPartOverride,
  readInteractionState,
  identity,
  scale,
  GpuRenderer,
  createResultField,
  createScene,
  createViewport,
  type ViewportResultsConfig,
  applyViewportResultInteraction,
  resolveViewportResults,
  viewportOrientationRecords,
  viewportResultColors,
  fakeCanvas,
  fakeGpuDevice,
  installGpuGlobals,
};
