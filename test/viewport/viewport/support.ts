import { afterEach, vi } from "vitest";

import {
  createPart,
  type ElementTessellation,
  type GeometryInput,
  type GeometryBody,
  type Part,
} from "@/geometry/part";

import { createResultField } from "@/results/fields";

import { setBodyOverride, setBodyVisible } from "@/interaction/bodies";

import { setPartOverride } from "@/interaction/interaction";

import { isTargetSelected, setTargetSelected } from "@/interaction/targets";

import { translationMatrix } from "@/math/mat4";

import type { Placement } from "@/scene/assembly";

import { createSceneBuilder, type Scene } from "@/scene/scene";

import { createViewport } from "@/viewport/viewport";

import { RendererAttachment } from "@/renderer/attachment";

import { GpuRenderer } from "@/renderer/renderer-core";

import type { Viewport } from "@/viewport/types";

import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";

import * as geometryBounds from "@/viewport/geometry-bounds";

export let restoreGpuGlobals: (() => void) | undefined;

export const originalNavigator = globalThis.navigator;

export type SemanticGeometry = GeometryInput & {
  readonly elements?: readonly ElementTessellation[];
  readonly nodePositions?: Float32Array;
  readonly bodies?: readonly GeometryBody[];
};

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
export function wheelCanvas(): {
  readonly canvas: HTMLCanvasElement;
  readonly wheel: (deltaY: number) => void;
} {
  const canvas = fakeCanvas();
  let listener: ((event: WheelEvent) => void) | undefined;
  canvas.addEventListener = ((type: string, candidate: EventListenerOrEventListenerObject) => {
    if (type === "wheel") listener = candidate as (event: WheelEvent) => void;
  }) as typeof canvas.addEventListener;
  canvas.removeEventListener = ((type: string) => {
    if (type === "wheel") listener = undefined;
  }) as typeof canvas.removeEventListener;
  return {
    canvas,
    wheel: (deltaY) => {
      listener?.({ deltaY, preventDefault: vi.fn() } as unknown as WheelEvent);
    },
  };
}

/** Shared core test helper. */
export function latestCameraUniform(gpu: ReturnType<typeof fakeGpuDevice>): Float32Array {
  const cameraBuffer = gpu.buffers.find(
    (buffer) => buffer.size === 128 && (buffer.usage & 1) !== 0,
  );
  const write = gpu.writes.filter((entry) => entry.buffer === cameraBuffer?.resource).at(-1);
  if (write === undefined) throw new Error("camera uniform was not written");
  return new Float32Array(write.bytes.buffer, write.bytes.byteOffset, write.bytes.byteLength / 4);
}

/** Shared core test helper. */
export function latestSectionPlaneUniform(gpu: ReturnType<typeof fakeGpuDevice>): Float32Array {
  const write = gpu.writes
    .filter((entry) => gpu.buffers.find((buffer) => buffer.resource === entry.buffer)?.size === 16)
    .at(-1);
  if (write === undefined) throw new Error("section-plane uniform was not written");
  return new Float32Array(write.bytes.buffer, write.bytes.byteOffset, write.bytes.byteLength / 4);
}

/** Shared core test helper. */
export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

/** Shared core test helper. */
export class KeyboardTarget {
  private listener: ((event: Event) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown") this.listener = listener as (event: Event) => void;
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown" && this.listener === listener) this.listener = undefined;
  }

  dispatchEvent(_event: Event): boolean {
    return false;
  }

  dispatch(event: Event): void {
    this.listener?.(event);
  }
}

/** Shared core test helper. */
export function installTwoPhaseNavigator(first: GPUDevice, candidate: GPUDevice): () => void {
  const candidateRequest = deferred<GPUDevice>();
  let requestCount = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: () => {
          requestCount += 1;
          return Promise.resolve({
            requestDevice: () =>
              requestCount === 1 ? Promise.resolve(first) : candidateRequest.promise,
          });
        },
      },
    },
  });
  return () => {
    candidateRequest.resolve(candidate);
  };
}

