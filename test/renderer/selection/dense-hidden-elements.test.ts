import { describe, expect, it } from "vitest";
import { setElementVisible } from "@/interaction/elements";
import { createInteractionState } from "@/interaction/interaction";
import { buildPackedNodeTopologyData } from "@/renderer/picking/node-topology";
import { buildMeshEdgeData } from "@/renderer/edges/mesh-edge";
import {
  collectDenseHiddenElements,
  denseSelectionContains,
  type DenseElementSelection,
} from "@/renderer/selection/element-selection";
import { collectEmphasisUpdates } from "@/renderer/resources/element-resources";
import type { MeshEdgeData } from "@/renderer/edges/mesh-edge";
import {
  denseHidden,
  hexPairsPart,
  ordinalForPickId,
  placedPart,
  tetAndHexPart,
  tetPairsPart,
  uploadedTopology,
} from "./dense-hidden-elements-fixture";

describe("dense hidden elements", () => {
  it("packs non-contiguous Tet4 and Hex8 ids by ordinal without sparse hidden records", () => {
    const part = tetAndHexPart();
    const { runtime, layout, partOccurrenceId } = placedPart(part);
    let interaction = createInteractionState();
    interaction = setElementVisible(interaction, { partOccurrenceId, elementId: 101 }, false);
    interaction = setElementVisible(interaction, { partOccurrenceId, elementId: 90_001 }, false);
    const parts = new Map([[part.id, part]]);
    const hidden = collectDenseHiddenElements(runtime, layout, parts, interaction).get(part.id);
    if (hidden === undefined) throw new Error("Broad hidden elements did not use dense membership");

    expect(hidden.occurrences).toHaveLength(1);
    expect(denseSelectionContains(hidden, 0, 1)).toBe(true);
    expect(denseSelectionContains(hidden, 0, 2)).toBe(true);
    expect(
      collectEmphasisUpdates(runtime, layout, new Map([[partOccurrenceId, 0]]), {
        parts,
        interaction,
        denseHidden: new Map([[part.id, hidden]]),
      }).get(part.id),
    ).toBeUndefined();

    const topology = buildPackedNodeTopologyData(part);
    const conditions = topology[2] ?? 0;
    const ordinalOffset = 4 + (topology[0] ?? 0) * 5 + (topology[1] ?? 0) * 2 + conditions * 4;
    expect(
      new Set(topology.slice(ordinalOffset, ordinalOffset + conditions * 2).filter(Boolean)),
    ).toEqual(new Set([1, 2]));
  });

  it.each([
    ["Tet4", tetPairsPart],
    ["Hex8", hexPairsPart],
  ] as const)(
    "keeps %s interior faces, edges, and nodes correct on the full topology path",
    (_shape, makePart) => {
      const part = makePart();
      const { runtime, layout, partOccurrenceId } = placedPart(part);
      let interaction = createInteractionState();
      interaction = setElementVisible(interaction, { partOccurrenceId, elementId: 101 }, false);
      const hidden = collectDenseHiddenElements(
        runtime,
        layout,
        new Map([[part.id, part]]),
        interaction,
      ).get(part.id);
      if (hidden === undefined) throw new Error("Hidden owner did not use dense membership");

      const topology = uploadedTopology(part);
      expect(topology[4]).toBeGreaterThan(0);
      const visible = visibleFullTopologyPrimitives(topology, hidden);
      const interfaceTriangleCount = _shape === "Tet4" ? 1 : 2;
      expect(visible).toHaveLength(_shape === "Tet4" ? 10 : 32);
      expect(visible.filter((primitive) => primitive.neighborOrdinal === 1)).toHaveLength(
        interfaceTriangleCount,
      );
      expect(visible.filter((primitive) => primitive.neighborOrdinal === 4)).toHaveLength(0);
      expect(visibleOwnerCount(topology, hidden)).toBe(_shape === "Tet4" ? 12 : 36);

      const triangle = part.geometries.find((geometry) => geometry.primitive === "triangles");
      if (triangle?.primitive !== "triangles") throw new Error("Solid fixture lacks triangles");
      const edges = buildMeshEdgeData(triangle, triangle.indices, part.elements);
      const [sharedEdge, sharedCondition] = edgeWithOwners(edges, 102, 90_002);
      expect(edgeVisible(edges, sharedEdge, hidden)).toBe(true);
      expect(edgeConditionAnyOwnerVisible(edges, sharedCondition, hidden)).toBe(true);
      expect(edgeConditionSurfaceVisible(edges, sharedCondition, hidden)).toBe(false);
      expect(edgeVisible(edges, sharedEdge, denseHidden(1, 2))).toBe(false);
      expect(edgeVisible(edges, sharedEdge, denseHidden())).toBe(true);

      const nodes = buildPackedNodeTopologyData(part);
      const sharedNode = _shape === "Tet4" ? 0 : 1;
      expect(nodeVisible(nodes, sharedNode, hidden)).toBe(true);
      expect(nodeVisible(nodes, sharedNode, denseHidden(1, 2))).toBe(false);
      expect(nodeVisible(nodes, sharedNode, denseHidden())).toBe(true);
    },
  );
});

