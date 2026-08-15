import { describe, expect, it } from "vitest";
import { createPart, type ElementTessellation, type Part } from "../../src/geometry/part";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  PYRAMID5_SHAPE,
  QUAD8_SHAPE,
  QUAD_SHAPE,
  TRI6_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  WEDGE6_SHAPE,
  type ElementShape,
} from "../../src/elements/shapes";
import { createResultField } from "../../src/results/fields";
import { resolveElementalOrientationRecords } from "../../src/results/orientation-records";

interface ElementInput {
  readonly id: number;
  readonly nodePickIds: readonly number[];
  readonly bodyId?: number;
  readonly shape?: ElementShape;
}

const NODE_POSITIONS = new Float32Array([0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 2, 2, 2, 0, 0, 2, 2]);

function makePart(
  elements: readonly ElementInput[],
  options: {
    readonly primitive?: "triangles" | "lines" | "points";
    readonly nodePositions?: Float32Array | null;
  } = {},
): Part {
  const primitive = options.primitive ?? "triangles";
  const nodePositions =
    options.nodePositions === null ? undefined : (options.nodePositions ?? NODE_POSITIONS);
  const verticesPerPrimitive = primitive === "triangles" ? 3 : primitive === "lines" ? 2 : 1;
  const positions: number[] = [];
  const indices: number[] = [];
  const nodePickIds: number[] = [];
  const descriptors: ElementTessellation[] = [];
  const bodyElements = new Map<number, number[]>();
  let primitiveStart = 0;
  for (const element of elements) {
    const primitiveCount = element.nodePickIds.length / verticesPerPrimitive;
    descriptors.push({
      id: element.id,
      primitiveRanges: [{ primitive, primitiveStart, primitiveCount }],
      shape: element.shape ?? TRIANGLE_SHAPE,
      ...(element.bodyId === undefined ? {} : { bodyId: element.bodyId }),
    });
    if (element.bodyId !== undefined) {
      const ids = bodyElements.get(element.bodyId) ?? [];
      ids.push(element.id);
      bodyElements.set(element.bodyId, ids);
    }
    for (const nodePickId of element.nodePickIds) {
      const nodeId = nodePickId - 1;
      const source = nodeId * 3;
      const x = nodeId < 0 ? 0 : (nodePositions?.[source] ?? 0);
      const y = nodeId < 0 ? 0 : (nodePositions?.[source + 1] ?? 0);
      const z = nodeId < 0 ? 0 : (nodePositions?.[source + 2] ?? 0);
      positions.push(x, y, z);
      nodePickIds.push(nodePickId);
      indices.push(indices.length);
    }
    primitiveStart += primitiveCount;
  }
  return createPart(elements.length === 0 ? 1 : 7, {
    geometries: [
      {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        primitive,
        nodePickIds: new Uint32Array(nodePickIds),
      },
    ],
    elements: descriptors,
    ...(bodyElements.size === 0
      ? {}
      : {
          bodies: [...bodyElements.entries()]
            .sort(([left], [right]) => left - right)
            .map(([id, elementIds]) => ({ id, elementIds })),
        }),
    ...(nodePositions === undefined ? {} : { nodePositions }),
  });
}

function vectorField(
  count: number,
  values: ReadonlyMap<number, readonly [number, number, number]>,
) {
  const data = new Float32Array(count * 3);
  data.fill(NaN);
  for (const [element, vector] of values) data.set(vector, element * 3);
  return createResultField({
    id: "orientation",
    name: "Authored orientation",
    location: "elemental",
    shape: "vector",
    count,
    unit: "unitless",
    values: data,
  });
}

function expectFloats(actual: ArrayLike<number | undefined>, expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 5);
  });
}