/** Shared core test helper. */
export function scene(offset = 0) {
  const geometry = {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
  };
  return createSceneBuilder()
    .addPart(createPart(1, { geometries: [geometry] }))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        {
          kind: "part",
          placementId: "0",
          partId: 1,
          transform: translationMatrix(offset, 0, 0),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
}

/** Shared core test helper. */
export function explicitScene(parts: readonly Part[], placements: readonly Placement[]): Scene {
  let builder = createSceneBuilder();
  for (const part of parts) builder = builder.addPart(part);
  return builder
    .addAssembly({ id: 1, name: "explicit-root", placements })
    .setRootAssembly(1)
    .build();
}

/** Shared core test helper. */
export function invalidScene(): Scene {
  const current = scene();
  const root = current.assemblies.get(1);
  if (root === undefined) throw new Error("test root assembly is missing");
  return {
    ...current,
    assemblies: new Map([
      [
        1,
        {
          ...root,
          placements: [
            {
              kind: "part",
              placementId: "invalid-transform",
              partId: 1,
              transform: new Float32Array(15),
            },
          ],
        },
      ],
    ]),
  };
}

/** Shared core test helper. */
export function resultScene(nodeCount: 3 | 6): Scene {
  const positions = new Float32Array(
    nodeCount === 3
      ? [-1, -1, 0, 1, -1, 0, 0, 1, 0]
      : [-1, -1, 0, 1, -1, 0, 0, 1, 0, 2, -1, 0, 4, -1, 0, 3, 1, 0],
  );
  const indices =
    nodeCount === 3 ? new Uint32Array([0, 1, 2]) : new Uint32Array([0, 1, 2, 3, 4, 5]);
  return createSceneBuilder()
    .addPart(
      createPart(1, {
        geometries: [
          {
            positions,
            indices,
            primitive: "triangles",
            nodePickIds: new Uint32Array(
              Array.from({ length: nodeCount }, (_, index) => index + 1),
            ),
          },
        ],
      }),
    )
    .addAssembly({
      id: 1,
      name: "result-root",
      placements: [
        {
          kind: "part",
          placementId: "0",
          partId: 1,
          transform: translationMatrix(0, 0, 0),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
}

/** Shared core test helper. */
export function nodalResult(nodeCount: 3 | 6) {
  return {
    scalar: {
      field: createResultField({
        id: `scene-${nodeCount}-scalar`,
        name: "scene scalar",
        location: "nodal" as const,
        shape: "scalar" as const,
        count: nodeCount,
        unit: "source",
        values: new Float32Array(Array.from({ length: nodeCount }, (_, index) => index + 1)),
      }),
    },
  };
}

/** Shared core test helper. */
export function orientationResult() {
  return {
    orientation: {
      field: createResultField({
        id: "scene-orientation",
        name: "scene orientation",
        location: "elemental" as const,
        shape: "vector" as const,
        count: 11,
        unit: "unitless",
        values: new Float32Array(33).fill(1),
      }),
      glyph: "arrow" as const,
      transform: "direction" as const,
    },
  };
}

/** Shared core test helper. */
export function identityScene(withSecondElement: boolean): Scene {
  const geometry = withSecondElement ? twoElementGeometry() : oneElementGeometry();
  const { elements, nodePositions, bodies, ...localGeometry } = geometry;
  return explicitScene(
    [
      createPart(1, {
        geometries: [localGeometry],
        ...(elements === undefined ? {} : { elements }),
        ...(nodePositions === undefined ? {} : { nodePositions }),
        ...(bodies === undefined ? {} : { bodies }),
      }),
    ],
    [{ kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(0, 0, 0) }],
  );
}

function twoElementGeometry(): SemanticGeometry {
  return {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    primitive: "triangles",
    elements: [
      {
        id: 10,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        bodyId: 1,
      },
      {
        id: 11,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
        bodyId: 1,
      },
    ],
    faces: [
      {
        elementId: 10,
        faceIndex: 0,
        primitiveStart: 0,
        primitiveCount: 1,
        key: "0/1/2",
        nodeIds: [0, 1, 2],
        bodyId: 1,
      },
      {
        elementId: 11,
        faceIndex: 0,
        primitiveStart: 1,
        primitiveCount: 1,
        key: "0/2/3",
        nodeIds: [0, 2, 3],
        bodyId: 1,
      },
    ],
    nodePickIds: new Uint32Array([1, 2, 3, 4]),
    nodePositions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]),
    bodies: [{ id: 1, elementIds: [10, 11] }],
  };
}

function oneElementGeometry(): SemanticGeometry {
  return {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles",
    elements: [
      {
        id: 10,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
    ],
    faces: [
      {
        elementId: 10,
        faceIndex: 0,
        primitiveStart: 0,
        primitiveCount: 1,
        key: "0/1/2",
        nodeIds: [0, 1, 2],
      },
    ],
    nodePickIds: new Uint32Array([1, 2, 3]),
    nodePositions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
  };
}

/** Shared core test helper. */
export function installTestGpuGlobals(): void {
  restoreGpuGlobals = installGpuGlobals();
}

export {
  createPart,
  type ElementTessellation,
  type GeometryInput,
  type GeometryBody,
  type Part,
  createResultField,
  setBodyOverride,
  setBodyVisible,
  setPartOverride,
  isTargetSelected,
  setTargetSelected,
  translationMatrix,
  type Placement,
  createSceneBuilder,
  type Scene,
  createViewport,
  RendererAttachment,
  GpuRenderer,
  type Viewport,
  fakeCanvas,
  fakeGpuDevice,
  installGpuGlobals,
  geometryBounds,
};
