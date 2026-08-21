import { describe, expect, it } from "vitest";
import { createSceneBuilder } from "../../src/scene/scene";
import type { Placement } from "../../src/scene/assembly";
import { emptyPart } from "../support/scene-fixtures";

describe("createSceneBuilder", () => {
  it("builds a scene with parts, assemblies, and visibility state", () => {
    const scene = createSceneBuilder()
      .addPart(emptyPart(1))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", placementId: "root-part", partId: 1, transform: new Float32Array(16) },
        ],
      })
      .setRootAssembly(1)
      .build();
    expect(scene.parts.size).toBe(1);
    expect(scene.assemblies.size).toBe(1);
    expect(scene.rootAssemblyId).toBe(1);
    expect(scene.visiblePartIds.has(1)).toBe(true);
    expect(scene.visibleAssemblyIds.has(1)).toBe(true);
  });

  it("keeps built scene snapshots isolated from later builder updates", () => {
    const builder = createSceneBuilder()
      .addPart(emptyPart(1))
      .addAssembly({ id: 1, name: "root", placements: [] })
      .setRootAssembly(1);
    const first = builder.build();
    builder.addPart(emptyPart(2)).setPartVisible(1, false);
    const second = builder.build();

    expect(first.parts.has(2)).toBe(false);
    expect(first.visiblePartIds.has(1)).toBe(true);
    expect(second.parts.has(2)).toBe(true);
    expect(second.visiblePartIds.has(1)).toBe(false);
  });

  it("records part and assembly visibility in built scenes", () => {
    const scene = createSceneBuilder()
      .addPart(emptyPart(1))
      .addAssembly({ id: 1, name: "root", placements: [] })
      .setRootAssembly(1)
      .build();
    const hidden = createSceneBuilder()
      .addPart(emptyPart(1))
      .addAssembly({ id: 1, name: "root", placements: [] })
      .setRootAssembly(1)
      .setPartVisible(1, false)
      .setAssemblyVisible(1, false)
      .build();
    expect(scene.visiblePartIds.has(1)).toBe(true);
    expect(hidden.visiblePartIds.has(1)).toBe(false);
    expect(hidden.visibleAssemblyIds.has(1)).toBe(false);
  });

  it("throws when building without a root", () => {
    expect(() => createSceneBuilder().build()).toThrow("root assembly is not set");
  });

  it("rejects an unregistered root", () => {
    expect(() => createSceneBuilder().setRootAssembly(99).build()).toThrow(
      "root assembly 99 is not registered",
    );
  });

  it("rejects duplicate registrations and missing references", () => {
    const firstPart = emptyPart(1);
    expect(() => createSceneBuilder().addPart(firstPart).addPart(firstPart)).toThrow(
      "already registered",
    );
    expect(() =>
      createSceneBuilder()
        .addAssembly({
          id: 1,
          name: "root",
          placements: [
            {
              kind: "part",
              placementId: "missing-part",
              partId: 2,
              transform: new Float32Array(16),
            },
          ],
        })
        .setRootAssembly(1)
        .build(),
    ).toThrow("references missing part 2");
  });

  it("rejects placements without an explicit stable identity", () => {
    expect(() =>
      createSceneBuilder()
        .addPart(emptyPart(1))
        .addAssembly({
          id: 1,
          name: "root",
          placements: [
            { kind: "part", partId: 1, transform: new Float32Array(16) } as unknown as Placement,
          ],
        })
        .setRootAssembly(1)
        .build(),
    ).toThrow("placement 0 id must be a non-empty string without '/'");
  });

  it("rejects cyclic assembly hierarchies", () => {
    expect(() =>
      createSceneBuilder()
        .addAssembly({
          id: 1,
          name: "one",
          placements: [
            {
              kind: "assembly",
              placementId: "child",
              assemblyId: 2,
              transform: new Float32Array(16),
            },
          ],
        })
        .addAssembly({
          id: 2,
          name: "two",
          placements: [
            {
              kind: "assembly",
              placementId: "parent",
              assemblyId: 1,
              transform: new Float32Array(16),
            },
          ],
        })
        .setRootAssembly(1)
        .build(),
    ).toThrow("contains a cycle");
  });
});
