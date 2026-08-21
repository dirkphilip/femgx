import { describe, expect, it } from "vitest";
import { createBoltedPlateFixture } from "../../demo/fixtures/bolted-plate";
import { identityMatrix } from "../../src/math/mat4";
import { createSceneOccurrenceSnapshot } from "../../src/scene-runtime/occurrences";

describe("scene occurrences", () => {
  it("exposes stable placement and occurrence queries", () => {
    const runtime = createSceneOccurrenceSnapshot(createBoltedPlateFixture().scene);
    const partOccurrenceId = runtime.getPartOccurrenceId(0);
    const occurrenceId = runtime.getAssemblyOccurrenceId(0);
    const nestedOccurrence = runtime.getAssemblyOccurrence("1/plate-stack");

    expect(partOccurrenceId).toBe("1/plate-stack/plate-base");
    expect(occurrenceId).toBe("1");
    expect(runtime.assemblyOccurrenceCount).toBe(Array.from(runtime.assemblyOccurrences()).length);
    expect(runtime.getPartOccurrence(partOccurrenceId ?? "missing")?.partOccurrenceId).toBe(
      partOccurrenceId,
    );
    expect(runtime.getPartOccurrence(partOccurrenceId ?? "missing")?.placementId).toBe(
      "plate-base",
    );
    expect(runtime.getAssemblyOccurrence(occurrenceId ?? "missing")?.assemblyOccurrenceId).toBe(
      occurrenceId,
    );
    expect(runtime.getAssemblyOccurrence(occurrenceId ?? "missing")?.placementId).toBeUndefined();
    expect(nestedOccurrence?.placementId).toBe("plate-stack");

    expect(runtime.isPartOccurrenceVisible(partOccurrenceId ?? "missing")).toBe(true);
    expect(runtime).not.toHaveProperty("setPartOccurrenceVisible");
    expect(runtime).not.toHaveProperty("setPartVisible");
    expect(runtime).not.toHaveProperty("setAssemblyOccurrenceVisible");
    expect(runtime).not.toHaveProperty("setAssemblyVisible");
    expect(runtime).not.toHaveProperty("getNodeTransform");
    expect(runtime).not.toHaveProperty("getNodeWorldTransform");
    expect(runtime).not.toHaveProperty("getDrawList");
    expect(Array.from(runtime.visiblePartOccurrenceIds())).toEqual(
      Array.from(runtime.partOccurrences(), ({ partOccurrenceId: id }) => id),
    );
    expect(runtime.getAssemblyOccurrence(occurrenceId ?? "missing")).not.toHaveProperty(
      "transform",
    );
    expect(runtime.getAssemblyOccurrence(occurrenceId ?? "missing")).not.toHaveProperty(
      "worldTransform",
    );
  });

  it("keeps public query snapshots independent from packed runtime storage", () => {
    const runtime = createSceneOccurrenceSnapshot(createBoltedPlateFixture().scene);
    const partOccurrenceId = runtime.getPartOccurrenceId(0);
    if (partOccurrenceId === undefined) throw new Error("fixture has no instance");

    const partOccurrenceIds = Array.from(
      runtime.partOccurrences(),
      ({ partOccurrenceId: id }) => id,
    );
    const occurrenceIds = Array.from(
      runtime.assemblyOccurrences(),
      ({ assemblyOccurrenceId: id }) => id,
    );
    const visibleIds = Array.from(runtime.visiblePartOccurrenceIds());
    partOccurrenceIds[0] = "mutated";
    occurrenceIds[0] = "mutated";
    visibleIds[0] = "mutated";

    expect(runtime.partOccurrenceCount).toBeGreaterThan(0);
    expect(runtime.assemblyOccurrenceCount).toBeGreaterThan(0);
    expect(runtime.getPartOccurrenceId(0)).toBe(partOccurrenceId);
    expect(Array.from(runtime.visiblePartOccurrenceIds())[0]).toBe(partOccurrenceId);
    expect(runtime.getPartOccurrence(partOccurrenceId)?.partOccurrenceId).toBe(partOccurrenceId);

    const transform = runtime.getTransform(partOccurrenceId);
    if (transform === undefined) throw new Error("fixture instance has no transform");
    transform[12] = 999;
    const record = runtime.getPartOccurrence(partOccurrenceId);
    if (record === undefined) throw new Error("fixture instance record is missing");
    record.transform[12] = 998;
    const materialized = runtime.getPartOccurrence(partOccurrenceId);
    if (materialized === undefined) throw new Error("fixture has no materialized instance");
    materialized.transform[12] = 997;

    expect(runtime.getTransform(partOccurrenceId)?.[12]).not.toBe(999);
    expect(runtime.getTransform(partOccurrenceId)?.[12]).not.toBe(998);
    expect(runtime.getTransform(partOccurrenceId)?.[12]).not.toBe(997);
  });

  it("retains no model-sized occurrence snapshots and streams fresh records", () => {
    const runtime = createSceneOccurrenceSnapshot(createBoltedPlateFixture().scene);
    const partOccurrenceId = runtime.getPartOccurrenceId(0);
    if (partOccurrenceId === undefined) throw new Error("fixture has no instance");
    const first = runtime.getPartOccurrence(partOccurrenceId);
    const second = runtime.getPartOccurrence(partOccurrenceId);
    if (first === undefined || second === undefined) throw new Error("fixture record is missing");

    expect(first.partOccurrenceId).toBe(second.partOccurrenceId);
    expect(first).not.toBe(second);
    expect(Object.getOwnPropertyNames(runtime)).toEqual(["runtime"]);
    expect(runtime).not.toHaveProperty("getPartOccurrenceIds");
    expect(runtime).not.toHaveProperty("getOccurrenceIds");
    expect(runtime).not.toHaveProperty("getPartOccurrences");
    expect(runtime).not.toHaveProperty("getOccurrences");
  });

  it("reports direct occurrence membership and deterministic child traversal", () => {
    const runtime = createSceneOccurrenceSnapshot(createBoltedPlateFixture().scene);
    const root = runtime.getAssemblyOccurrence("1");
    if (root === undefined) throw new Error("fixture root occurrence is missing");

    const walk = (occurrenceId: string): string[] => {
      const occurrence = runtime.getAssemblyOccurrence(occurrenceId);
      if (occurrence === undefined) throw new Error(`missing occurrence ${occurrenceId}`);
      return [
        occurrenceId,
        ...Array.from({ length: occurrence.childCount }, (_, ordinal) =>
          occurrence.getChildId(ordinal),
        )
          .filter((childId): childId is string => childId !== undefined)
          .flatMap(walk),
      ];
    };

    expect(root.partOccurrenceCount).toBe(0);
    expect(walk(root.assemblyOccurrenceId)).toEqual(
      Array.from(runtime.assemblyOccurrences(), ({ assemblyOccurrenceId }) => assemblyOccurrenceId),
    );
    for (const { assemblyOccurrenceId } of runtime.assemblyOccurrences()) {
      const occurrence = runtime.getAssemblyOccurrence(assemblyOccurrenceId);
      if (occurrence === undefined) throw new Error(`missing occurrence ${assemblyOccurrenceId}`);
      expect(
        Array.from({ length: occurrence.partOccurrenceCount }, (_, ordinal) =>
          occurrence.getPartOccurrenceId(ordinal),
        )
          .filter((partOccurrenceId): partOccurrenceId is string => partOccurrenceId !== undefined)
          .every(
            (partOccurrenceId) =>
              runtime.getPartOccurrence(partOccurrenceId)?.assemblyOccurrenceId ===
              assemblyOccurrenceId,
          ),
      ).toBe(true);
    }
  });

  it("keeps repeated assembly occurrences independently addressable", () => {
    const runtime = createSceneOccurrenceSnapshot(createBoltedPlateFixture().scene);
    const occurrenceIds = Array.from(
      runtime.assemblyOccurrences(),
      ({ assemblyOccurrenceId, assemblyId }) =>
        assemblyId === 4 ? assemblyOccurrenceId : undefined,
    ).filter((occurrenceId): occurrenceId is string => occurrenceId !== undefined);

    expect(occurrenceIds.length).toBeGreaterThan(1);
    const first = occurrenceIds[0];
    const second = occurrenceIds[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(runtime.getAssemblyOccurrence(first ?? "missing")?.effectiveVisible).toBe(true);
    expect(runtime.getAssemblyOccurrence(second ?? "missing")?.effectiveVisible).toBe(true);
  });

  it("rejects a structurally forged scene before occurrence inspection", () => {
    const source = createBoltedPlateFixture().scene;
    const root = source.assemblies.get(source.rootAssemblyId);
    expect(root).toBeDefined();
    const invalid = {
      ...source,
      assemblies: new Map(source.assemblies).set(source.rootAssemblyId, {
        ...(root as NonNullable<typeof root>),
        placements: [
          {
            kind: "assembly",
            placementId: "0",
            assemblyId: 999,
            transform: identityMatrix(),
          },
        ],
      }),
    };

    expect(() => createSceneOccurrenceSnapshot(invalid)).toThrow(/references missing assembly 999/);
  });
});
