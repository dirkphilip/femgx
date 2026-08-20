import { expect, it, describe } from "vitest";
import { createElement } from "@/elements/element";
import { createElementModel } from "@/elements/model";
import { ElementShape } from "@/elements/shapes";
import { createPartFromElementModel } from "@/geometry/element-model-part";
import {
  buildBodyPrimitivePickIds,
  buildElementPrimitiveOrdinals,
  buildElementPrimitivePickIds,
  buildFacePrimitivePickIds,
  buildPrimitiveFaceBodyPickData,
  partFor,
  type SemanticTestGeometry,
} from "./support";

function retained(geometry: SemanticTestGeometry) {
  const output = partFor(geometry).geometries[0];
  if (output === undefined) throw new Error("Expected retained geometry");
  return output;
}

describe("buildElementPrimitivePickIds", () => {
  it("maps each triangle to its element pick id (element id + 1)", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      elements: [
        {
          id: 0,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
        },
        {
          id: 3,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 2, primitiveCount: 1 }],
        },
      ],
    };
    expect(Array.from(buildElementPrimitivePickIds(retained(geometry), geometry.elements))).toEqual(
      [1, 1, 4],
    );
  });

  it("produces all-zero ids when the geometry has no elements", () => {
    expect(
      Array.from(
        buildElementPrimitivePickIds({
          positions: new Float32Array(9),
          indices: new Uint32Array(3),
          primitive: "triangles" as const,
        }),
      ),
    ).toEqual([0]);
  });

  it("maps authored line segments and point sprites to their element ids", () => {
    expect(
      Array.from(
        buildElementPrimitivePickIds(
          {
            positions: new Float32Array(6),
            indices: new Uint32Array([0, 1]),
            primitive: "lines",
          },
          [
            {
              id: 4,
              primitiveRanges: [{ primitive: "lines", primitiveStart: 0, primitiveCount: 1 }],
            },
          ],
        ),
      ),
    ).toEqual([5]);
    expect(
      Array.from(
        buildElementPrimitivePickIds(
          {
            positions: new Float32Array(6),
            indices: new Uint32Array([0]),
            primitive: "points",
          },
          [
            {
              id: 8,
              primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }],
            },
          ],
        ),
      ),
    ).toEqual([9]);
  });
});

describe("buildElementPrimitiveOrdinals", () => {
  it("keeps display-only geometry free of element ordinal metadata", () => {
    const geometry = {
      primitive: "triangles" as const,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    };

    expect(buildElementPrimitiveOrdinals(geometry, [], () => undefined)).toEqual(new Uint32Array());
  });

  it("maps each primitive to its stable part-wide element ordinal", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      elements: [
        {
          id: 40,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
        },
        {
          id: 2,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 2, primitiveCount: 1 }],
        },
      ],
    };
    expect(
      Array.from(
        buildElementPrimitiveOrdinals(retained(geometry), geometry.elements ?? [], (id) =>
          id === 40 ? 4 : id === 2 ? 2 : undefined,
        ),
      ),
    ).toEqual([4, 4, 2]);
  });
});

describe("buildBodyPrimitivePickIds", () => {
  it("maps triangles to their reusable body pick ids", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      elements: [
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
          bodyId: 7,
        },
      ],
      bodies: [{ id: 7, elementIds: [4] }],
    };
    expect(Array.from(buildBodyPrimitivePickIds(retained(geometry), geometry.elements))).toEqual([
      8, 8,
    ]);
  });
});

describe("buildFacePrimitivePickIds", () => {
  it("derives dense ids from exact face ranges", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      faces: [
        {
          elementId: 1,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "a",
          nodeIds: [],
        },
        {
          elementId: 1,
          faceIndex: 1,
          primitiveStart: 1,
          primitiveCount: 2,
          key: "b",
          nodeIds: [],
        },
      ],
      elements: [
        {
          id: 1,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 3 }],
        },
      ],
    };
    expect(Array.from(buildFacePrimitivePickIds(retained(geometry)))).toEqual([1, 2, 2]);
  });

  it("produces all-zero ids when the geometry has no faces", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(3),
      primitive: "triangles" as const,
    };
    expect(Array.from(buildFacePrimitivePickIds(retained(geometry)))).toEqual([0]);
  });
});

