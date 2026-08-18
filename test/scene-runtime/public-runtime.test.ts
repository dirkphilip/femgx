import { describe, expect, it } from "vitest";
import { createBoltedPlateFixture } from "../../demo/fixtures/bolted-plate";
import { identity } from "../../src/math/mat4";
import { createSceneRuntime } from "../../src/entries/runtime";

describe("public scene runtime", () => {
  it("exposes stable placement and occurrence queries", () => {
    const runtime = createSceneRuntime(createBoltedPlateFixture().scene);
    const partOccurrenceId = runtime.getPartOccurrenceIds()[0];
    const occurrenceId = runtime.getOccurrenceIds()[0];

    expect(partOccurrenceId).toBe("1/0/0");
    expect(occurrenceId).toBe("1");
    expect(runtime.occurrenceCount).toBe(runtime.getOccurrenceIds().length);
    expect(runtime.getPartOccurrence(partOccurrenceId ?? "missing")?.partOccurrenceId).toBe(
      partOccurrenceId,
    );
    expect(runtime.getOccurrence(occurrenceId ?? "missing")?.occurrenceId).toBe(occurrenceId);

    expect(runtime.isPartOccurrenceVisible(partOccurrenceId ?? "missing")).toBe(true);
    expect(runtime).not.toHaveProperty("setPartOccurrenceVisible");
    expect(runtime).not.toHaveProperty("setPartVisible");
    expect(runtime).not.toHaveProperty("setAssemblyOccurrenceVisible");
    expect(runtime).not.toHaveProperty("setAssemblyVisible");
    expect(runtime).not.toHaveProperty("getNodeTransform");
    expect(runtime).not.toHaveProperty("getNodeWorldTransform");
    expect(runtime).not.toHaveProperty("getDrawList");
    expect(runtime.getVisiblePartOccurrenceIds()).toEqual(runtime.getPartOccurrenceIds());
    expect(runtime.getOccurrence(occurrenceId ?? "missing")).not.toHaveProperty("transform");
    expect(runtime.getOccurrence(occurrenceId ?? "missing")).not.toHaveProperty("worldTransform");
  });

  it("keeps public query snapshots independent from packed runtime storage", () => {
    const runtime = createSceneRuntime(createBoltedPlateFixture().scene);
    const partOccurrenceId = runtime.getPartOccurrenceIds()[0];
    if (partOccurrenceId === undefined) throw new Error("fixture has no instance");

    const partOccurrenceIds = runtime.getPartOccurrenceIds() as string[];
    const occurrenceIds = runtime.getOccurrenceIds() as string[];
    const visibleIds = runtime.getVisiblePartOccurrenceIds() as string[];
    partOccurrenceIds[0] = "mutated";
    partOccurrenceIds.pop();
    occurrenceIds[0] = "mutated";
    occurrenceIds.pop();
    visibleIds[0] = "mutated";
    visibleIds.pop();

    expect(runtime.partOccurrenceCount).toBeGreaterThan(0);
    expect(runtime.occurrenceCount).toBeGreaterThan(0);
    expect(runtime.getPartOccurrenceIds()[0]).toBe(partOccurrenceId);
    expect(runtime.getVisiblePartOccurrenceIds()[0]).toBe(partOccurrenceId);
    expect(runtime.getPartOccurrence(partOccurrenceId)?.partOccurrenceId).toBe(partOccurrenceId);

    const transform = runtime.getTransform(partOccurrenceId);
    if (transform === undefined) throw new Error("fixture instance has no transform");
    transform[12] = 999;
    const record = runtime.getPartOccurrence(partOccurrenceId);
    if (record === undefined) throw new Error("fixture instance record is missing");
    record.transform[12] = 998;
    const materialized = runtime.getPartOccurrences()[0];
    if (materialized === undefined) throw new Error("fixture has no materialized instance");
    materialized.transform[12] = 997;

    expect(runtime.getTransform(partOccurrenceId)?.[12]).not.toBe(999);
    expect(runtime.getTransform(partOccurrenceId)?.[12]).not.toBe(998);
    expect(runtime.getTransform(partOccurrenceId)?.[12]).not.toBe(997);
  });

  it("reports direct occurrence membership and deterministic child traversal", () => {
    const runtime = createSceneRuntime(createBoltedPlateFixture().scene);
    const root = runtime.getOccurrence("1");
    if (root === undefined) throw new Error("fixture root occurrence is missing");

    const walk = (occurrenceId: string): string[] => {
      const occurrence = runtime.getOccurrence(occurrenceId);
      if (occurrence === undefined) throw new Error(`missing occurrence ${occurrenceId}`);
      return [occurrenceId, ...occurrence.childIds.flatMap(walk)];
    };

    expect(root.partOccurrenceIds).toEqual([]);
    expect(walk(root.occurrenceId)).toEqual(runtime.getOccurrenceIds());
    for (const occurrenceId of runtime.getOccurrenceIds()) {
      const occurrence = runtime.getOccurrence(occurrenceId);
      if (occurrence === undefined) throw new Error(`missing occurrence ${occurrenceId}`);
      expect(
        occurrence.partOccurrenceIds.every(
          (partOccurrenceId) =>
            runtime.getPartOccurrence(partOccurrenceId)?.occurrenceId === occurrenceId,
        ),
      ).toBe(true);
    }
  });

  it("keeps repeated assembly occurrences independently addressable", () => {
    const runtime = createSceneRuntime(createBoltedPlateFixture().scene);
    const occurrenceIds = runtime
      .getOccurrenceIds()
      .filter((occurrenceId) => runtime.getOccurrence(occurrenceId)?.assemblyId === 4);

    expect(occurrenceIds.length).toBeGreaterThan(1);
    const first = occurrenceIds[0];
    const second = occurrenceIds[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(runtime.getOccurrence(first ?? "missing")?.effectiveVisible).toBe(true);
    expect(runtime.getOccurrence(second ?? "missing")?.effectiveVisible).toBe(true);
  });

  it("rejects a structurally forged scene before public runtime admission", () => {
    const source = createBoltedPlateFixture().scene;
    const root = source.assemblies.get(source.rootAssemblyId);
    expect(root).toBeDefined();
    const invalid = {
      ...source,
      assemblies: new Map(source.assemblies).set(source.rootAssemblyId, {
        ...(root as NonNullable<typeof root>),
        placements: [{ kind: "assembly", assemblyId: 999, transform: identity() }],
      }),
    };

    expect(() => createSceneRuntime(invalid)).toThrow(/references missing assembly 999/);
  });
});