function visibleFullTopologyPrimitives(data: Uint32Array, hidden: DenseElementSelection) {
  const faceCount = data[0] ?? 0;
  const rangeCount = data[1] ?? 0;
  const conditionCount = data[2] ?? 0;
  const ordinalCount = data[3] ?? 0;
  const neighborCount = data[4] ?? 0;
  const faceOffset = 5;
  const ordinalOffset = faceOffset + faceCount * 5 + rangeCount * 2 + conditionCount * 6;
  const visible: Array<{ readonly primitive: number; readonly neighborOrdinal: number }> = [];
  for (let primitive = 0; primitive < ordinalCount; primitive += 1) {
    const ownerPickId = data[faceOffset + primitive * 5 + 3] ?? 0;
    const neighborPickId = data[faceOffset + primitive * 5 + 4] ?? 0;
    const ownerOrdinal = data[ordinalOffset + primitive] ?? 0;
    const neighborOrdinal =
      neighborCount === 0 ? 0 : (data[ordinalOffset + ordinalCount + primitive] ?? 0);
    if (
      ownerPickId !== 0 &&
      !denseSelectionContains(hidden, 0, ownerOrdinal) &&
      (neighborPickId === 0 || denseSelectionContains(hidden, 0, neighborOrdinal))
    ) {
      visible.push({ primitive, neighborOrdinal });
    }
  }
  return visible;
}

function visibleOwnerCount(data: Uint32Array, hidden: DenseElementSelection): number {
  const faceCount = data[0] ?? 0;
  const rangeCount = data[1] ?? 0;
  const conditionCount = data[2] ?? 0;
  const ordinalCount = data[3] ?? 0;
  const faceOffset = 5;
  const ordinalOffset = faceOffset + faceCount * 5 + rangeCount * 2 + conditionCount * 6;
  let visible = 0;
  for (let primitive = 0; primitive < ordinalCount; primitive += 1) {
    const ownerPickId = data[faceOffset + primitive * 5 + 3] ?? 0;
    const ownerOrdinal = data[ordinalOffset + primitive] ?? 0;
    if (ownerPickId !== 0 && !denseSelectionContains(hidden, 0, ownerOrdinal)) visible += 1;
  }
  return visible;
}

function edgeWithOwners(
  edges: MeshEdgeData,
  first: number,
  second: number,
): readonly [number, number] {
  for (let edge = 0; edge < edges.bodyRanges.length / 2; edge += 1) {
    const start = edges.bodyRanges[edge * 2] ?? 0;
    const count = edges.bodyRanges[edge * 2 + 1] ?? 0;
    for (let condition = start; condition < start + count; condition += 1) {
      const owner = edges.elementIds[condition * 2] ?? 0;
      const neighbor = edges.elementIds[condition * 2 + 1] ?? 0;
      if (owner === first && neighbor === second) {
        return [edge, condition];
      }
    }
  }
  throw new Error("Shared authored edge is missing both owners");
}

function edgeVisible(edges: MeshEdgeData, edge: number, hidden: DenseElementSelection): boolean {
  const start = edges.bodyRanges[edge * 2] ?? 0;
  const count = edges.bodyRanges[edge * 2 + 1] ?? 0;
  for (let condition = start; condition < start + count; condition += 1) {
    const owner = ordinalForPickId(edges.elementIds[condition * 2] ?? 0);
    const neighbor = ordinalForPickId(edges.elementIds[condition * 2 + 1] ?? 0);
    const ownerVisible = owner !== 0 && !denseSelectionContains(hidden, 0, owner);
    const neighborVisible = neighbor !== 0 && !denseSelectionContains(hidden, 0, neighbor);
    if (ownerVisible || neighborVisible) {
      return true;
    }
  }
  return false;
}

function edgeConditionAnyOwnerVisible(
  edges: MeshEdgeData,
  condition: number,
  hidden: DenseElementSelection,
): boolean {
  const owner = ordinalForPickId(edges.elementIds[condition * 2] ?? 0);
  const neighbor = ordinalForPickId(edges.elementIds[condition * 2 + 1] ?? 0);
  return (
    (owner !== 0 && !denseSelectionContains(hidden, 0, owner)) ||
    (neighbor !== 0 && !denseSelectionContains(hidden, 0, neighbor))
  );
}

function edgeConditionSurfaceVisible(
  edges: MeshEdgeData,
  condition: number,
  hidden: DenseElementSelection,
): boolean {
  const owner = ordinalForPickId(edges.elementIds[condition * 2] ?? 0);
  const neighbor = ordinalForPickId(edges.elementIds[condition * 2 + 1] ?? 0);
  return (
    owner !== 0 &&
    !denseSelectionContains(hidden, 0, owner) &&
    (neighbor === 0 || denseSelectionContains(hidden, 0, neighbor))
  );
}

function nodeVisible(data: Uint32Array, node: number, hidden: DenseElementSelection): boolean {
  const faceCount = data[0] ?? 0;
  const rangeCount = data[1] ?? 0;
  const conditionCount = data[2] ?? 0;
  const rangeOffset = 5 + faceCount * 5;
  const start = data[rangeOffset + node * 2] ?? 0;
  const count = data[rangeOffset + node * 2 + 1] ?? 0;
  const ordinalOffset = rangeOffset + rangeCount * 2 + conditionCount * 4;
  for (let condition = start; condition < start + count; condition += 1) {
    const owner = data[ordinalOffset + condition * 2] ?? 0;
    const neighbor = data[ordinalOffset + condition * 2 + 1] ?? 0;
    if (
      (owner !== 0 && !denseSelectionContains(hidden, 0, owner)) ||
      (neighbor !== 0 && !denseSelectionContains(hidden, 0, neighbor))
    ) {
      return true;
    }
  }
  return false;
}
