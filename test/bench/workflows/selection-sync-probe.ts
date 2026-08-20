import { getPartSemanticIndex } from "../../../src/geometry/part-semantic-index";
import type { Part, PartId } from "../../../src/geometry/part";
import type { GeometryFaces } from "../../../src/geometry/types";
import type { InteractionState } from "../../../src/interaction/interaction";
import type { PackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { buildSelectionDrawCalls } from "../../../src/renderer/selection/draw-ranges";
import type { DenseElementSelections } from "../../../src/renderer/selection/element-selection";
import type { InstanceLayout } from "../../../src/renderer/runtime-state";
import {
  partSemanticGraph,
  registerPartSemanticGraph,
} from "../../../src/geometry/semantic/part-semantic-graph";

/** Counts authored face descriptors read by the dense neighbor-CSR path. */
export function countDenseSkinNeighborFaceEntries(options: {
  readonly part: Part;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly partId: PartId;
  readonly interaction: InteractionState;
  readonly order: Uint32Array;
  readonly denseSelections: DenseElementSelections;
}): number {
  const triangles = options.part.geometries.find((geometry) => geometry.primitive === "triangles");
  if (triangles?.primitive !== "triangles" || triangles.faces === undefined) return 0;
  const graph = partSemanticGraph(options.part);
  if (graph === undefined) return 0;
  let iterations = 0;
  const sourceFaces = triangles.faces;
  const countedFaces: GeometryFaces = {
    get count() {
      return sourceFaces.count;
    },
    get: (elementId, faceIndex) => sourceFaces.get(elementId, faceIndex),
    at: (ordinal) => {
      iterations += 1;
      return sourceFaces.at(ordinal);
    },
    entries: () => sourceFaces.entries(),
    [Symbol.iterator]: () => sourceFaces[Symbol.iterator](),
  };
  const countedPart: Part = {
    ...options.part,
    geometries: options.part.geometries.map((geometry) =>
      geometry === triangles ? { ...geometry, faces: countedFaces } : geometry,
    ),
  };
  registerPartSemanticGraph(countedPart, graph);
  getPartSemanticIndex(countedPart);
  iterations = 0;
  buildSelectionDrawCalls({
    layout: options.layout,
    runtime: options.runtime,
    partId: options.partId,
    interaction: options.interaction,
    part: countedPart,
    order: options.order,
    denseSelections: options.denseSelections,
  });
  return iterations;
}
