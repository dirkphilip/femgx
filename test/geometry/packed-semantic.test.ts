import { describe, expect, it } from "vitest";
import { ElementShape } from "../../src/elements/shapes";
import { createPackedPart } from "../../src/geometry/packed/create-packed-part";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import { buildElementSectionCap } from "../../src/geometry/section-cap";
import { identity } from "../../src/math/mat4";
import { displayedPartBounds, selectedGeometryBounds } from "../../src/viewport/geometry-bounds";
import { getOrientationTopology } from "../../src/results/orientation-topology";
import {
  packedSemanticMaterializationCounts,
  packedSemanticStorage,
  lazyPackedArray,
  type PackedSemanticStorage,
} from "../../src/geometry/packed/packed-semantic";
import { buildPrimitiveFaceBodyPickData } from "../../src/renderer/picking/ids";

describe("packed semantic boundary", () => {
  it("keeps arbitrary element ids on direct ordinal and face lookup paths", () => {
    const part = createPackedPart(1, {
      geometries: [triangleGeometry()],
      semantic: baseStorage(),
      nodePositions: nodePositions(),
    });
    const storage = packedSemanticStorage(part);
    if (storage === undefined) throw new Error("Packed storage is missing");
    const index = getPartSemanticIndex(part);
    expect(index.elementOrdinalById.get(20)).toBe(2);
    expect(index.faces.get("20/0")?.face.elementId).toBe(20);
    expect(packedSemanticMaterializationCounts(storage)).toEqual({
      elements: 0,
      faces: 1,
      edges: 0,
    });
  });

  it("preserves array and iterator behavior without filling a numeric cache", () => {
    const part = createPackedPart(1, {
      geometries: [triangleGeometry()],
      semantic: baseStorage(),
      nodePositions: nodePositions(),
    });
    const elements = part.elements;
    if (elements === undefined) throw new Error("Packed elements are missing");
    expect(Reflect.ownKeys(elements).slice(0, 3)).toEqual(["length", "0", "1"]);
    expect(Object.keys(elements)).toEqual(["0", "1"]);
    expect(elements.map((element) => element.id)).toEqual([10, 20]);
    expect([...elements].map((element) => element.id)).toEqual([10, 20]);
  });

  it("keeps lazy arrays sealable and freezable without violating proxy invariants", () => {
    const sealed = lazyPackedArray(2, (ordinal) => ordinal + 1);
    expect(() => Object.seal(sealed)).not.toThrow();
    expect(Object.isSealed(sealed)).toBe(true);
    expect([...sealed]).toEqual([1, 2]);
    const frozen = lazyPackedArray(2, (ordinal) => ordinal + 1);
    expect(() => Object.freeze(frozen)).not.toThrow();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen[1]).toBe(2);
  });

  it("derives a typed body column from body membership and validates conflicts", () => {
    const part = createPackedPart(1, {
      geometries: [triangleGeometry()],
      semantic: baseStorage(),
      nodePositions: nodePositions(),
      bodies: [{ id: 3, elementIds: [10, 20] }],
    });
    const storage = packedSemanticStorage(part);
    expect(storage?.elementBodyIds && Array.from(storage.elementBodyIds)).toEqual([3, 3]);
    expect(getPartSemanticIndex(part).bodyByElement.get(20)).toBe(3);
    expect(() =>
      createPackedPart(1, {
        geometries: [triangleGeometry()],
        semantic: { ...baseStorage(), elementBodyIds: Uint32Array.from([3, 3]) },
        nodePositions: nodePositions(),
        bodies: [{ id: 3, elementIds: [10] }],
      }),
    ).toThrow(/body membership/);
  });

  it("rejects malformed packed ranges, subsets, and edge columns", () => {
    expect(() =>
      createPackedPart(1, {
        geometries: [triangleGeometry()],
        semantic: { ...baseStorage(), elementPrimitiveCounts: Uint32Array.from([2, 1]) },
        nodePositions: nodePositions(),
      }),
    ).toThrow(/invalid primitive range|more than one owner/);
    expect(() =>
      createPackedPart(1, {
        geometries: [triangleGeometry()],
        semantic: { ...baseStorage(), faceSubsetOrdinals: Uint32Array.from([0, 0]) },
        nodePositions: nodePositions(),
      }),
    ).toThrow(/faceSubset repeats/);
    expect(() =>
      createPackedPart(1, {
        geometries: [triangleGeometry()],
        semantic: {
          ...baseStorage(),
          edgeNodeOffsets: Uint32Array.from([0, 1]),
          edgeNodeIds: Uint32Array.from([0]),
        },
        nodePositions: nodePositions(),
      }),
    ).toThrow(/two or three nodes/);
  });

  it("rejects inconsistent face grouping, contiguity claims, and mixed primitives", () => {
    expect(() =>
      createPackedPart(1, {
        geometries: [triangleGeometry()],
        semantic: { ...baseStorage(), faceOwnerElementOrdinals: Uint32Array.from([1, 1]) },
        nodePositions: nodePositions(),
      }),
    ).toThrow(/faceOwnerElementOrdinals/);
    expect(() =>
      createPackedPart(1, {
        geometries: [triangleGeometry()],
        semantic: { ...baseStorage(), elementIdsOneBasedContiguous: true },
        nodePositions: nodePositions(),
      }),
    ).toThrow(/contiguous/i);
    expect(() =>
      createPackedPart(1, {
        geometries: [triangleGeometry(), lineGeometry()],
        semantic: baseStorage(),
        nodePositions: nodePositions(),
      }),
    ).toThrow(/every geometry group/);
  });

  it("writes zero neighbor body and element picks for a boundary face", () => {
    const part = createPackedPart(1, {
      geometries: [triangleGeometry()],
      semantic: baseStorage(),
      nodePositions: nodePositions(),
    });
    const geometry = part.geometries[0];
    if (geometry === undefined) throw new Error("Packed geometry is missing");
    expect(Array.from(buildPrimitiveFaceBodyPickData(geometry))).toEqual([
      1, 0, 0, 11, 0, 2, 0, 0, 21, 0,
    ]);
  });

  it("builds a section cap from per-element packed faces without caching all faces", () => {
    const part = createPackedPart(1, {
      geometries: [tetGeometry()],
      semantic: tetStorage(),
      nodePositions: nodePositions(),
    });
    const element = part.elements?.[0];
    const storage = packedSemanticStorage(part);
    if (element === undefined || storage === undefined) throw new Error("Packed Tet4 is missing");
    const cap = buildElementSectionCap({
      part,
      element,
      plane: { normal: [0, 0, 1], distance: -0.5 },
      transform: identity(),
    });
    expect(cap?.vertices).toHaveLength(3);
    expect(packedSemanticMaterializationCounts(storage)).toMatchObject({ elements: 1, faces: 0 });
  });

  it("keeps packed element and face bounds on direct typed ranges", () => {
    const part = createPackedPart(1, {
      geometries: [triangleGeometry()],
      semantic: baseStorage(),
      nodePositions: nodePositions(),
    });
    expect(displayedPartBounds(part, undefined)).toEqual(part.bounds);
    expect(
      selectedGeometryBounds(
        part,
        { kind: "element", partOccurrenceId: "test", elementId: 20 },
        undefined,
      ),
    ).toEqual({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    });
    expect(
      selectedGeometryBounds(
        part,
        { kind: "face", partOccurrenceId: "test", elementId: 10, faceIndex: 0 },
        undefined,
      ),
    ).toEqual({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 0,
    });
  });

  it("builds optional orientation topology from columns without descriptor materialization", () => {
    const part = createPackedPart(1, {
      geometries: [triangleGeometry()],
      semantic: baseStorage(),
      nodePositions: nodePositions(),
    });
    const storage = packedSemanticStorage(part);
    if (storage === undefined) throw new Error("Packed storage is missing");
    expect(getOrientationTopology(part).elements.map((element) => element.id)).toEqual([10, 20]);
    expect(packedSemanticMaterializationCounts(storage)).toEqual({
      elements: 0,
      faces: 0,
      edges: 0,
    });
  });
});

