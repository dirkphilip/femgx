import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import type { Part, PartId } from "../../src/geometry/part";
import type { InteractionState } from "../../src/interaction/interaction";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { buildSelectionDrawCalls } from "../../src/renderer/selection/draw-ranges";
import type { DenseElementSelections } from "../../src/renderer/selection/element-selection";
import type { InstanceLayout } from "../../src/renderer/runtime-state";

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
  let iterations = 0;
  const countedFaces = new Proxy(triangles.faces, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) iterations += 1;
      const value: unknown = Reflect.get(target, property, receiver);
      return value;
    },
  });
  const countedPart: Part = {
    ...options.part,
    geometries: options.part.geometries.map((geometry) =>
      geometry === triangles ? { ...geometry, faces: countedFaces } : geometry,
    ),
  };
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