describe("elemental orientation records", () => {
  it("orders records by element id and stores normalized directions and body pick ids", () => {
    const part = makePart([
      { id: 8, nodePickIds: [4, 5, 6] },
      { id: 2, nodePickIds: [1, 2, 3], bodyId: 4 },
    ]);
    const records = resolveElementalOrientationRecords(
      part,
      vectorField(
        9,
        new Map([
          [2, [3, 4, 0]],
          [8, [0, 0, -2]],
        ]),
      ),
    );

    expect(records.elementIds).toEqual(new Uint32Array([2, 8]));
    expect(records.bodyIds).toEqual(new Uint32Array([5, 0]));
    expectFloats(records.anchors, [2 / 3, 4 / 3, 0, 2 / 3, 4 / 3, 4 / 3]);
    expectFloats(records.referenceLengths, [Math.hypot(2, 4, 0), Math.hypot(2, 2, 2)]);
    expectFloats(records.directions, [0.6, 0.8, 0, 0, 0, -1]);
    expect(records.anchorDeltas).toBeUndefined();
  });

  it.each([
    ["Line", LINE_SHAPE, "lines"],
    ["Line3", LINE3_SHAPE, "lines"],
    ["Triangle", TRIANGLE_SHAPE, "triangles"],
    ["Tri6", TRI6_SHAPE, "triangles"],
    ["Quad", QUAD_SHAPE, "triangles"],
    ["Quad8", QUAD8_SHAPE, "triangles"],
    ["Tet4", TET4_SHAPE, "triangles"],
    ["Tet10", TET10_SHAPE, "triangles"],
    ["Wedge6", WEDGE6_SHAPE, "triangles"],
    ["Pyramid5", PYRAMID5_SHAPE, "triangles"],
    ["Hex8", HEX8_SHAPE, "triangles"],
    ["Hex20", HEX20_SHAPE, "triangles"],
  ] as const)("resolves a non-degenerate %s element", (_name, shape, primitive) => {
    const nodePickIds = primitive === "lines" ? [1, 2] : [1, 2, 3];
    const part = makePart([{ id: 0, nodePickIds, shape }], { primitive });
    const records = resolveElementalOrientationRecords(
      part,
      vectorField(1, new Map([[0, [1, 0, 0]]])),
    );
    expect(records.elementIds).toEqual(new Uint32Array([0]));
    expect(records.referenceLengths[0]).toBeGreaterThan(0);
  });

  it("deduplicates nodes across indexed primitive ranges before averaging", () => {
    const part = makePart([{ id: 0, nodePickIds: [1, 2, 3, 1, 2, 3], bodyId: 2 }]);
    const records = resolveElementalOrientationRecords(
      part,
      vectorField(1, new Map([[0, [0, 1, 0]]])),
    );

    expectFloats(records.anchors, [2 / 3, 4 / 3, 0]);
    expect(records.referenceLengths[0]).toBeCloseTo(Math.hypot(2, 4, 0), 5);
  });

  it("computes unscaled mean anchor deltas and reuses field and displacement arrays", () => {
    const part = makePart([{ id: 0, nodePickIds: [1, 2, 3] }]);
    const field = vectorField(1, new Map([[0, [1, 0, 0]]]));
    const displacements = new Float32Array([1, 2, 3, NaN, 4, 5, 7, 8, 9]);
    const first = resolveElementalOrientationRecords(part, field, displacements);
    const second = resolveElementalOrientationRecords(part, field, displacements);

    expectFloats(first.anchorDeltas ?? [], [8 / 3, 14 / 3, 17 / 3]);
    expect(second.elementIds).toBe(first.elementIds);
    expect(second.anchors).toBe(first.anchors);
    expect(second.anchorDeltas).toBe(first.anchorDeltas);
  });

  it("does not reuse anchor deltas across different active element records", () => {
    const part = makePart([
      { id: 0, nodePickIds: [1, 2, 3] },
      { id: 1, nodePickIds: [4, 5, 6] },
    ]);
    const displacements = new Float32Array(18).fill(1);
    const first = resolveElementalOrientationRecords(
      part,
      vectorField(2, new Map([[0, [1, 0, 0]]])),
      displacements,
    );
    const second = resolveElementalOrientationRecords(
      part,
      vectorField(2, new Map([[1, [1, 0, 0]]])),
      displacements,
    );

    expect(first.elementIds).toEqual(new Uint32Array([0]));
    expect(second.elementIds).toEqual(new Uint32Array([1]));
    expect(second.anchorDeltas).not.toBe(first.anchorDeltas);
    expectFloats(second.anchorDeltas ?? [], [1, 1, 1]);
  });

  it("returns an empty state for missing or zero rows without anchor metadata", () => {
    const part = makePart([{ id: 0, nodePickIds: [0, 0, 0] }], {
      nodePositions: null,
    });
    const field = vectorField(1, new Map([[0, [0, 0, 0]]]));

    const records = resolveElementalOrientationRecords(part, field);

    expect(records.elementIds).toHaveLength(0);
    expect(records.directions).toHaveLength(0);
  });

  it("rejects uncovered fields, missing metadata, and degenerate active elements", () => {
    const uncovered = makePart([{ id: 2, nodePickIds: [1, 2, 3] }]);
    expect(() => resolveElementalOrientationRecords(uncovered, vectorField(2, new Map()))).toThrow(
      /has no value for element 2/,
    );

    const noElements = makePart([], { nodePositions: null });
    expect(() =>
      resolveElementalOrientationRecords(noElements, vectorField(1, new Map([[0, [1, 0, 0]]]))),
    ).toThrow(/no element metadata/);

    const noNodeMap = makePart([{ id: 0, nodePickIds: [1, 2, 3] }]);
    const noNodeMapGeometry = createPart(7, {
      geometries: [
        {
          positions: noNodeMap.geometries[0]?.positions ?? new Float32Array(),
          indices: noNodeMap.geometries[0]?.indices ?? new Uint32Array(),
          primitive: "triangles",
        },
      ],
      elements: noNodeMap.elements ?? [],
      nodePositions: NODE_POSITIONS,
    });
    expect(() =>
      resolveElementalOrientationRecords(
        noNodeMapGeometry,
        vectorField(1, new Map([[0, [1, 0, 0]]])),
      ),
    ).toThrow(/nodePickIds/);

    const noNodePositions = makePart([{ id: 0, nodePickIds: [1, 2, 3] }], {
      nodePositions: null,
    });
    expect(() =>
      resolveElementalOrientationRecords(
        noNodePositions,
        vectorField(1, new Map([[0, [1, 0, 0]]])),
      ),
    ).toThrow(/no nodePositions/);

    const point = makePart([{ id: 0, nodePickIds: [1], shape: POINT_SHAPE }], {
      primitive: "points",
    });
    expect(() =>
      resolveElementalOrientationRecords(point, vectorField(1, new Map([[0, [1, 0, 0]]]))),
    ).toThrow(/fewer than two authored nodes/);

    const degenerate = makePart([{ id: 0, nodePickIds: [1, 2] }], {
      primitive: "lines",
      nodePositions: new Float32Array([0, 0, 0, 0, 0, 0]),
    });
    expect(() =>
      resolveElementalOrientationRecords(degenerate, vectorField(1, new Map([[0, [1, 0, 0]]]))),
    ).toThrow(/zero extent/);
  });

  it("omits partial NaN and near-zero rows without normalizing invalid values", () => {
    const part = makePart([
      { id: 0, nodePickIds: [1, 2, 3] },
      { id: 1, nodePickIds: [4, 5, 6] },
      { id: 2, nodePickIds: [1, 2, 3] },
      { id: 3, nodePickIds: [4, 5, 6] },
    ]);
    const records = resolveElementalOrientationRecords(
      part,
      vectorField(
        4,
        new Map([
          [0, [NaN, 1, 0]],
          [1, [1e-13, 0, 0]],
          [2, [0, 0, 2]],
          [3, [Infinity, 0, 0]],
        ]),
      ),
    );

    expect(records.elementIds).toEqual(new Uint32Array([2]));
    expectFloats(records.directions, [0, 0, 1]);
  });
});