function triangleGeometry(): {
  readonly primitive: "triangles";
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
} {
  return {
    primitive: "triangles",
    positions: nodePositions(),
    indices: Uint32Array.from([0, 1, 2, 1, 2, 3]),
    nodePickIds: Uint32Array.from([1, 2, 3, 4]),
  };
}

function nodePositions(): Float32Array {
  return Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

function lineGeometry(): {
  readonly primitive: "lines";
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
} {
  return {
    primitive: "lines",
    positions: nodePositions(),
    indices: Uint32Array.from([0, 1]),
  };
}

function baseStorage(): PackedSemanticStorage {
  return {
    primitive: "triangles",
    elementIds: Uint32Array.from([10, 20]),
    elementPrimitiveStarts: Uint32Array.from([0, 1]),
    elementPrimitiveCounts: Uint32Array.from([1, 1]),
    elementFaceOffsets: Uint32Array.from([0, 1, 2]),
    elementIdOrdinalsSorted: Uint32Array.from([0, 1]),
    faceOwnerElementOrdinals: Uint32Array.from([0, 1]),
    faceIndices: Uint32Array.from([0, 0]),
    facePrimitiveStarts: Uint32Array.from([0, 1]),
    facePrimitiveCounts: Uint32Array.from([1, 1]),
    faceNeighborElementOrdinals: Uint32Array.from([0, 0]),
    faceNodeOffsets: Uint32Array.from([0, 3, 6]),
    faceNodeIds: Uint32Array.from([0, 1, 2, 1, 2, 3]),
    nodeCount: 4,
  };
}

function tetGeometry(): {
  readonly primitive: "triangles";
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
} {
  return {
    primitive: "triangles",
    positions: nodePositions(),
    indices: Uint32Array.from([0, 1, 3, 1, 2, 3, 2, 0, 3, 0, 2, 1]),
    nodePickIds: Uint32Array.from([1, 2, 3, 4]),
  };
}

function tetStorage(): PackedSemanticStorage {
  return {
    primitive: "triangles",
    elementIds: Uint32Array.from([10]),
    elementPrimitiveStarts: Uint32Array.from([0]),
    elementPrimitiveCounts: Uint32Array.from([4]),
    elementFaceOffsets: Uint32Array.from([0, 4]),
    elementIdOrdinalsSorted: Uint32Array.from([0]),
    elementShape: ElementShape.Tet4,
    faceOwnerElementOrdinals: Uint32Array.from([0, 0, 0, 0]),
    faceIndices: Uint32Array.from([0, 1, 2, 3]),
    facePrimitiveStarts: Uint32Array.from([0, 1, 2, 3]),
    facePrimitiveCounts: Uint32Array.from([1, 1, 1, 1]),
    faceNeighborElementOrdinals: Uint32Array.from([0, 0, 0, 0]),
    faceNodeOffsets: Uint32Array.from([0, 3, 6, 9, 12]),
    faceNodeIds: Uint32Array.from([0, 1, 3, 1, 2, 3, 2, 0, 3, 0, 2, 1]),
    nodeCount: 4,
  };
}
