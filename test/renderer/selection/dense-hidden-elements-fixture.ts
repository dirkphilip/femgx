import { createElement } from "@/elements/element";
import { createElementModel } from "@/elements/model";
import { ElementShape } from "@/elements/shapes";
import { createPartFromElementModel } from "@/geometry/element-model-part";
import type { Part } from "@/geometry/part";
import { identityMatrix } from "@/math/mat4";
import { createDrawResources, uploadPart } from "@/renderer/resources/draw-resources";
import type { DenseElementSelection } from "@/renderer/selection/element-selection";
import { buildInstanceLayout } from "@/renderer/runtime-state";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

/** Creates disjoint Tet4 and Hex8 elements with non-contiguous authored ids. */
export function tetAndHexPart(): Part {
  const tetNodes = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const hexNodes = [3, 0, 0, 4, 0, 0, 4, 1, 0, 3, 1, 0, 3, 0, 1, 4, 0, 1, 4, 1, 1, 3, 1, 1];
  return createPartFromElementModel(
    7,
    createElementModel(
      [...tetNodes, ...hexNodes],
      [
        createElement(101, ElementShape.Tet4, [0, 1, 2, 3]),
        createElement(90_001, ElementShape.Hex8, [4, 5, 6, 7, 8, 9, 10, 11]),
      ],
    ),
  );
}

/** Places one part and returns its runtime coordinates. */
export function placedPart(part: Part) {
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: part.id, transform: identityMatrix() }],
    })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const partOccurrenceId = runtime.getInstanceId(0);
  if (partOccurrenceId === undefined) throw new Error("Fixture has no part occurrence");
  return { runtime, layout: buildInstanceLayout(runtime), partOccurrenceId };
}

/** Returns the packed full-surface topology uploaded for a part. */
export function uploadedTopology(part: Part): Uint32Array {
  const restore = installGpuGlobals();
  try {
    const gpu = fakeGpuDevice();
    const resource = uploadPart(createDrawResources(gpu.device), part);
    return uploadedData(gpu.writes, resource.facePickIdsBuffer);
  } finally {
    restore();
  }
}

/** Builds one dense hidden-membership record for the four-element fixtures. */
export function denseHidden(...ordinals: readonly number[]): DenseElementSelection {
  let words = 0;
  for (const ordinal of ordinals) words |= 1 << (ordinal - 1);
  return {
    elementCount: 4,
    occurrences: [{ slot: 0, selectedCount: ordinals.length, words: new Uint32Array([words]) }],
  };
}

/** Maps the fixtures' element pick ids to their ordinal. */
export function ordinalForPickId(pickId: number): number {
  if (pickId === 102) return 1;
  if (pickId === 90_002) return 2;
  if (pickId === 302) return 3;
  return pickId === 90_004 ? 4 : 0;
}

/** Creates two adjacent Tet4 pairs, including an unrelated visible pair. */
export function tetPairsPart(): Part {
  const nodes = [...tetPairNodes(0), ...tetPairNodes(4)];
  return solidPart(nodes, [...tetPairElements(0, 101, 90_001), ...tetPairElements(5, 301, 90_003)]);
}

/** Creates two adjacent Hex8 pairs, including an unrelated visible pair. */
export function hexPairsPart(): Part {
  const nodes = [...hexPairNodes(0), ...hexPairNodes(4)];
  return solidPart(nodes, [
    ...hexPairElements(0, 101, 90_001),
    ...hexPairElements(12, 301, 90_003),
  ]);
}

function uploadedData(
  writes: readonly { readonly buffer: GPUBuffer; readonly bytes: Uint8Array }[],
  buffer: GPUBuffer,
): Uint32Array {
  const write = writes.find((entry) => entry.buffer === buffer);
  if (write === undefined) throw new Error("Topology upload is missing");
  return new Uint32Array(write.bytes.buffer.slice(write.bytes.byteOffset, write.bytes.byteLength));
}

function tetPairNodes(x: number): readonly number[] {
  return [x, 0, 0, x + 1, 0, 0, x, 1, 0, x, 0, 1, x, 0, -1];
}

function tetPairElements(offset: number, first: number, second: number) {
  return [
    createElement(first, ElementShape.Tet4, [offset, offset + 1, offset + 2, offset + 3]),
    createElement(second, ElementShape.Tet4, [offset, offset + 1, offset + 2, offset + 4]),
  ];
}

function hexPairNodes(x: number): readonly number[] {
  return [
    x,
    0,
    0,
    x + 1,
    0,
    0,
    x + 1,
    1,
    0,
    x,
    1,
    0,
    x,
    0,
    1,
    x + 1,
    0,
    1,
    x + 1,
    1,
    1,
    x,
    1,
    1,
    x + 2,
    0,
    0,
    x + 2,
    1,
    0,
    x + 2,
    0,
    1,
    x + 2,
    1,
    1,
  ];
}

function hexPairElements(offset: number, first: number, second: number) {
  return [
    createElement(first, ElementShape.Hex8, [
      offset,
      offset + 1,
      offset + 2,
      offset + 3,
      offset + 4,
      offset + 5,
      offset + 6,
      offset + 7,
    ]),
    createElement(second, ElementShape.Hex8, [
      offset + 1,
      offset + 8,
      offset + 9,
      offset + 2,
      offset + 5,
      offset + 10,
      offset + 11,
      offset + 6,
    ]),
  ];
}

function solidPart(nodes: readonly number[], elements: ReturnType<typeof createElement>[]): Part {
  return createPartFromElementModel(7, createElementModel(nodes, elements));
}