describe("buildPrimitiveFaceBodyPickData", () => {
  it("retains Point, Line, and Line3 owners from an element model", () => {
    const nodes = [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 5, 0, 0];
    const elements = [
      createElement(2, ElementShape.Point, [5]),
      createElement(27, ElementShape.Line, [0, 1]),
      createElement(51, ElementShape.Line3, [2, 3, 4]),
    ];
    const part = createPartFromElementModel(
      1,
      createElementModel(nodes, elements, {
        bodies: [
          { id: 4, elementIds: [2] },
          { id: 9, elementIds: [27] },
          { id: 18, elementIds: [51] },
        ],
      }),
    );
    const line = part.geometries.find((geometry) => geometry.primitive === "lines");
    const point = part.geometries.find((geometry) => geometry.primitive === "points");
    if (line === undefined || point === undefined)
      throw new Error("Expected line and point geometry");

    expect(Array.from(buildPrimitiveFaceBodyPickData(line))).toEqual([
      0, 10, 0, 28, 0, 0, 19, 0, 52, 0, 0, 19, 0, 52, 0,
    ]);
    expect(Array.from(buildPrimitiveFaceBodyPickData(point))).toEqual([0, 5, 0, 3, 0]);

    const bodylessPart = createPartFromElementModel(2, createElementModel(nodes, elements));
    const bodylessLine = bodylessPart.geometries.find((geometry) => geometry.primitive === "lines");
    if (bodylessLine === undefined) throw new Error("Expected bodyless line geometry");
    expect(Array.from(buildPrimitiveFaceBodyPickData(bodylessLine))).toEqual([
      0, 0, 0, 28, 0, 0, 0, 0, 52, 0, 0, 0, 0, 52, 0,
    ]);
  });

  it("retains sparse body and element owners for semantic lines and points", () => {
    const cases: readonly {
      readonly geometry: SemanticTestGeometry;
      readonly expected: readonly number[];
    }[] = [
      {
        geometry: {
          positions: new Float32Array(12),
          indices: new Uint32Array([0, 1, 1, 2, 2, 3]),
          primitive: "lines" as const,
          elements: [
            {
              id: 51,
              bodyId: 18,
              primitiveRanges: [{ primitive: "lines", primitiveStart: 0, primitiveCount: 1 }],
            },
            {
              id: 6,
              bodyId: 4,
              primitiveRanges: [{ primitive: "lines", primitiveStart: 1, primitiveCount: 2 }],
            },
          ],
          bodies: [
            { id: 4, elementIds: [6] },
            { id: 18, elementIds: [51] },
          ],
        },
        expected: [0, 19, 0, 52, 0, 0, 5, 0, 7, 0, 0, 5, 0, 7, 0],
      },
      {
        geometry: {
          positions: new Float32Array(6),
          indices: new Uint32Array([0, 1]),
          primitive: "points" as const,
          elements: [
            {
              id: 27,
              bodyId: 12,
              primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }],
            },
            {
              id: 2,
              bodyId: 9,
              primitiveRanges: [{ primitive: "points", primitiveStart: 1, primitiveCount: 1 }],
            },
          ],
          bodies: [
            { id: 9, elementIds: [2] },
            { id: 12, elementIds: [27] },
          ],
        },
        expected: [0, 13, 0, 28, 0, 0, 10, 0, 3, 0],
      },
    ];

    for (const { geometry, expected } of cases) {
      expect(
        Array.from(buildPrimitiveFaceBodyPickData(retained(geometry), geometry.elements)),
      ).toEqual(expected);
    }
  });

  it("preserves retained triangle face and owner bytes", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      elements: [
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
          bodyId: 7,
        },
      ],
      bodies: [{ id: 7, elementIds: [4] }],
      faces: [
        {
          elementId: 4,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 2,
          key: "a",
          nodeIds: [],
          bodyId: 7,
        },
      ],
    };
    expect(
      Array.from(buildPrimitiveFaceBodyPickData(retained(geometry), geometry.elements)),
    ).toEqual([1, 8, 0, 5, 0, 1, 8, 0, 5, 0]);
  });

  it("leaves display-only lines and points unowned", () => {
    const cases = [
      {
        positions: new Float32Array(6),
        indices: new Uint32Array([0, 1]),
        primitive: "lines" as const,
      },
      {
        positions: new Float32Array(3),
        indices: new Uint32Array([0]),
        primitive: "points" as const,
      },
    ];

    for (const geometry of cases) {
      expect(Array.from(buildPrimitiveFaceBodyPickData(geometry))).toEqual([0, 0, 0, 0, 0]);
    }
  });
});
