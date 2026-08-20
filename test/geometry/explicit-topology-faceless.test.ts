import { describe, expect, it } from "vitest";
import { interactionTargetFromHit } from "../../src/interaction/targets";
import {
  createPartFromExplicitTopology,
  ExplicitTopologyError,
  type ExplicitTopologyInput,
} from "../../src/entries/model";
import { partSemanticGraph } from "../../src/geometry/semantic/part-semantic-graph";
import type { Geometry } from "../../src/geometry/part";
import { identityMatrix } from "../../src/math/mat4";
import { resolvePickHit, type PickContext, type ResolvedPickIds } from "../../src/picking/pick";
import { buildFacePrimitivePickIds } from "../../src/renderer/picking/ids";
import { buildNodeSpritePickIds } from "../../src/renderer/picking/node-topology";
import { deformGeometry } from "../../src/results/deform";
import { createResultField } from "../../src/results/fields";
import type { PartOccurrence } from "../../src/scene/types";

function facelessMixedInput(positions: ArrayLike<number>): ExplicitTopologyInput {
  return {
    positions,
    facets: { connectivity: [3, 0, 1, 2], elementIds: [100] },
    lines: { connectivity: [2, 2, 3], elementIds: [101] },
    points: { nodeIds: [4], elementIds: [102] },
    bodies: [{ id: 7, name: "shell", elementIds: [100, 101, 102] }],
  };
}

function geometry<P extends Geometry["primitive"]>(
  part: ReturnType<typeof createPartFromExplicitTopology>,
  primitive: P,
): Extract<Geometry, { readonly primitive: P }> {
  const candidate = part.geometries.find((value) => value.primitive === primitive);
  if (candidate === undefined || candidate.primitive !== primitive) {
    throw new Error(`Expected ${primitive} geometry`);
  }
  return candidate as Extract<Geometry, { readonly primitive: P }>;
}

function context(part: ReturnType<typeof createPartFromExplicitTopology>): PickContext {
  const occurrence: PartOccurrence = {
    partOccurrenceId: "7/0",
    partId: part.id,
    worldTransform: identityMatrix(),
  };
  return { instances: [occurrence], parts: new Map([[part.id, part]]) };
}

function ids(partial: Partial<ResolvedPickIds>): ResolvedPickIds {
  return { instancePickId: 1, elementPickId: 0, facePickId: 0, nodePickId: 0, ...partial };
}

describe("faceless explicit topology", () => {
  it("shares one copied node table across mixed primitive leaves without face storage", () => {
    const source = new Float64Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0, 1, 1, 1, 100, 100, 100]);
    const part = createPartFromExplicitTopology(7, facelessMixedInput(source));
    source[0] = 50;
    const triangles = geometry(part, "triangles");
    const lines = geometry(part, "lines");
    const points = geometry(part, "points");
    const graph = partSemanticGraph(part);

    expect(triangles.positions).toBe(part.nodePositions);
    expect(lines.positions).toBe(part.nodePositions);
    expect(points.positions).toBe(part.nodePositions);
    expect(triangles.nodePickIds).toBe(lines.nodePickIds);
    expect(lines.nodePickIds).toBe(points.nodePickIds);
    expect(triangles.nodePickIds).toEqual(new Uint32Array([1, 2, 3, 4, 5, 0]));
    expect(triangles.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(lines.indices).toEqual(new Uint32Array([2, 3]));
    expect(points.indices).toEqual(new Uint32Array([4]));
    expect(part.nodePositions?.[0]).toBe(0);
    expect(part.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 1 });
    expect(triangles.faces).toBeUndefined();
    expect(triangles.edges).toBeUndefined();
    expect(graph?.faceIndices).toHaveLength(0);
    expect(graph?.faceNodeIds).toHaveLength(0);
    expect(graph?.edgeGeometryOrdinals).toEqual(new Uint8Array([1]));
    expect(part.bodies?.get(7)?.elementIds).toEqual([100, 101, 102]);
    expect(buildNodeSpritePickIds(part)).toEqual(new Uint32Array([1, 2, 3, 4]));
  });

  it("keeps element and node picks truthful while leaving face picks unavailable", () => {
    const part = createPartFromExplicitTopology(
      7,
      facelessMixedInput([0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0, 1, 1, 1]),
    );
    const triangles = geometry(part, "triangles");
    const hit = resolvePickHit(
      context(part),
      ids({ elementPickId: 102, nodePickId: 4 }),
      [1, 1, 0],
    );

    expect(buildFacePrimitivePickIds(triangles)).toEqual(new Uint32Array([0]));
    expect(partSemanticGraph(part)?.faceIndices).toHaveLength(0);
    expect(hit).toMatchObject({ kind: "node", elementId: 101, nodeId: 3 });
    if (hit?.kind !== "node") throw new Error("Expected a node hit");
    expect(hit.neighborElementIds).toEqual([]);
    expect(hit.neighborNodeIds).toEqual([]);
    expect(interactionTargetFromHit(hit, "element")).toEqual({
      kind: "element",
      partOccurrenceId: "7/0",
      elementId: 101,
    });
    expect(interactionTargetFromHit(hit, "face")).toBeUndefined();
  });

  it("deforms every shared faceless geometry through its nodal field", () => {
    const part = createPartFromExplicitTopology(
      7,
      facelessMixedInput([0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0, 1, 1, 1, 100, 100, 100]),
    );
    const displacement = createResultField({
      id: "u",
      name: "displacement",
      location: "nodal",
      shape: "vector",
      count: 5,
      unit: "mm",
      values: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0.5, 0, 0, 0, 1, -1, 0, 0]),
    });
    const expected = [0, 0, 0, 3, 0, 0, 0, 2.5, 0, 2, 2, 1, 0, 1, 1, 100, 100, 100];

    for (const primitive of ["triangles", "lines", "points"] as const) {
      const source = geometry(part, primitive);
      const deformed = deformGeometry(source, displacement);
      expect(Array.from(deformed.positions)).toEqual(expected);
      expect(deformed.indices).toBe(source.indices);
    }
  });

  it("rejects neighbor records when facets omit face identity", () => {
    const input = {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      facets: { connectivity: [3, 0, 1, 2], elementIds: [1], neighbors: [0] },
    } as unknown as ExplicitTopologyInput;

    expect(() => createPartFromExplicitTopology(1, input)).toThrow(ExplicitTopologyError);
    try {
      createPartFromExplicitTopology(1, input);
    } catch (error) {
      expect((error as ExplicitTopologyError).code).toBe("face-identity-required");
    }
  });
});
