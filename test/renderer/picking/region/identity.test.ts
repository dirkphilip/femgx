import { expect, it, describe } from "vitest";
import {
  createPart,
  createPickRegionTargetResolver,
  createPickRegionTargetCollector,
  getPartSemanticIndex,
  instance,
  triangleGeometry,
  richTrianglePart,
  ids,
  type PickContext,
} from "./support";

describe("GPU pick regions", () => {
  it.each([
    ["part", ids({ elementPickId: 5 }), { kind: "part", partId: 1 }],
    [
      "partOccurrence",
      ids({ instancePickId: 2 }),
      { kind: "partOccurrence", partOccurrenceId: "root/1" },
    ],
    ["body", ids({ elementPickId: 5 }), { kind: "body", partOccurrenceId: "root/0", bodyId: 7 }],
    [
      "element",
      ids({ elementPickId: 5 }),
      { kind: "element", partOccurrenceId: "root/0", elementId: 4 },
    ],
    [
      "face",
      ids({ facePickId: 1 }),
      { kind: "face", partOccurrenceId: "root/0", elementId: 4, faceIndex: 2 },
    ],
    ["node", ids({ nodePickId: 2 }), { kind: "node", partOccurrenceId: "root/0", nodeId: 1 }],
  ] as const)("resolves %s targets from minimal metadata", (granularity, pickIds, expected) => {
    const part = richTrianglePart();
    const context: PickContext = {
      instances: [instance(), { ...instance(), partOccurrenceId: "root/1" }],
      parts: new Map([[1, part]]),
    };
    expect(createPickRegionTargetResolver(context, granularity)(pickIds)).toEqual(expected);
  });

  it("resolves direct assembly owners from retained pick context", () => {
    const context: PickContext = {
      instances: [instance()],
      parts: new Map([[1, richTrianglePart()]]),
      assemblyPath: () => [
        { assemblyId: 1, assemblyOccurrenceId: "1" },
        { assemblyId: 2, assemblyOccurrenceId: "1/left" },
      ],
    };
    expect(createPickRegionTargetResolver(context, "assembly")(ids({ instancePickId: 1 }))).toEqual(
      {
        kind: "assembly",
        assemblyId: 2,
      },
    );
    expect(
      createPickRegionTargetResolver(context, "assemblyOccurrence")(ids({ instancePickId: 1 })),
    ).toEqual({ kind: "assemblyOccurrence", assemblyOccurrenceId: "1/left" });
  });

  it("keeps region target kinds strict and ignores invalid ownership ids", () => {
    const part = richTrianglePart();
    const unownedPart = createPart(2, { geometries: [triangleGeometry()] });
    const context: PickContext = {
      instances: [instance(), { ...instance(), partOccurrenceId: "root/1", partId: 2 }],
      parts: new Map([
        [1, part],
        [2, unownedPart],
      ]),
    };
    expect(
      createPickRegionTargetResolver(context, "element")(ids({ elementPickId: 0 })),
    ).toBeUndefined();
    expect(
      createPickRegionTargetResolver(context, "element")(ids({ elementPickId: 99 })),
    ).toBeUndefined();
    expect(
      createPickRegionTargetResolver(context, "body")(ids({ instancePickId: 2, elementPickId: 5 })),
    ).toBeUndefined();
    expect(createPickRegionTargetResolver(context, "face")(ids({ facePickId: 2 }))).toBeUndefined();
    expect(createPickRegionTargetResolver(context, "node")(ids({ nodePickId: 4 }))).toBeUndefined();
  });

  it("reuses one part index while preserving occurrence-scoped targets", () => {
    const context: PickContext = {
      instances: [instance(), { ...instance(), partOccurrenceId: "root/1" }],
      parts: new Map([[1, richTrianglePart()]]),
    };
    const resolve = createPickRegionTargetResolver(context, "element");
    expect(resolve(ids({ elementPickId: 5 }))).toEqual({
      kind: "element",
      partOccurrenceId: "root/0",
      elementId: 4,
    });
    expect(resolve(ids({ instancePickId: 2, elementPickId: 5 }))).toEqual({
      kind: "element",
      partOccurrenceId: "root/1",
      elementId: 4,
    });
  });

  it("resolves sparse authored element ids through prepared metadata", () => {
    const part = createPart(3, {
      geometries: [
        { positions: new Float32Array(6), indices: new Uint32Array([0, 1]), primitive: "points" },
      ],
      elements: [
        { id: 7, primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }] },
        {
          id: 100_000,
          primitiveRanges: [{ primitive: "points", primitiveStart: 1, primitiveCount: 1 }],
        },
      ],
    });
    getPartSemanticIndex(part);
    const originalGeometry = part.geometries[0];
    if (originalGeometry === undefined) throw new Error("Expected point geometry");
    Object.defineProperty(part, "geometries", {
      configurable: true,
      value: [
        new Proxy(originalGeometry, {
          get(target, property, _receiver) {
            if (property === "elements") throw new Error("region resolution scanned the part");
            return (target as unknown as Record<PropertyKey, unknown>)[property];
          },
        }),
      ],
    });
    const resolve = createPickRegionTargetResolver(
      { instances: [instance(3)], parts: new Map([[3, part]]) },
      "element",
    );

    expect(resolve(ids({ elementPickId: 100_001 }))).toEqual({
      kind: "element",
      partOccurrenceId: "root/0",
      elementId: 100_000,
    });
  });

  it("deduplicates semantic owners and keeps numeric ordering", () => {
    const collector = createPickRegionTargetCollector();
    collector.add({ kind: "body", partOccurrenceId: "root/1", bodyId: 8 }, 2);
    collector.add({ kind: "body", partOccurrenceId: "root/0", bodyId: 12 }, 1);
    collector.add({ kind: "body", partOccurrenceId: "root/0", bodyId: 12 }, 1);
    collector.add({ kind: "body", partOccurrenceId: "root/0", bodyId: 3 }, 1);

    expect(collector.finish()).toEqual([
      { kind: "body", partOccurrenceId: "root/0", bodyId: 3 },
      { kind: "body", partOccurrenceId: "root/0", bodyId: 12 },
      { kind: "body", partOccurrenceId: "root/1", bodyId: 8 },
    ]);
  });

  it("deduplicates assembly definitions and occurrences independently", () => {
    const collector = createPickRegionTargetCollector();
    collector.add({ kind: "assembly", assemblyId: 2 }, 3);
    collector.add({ kind: "assembly", assemblyId: 2 }, 1);
    collector.add({ kind: "assembly", assemblyId: 1 }, 2);
    collector.add({ kind: "assemblyOccurrence", assemblyOccurrenceId: "root/2" }, 3);
    collector.add({ kind: "assemblyOccurrence", assemblyOccurrenceId: "root/2" }, 4);
    collector.add({ kind: "assemblyOccurrence", assemblyOccurrenceId: "root/1" }, 2);

    expect(collector.finish()).toEqual([
      { kind: "assembly", assemblyId: 1 },
      { kind: "assembly", assemblyId: 2 },
      { kind: "assemblyOccurrence", assemblyOccurrenceId: "root/1" },
      { kind: "assemblyOccurrence", assemblyOccurrenceId: "root/2" },
    ]);
  });
});
