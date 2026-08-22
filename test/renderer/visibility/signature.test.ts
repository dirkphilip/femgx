import { describe, expect, it } from "vitest";
import type {
  PartGeometrySemantic,
  PartSemanticGraph,
} from "@/geometry/semantic/part-semantic-graph";
import { setBodyVisible } from "@/interaction/bodies";
import { setElementVisible } from "@/interaction/elements";
import { createInteractionState } from "@/interaction/interaction";
import { buildGraphVisibilitySkinIndices } from "@/renderer/visibility/graph-skin";
import { buildVisibilityTriangleIndices } from "@/renderer/visibility/skin-indices";
import { visibilitySignature } from "@/renderer/visibility/signature";

describe("visibility signatures and skin construction", () => {
  it("keeps arbitrary generic ids exact and bounds boxed index growth", () => {
    const ids = Array.from({ length: 40 }, (_, index) => 2 ** 32 + 1 + index * 17);
    let interaction = createInteractionState();
    for (const elementId of ids.slice(0, 20)) {
      interaction = setElementVisible(
        interaction,
        { partOccurrenceId: "generic", elementId },
        false,
      );
    }
    interaction = setElementVisible(
      interaction,
      { partOccurrenceId: "generic", elementId: 999 },
      false,
    );
    interaction = setBodyVisible(interaction, { partOccurrenceId: "generic", bodyId: 7 }, false);
    const signature = visibilitySignature("generic", interaction, {
      element: (id) =>
        ids.includes(id)
          ? {
              id,
              primitiveRanges: [
                { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
              ],
            }
          : undefined,
      hasElement: (id) => ids.includes(id),
      elementOrdinalCount: ids.length,
      elementOrdinal: (id) => {
        const index = ids.indexOf(id);
        return index < 0 ? undefined : index + 1;
      },
      hasKnownBody: (id) => id === 7,
      supportsOrdinalWords: false,
    });
    expect(signature.elementIds).toEqual(ids.slice(0, 20));
    expect(signature.elementWords).toBeUndefined();
    expect(signature.bodyIds).toEqual([7]);

    const targets: string[] = [];
    buildVisibilityTriangleIndices(65_537, (target) => {
      targets.push(target === undefined ? "count" : target.constructor.name);
      return 3;
    });
    buildVisibilityTriangleIndices(6, (target) => {
      targets.push(target === undefined ? "count" : target.constructor.name);
      return 3;
    });
    expect(targets).toEqual(["count", "Uint32Array", "Array"]);
  });

  it("keeps dense owner-neighbor orientation, body, and invalid-bit parity", () => {
    const graph = {
      elementIds: new Uint32Array([10, 20]),
      elementBodyIds: new Uint32Array([1, 2]),
      faceBodyIds: new Uint32Array([1, 2]),
      faceGeometryOffsets: new Uint32Array([0, 2]),
      faceOwnerElementOrdinals: new Uint32Array([0, 1]),
      faceNeighborElementOrdinals: new Uint32Array([2, 0]),
      facePrimitiveStarts: new Uint32Array([0, 1]),
      facePrimitiveCounts: new Uint32Array([1, 1]),
    } as unknown as PartSemanticGraph;
    const semantic = { graph, geometryOrdinal: 0 } satisfies PartGeometrySemantic;
    const skin = (bodyIds: number[], elementIds: number[], words?: Uint32Array) =>
      buildGraphVisibilitySkinIndices(
        semantic,
        {
          hash: 1,
          bodyIds,
          elementIds,
          ...(words === undefined ? {} : { elementWords: words }),
          hasHidden: true,
        },
        6,
      );

    expect(skin([], [20], new Uint32Array([0b10]))).toEqual(new Uint32Array([0, 1, 2]));
    expect(skin([], [10], new Uint32Array([0b01]))).toEqual(new Uint32Array([3, 4, 5]));
    expect(skin([1], [])).toEqual(new Uint32Array([3, 4, 5]));
    expect(skin([], [999], new Uint32Array([1 << 31]))).toEqual(new Uint32Array([3, 4, 5]));
  });
});
