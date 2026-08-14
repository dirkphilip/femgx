import { describe, expect, it } from "vitest";
import type { Assembly, Placement } from "../../src/scene/assembly";
import { identity, translation } from "../../src/math/mat4";
import { createPart, MAX_PART_ID, type Part } from "../../src/geometry/part";
import { createScene, type Scene } from "../../src/scene/scene";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";

function part(id: number): Part {
  const geometry = {
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint32Array(),
    primitive: "triangles" as const,
  };
  return createPart(id, geometry);
}

function buildScene(
  rootAssemblyId: number,
  assemblies: readonly Assembly[],
  parts: readonly number[],
  hiddenPartIds: readonly number[] = [],
  hiddenAssemblyIds: readonly number[] = [],
): Scene {
  let builder = createScene();
  for (const id of parts) {
    builder = builder.addPart(part(id));
  }
  for (const assembly of assemblies) {
    builder = builder.addAssembly({
      id: assembly.id,
      name: `assembly-${assembly.id}`,
      placements: assembly.placements,
    });
  }
  for (const id of hiddenPartIds) {
    builder = builder.hidePart(id);
  }
  for (const id of hiddenAssemblyIds) {
    builder = builder.hideAssembly(id);
  }
  return builder.withRoot(rootAssemblyId).build();
}

function structuralScene(overrides: Partial<Scene> = {}): Scene {
  return {
    rootAssemblyId: 1,
    parts: new Map([[1, part(1)]]),
    assemblies: new Map([
      [1, { id: 1, placements: [{ kind: "part", partId: 1, transform: identity() }] }],
    ]),
    visiblePartIds: new Set([1]),
    visibleAssemblyIds: new Set([1]),
    ...overrides,
  };
}

function sceneWithPlacement(placement: Placement): Scene {
  return structuralScene({
    assemblies: new Map([[1, { id: 1, placements: [placement] }]]),
  });
}

describe("createPackedSceneRuntime", () => {
  it("preserves the largest supported part id in packed runtime and grouping", () => {
    const scene = buildScene(
      1,
      [{ id: 1, placements: [{ kind: "part", partId: MAX_PART_ID, transform: identity() }] }],
      [MAX_PART_ID],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.instancePartIds[0]).toBe(MAX_PART_ID);
    expect(runtime.sortedPartIds[0]).toBe(MAX_PART_ID);
    expect(runtime.getPartId(0)).toBe(MAX_PART_ID);
  });

  it("compiles parts, nested assemblies, and composed transforms", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: translation(10, 0, 0) },
            { kind: "assembly", assemblyId: 2, transform: translation(100, 0, 0) },
          ],
        },
        { id: 2, placements: [{ kind: "part", partId: 2, transform: translation(1, 0, 0) }] },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.instanceCount).toBe(2);
    expect(runtime.nodeCount).toBe(2);
    expect(runtime).not.toHaveProperty("instanceLocalTransforms");
    expect(runtime).not.toHaveProperty("nodeLocalTransforms");
    expect(runtime).not.toHaveProperty("nodeWorldTransforms");
    expect(Array.from(runtime.instancePartIds)).toEqual([1, 2]);
    expect(runtime.getTransform(0)?.[12]).toBe(10);
    expect(runtime.getTransform(1)?.[12]).toBe(101);
    expect(runtime.visibleCount).toBe(2);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1]);
  });

  it("assigns stable slots to hidden placements too", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: identity() },
            { kind: "part", partId: 2, transform: identity() },
          ],
        },
      ],
      [1, 2],
      [2],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.instanceCount).toBe(2);
    expect(runtime.visibleCount).toBe(1);
    expect(runtime.isInstanceVisible(0)).toBe(true);
    expect(runtime.isInstanceVisible(1)).toBe(false);
    expect(Array.from(runtime.getDrawList())).toEqual([0]);
    expect(runtime.getPartId(1)).toBe(2);
  });

  it("hides and shows a part with deltas that keep instance ids stable", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: translation(1, 0, 0) },
            { kind: "part", partId: 1, transform: translation(2, 0, 0) },
            { kind: "part", partId: 1, transform: translation(3, 0, 0) },
          ],
        },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1, 2]);

    const hidden = runtime.setPartVisible(1, false);
    expect(hidden.changedInstanceIds).toEqual([0, 1, 2]);
    expect(hidden.previousVisibleCount).toBe(3);
    expect(hidden.visibleCount).toBe(0);
    expect(runtime.visibleCount).toBe(0);
    expect(runtime.isInstanceVisible(0)).toBe(false);
    expect(runtime.isInstanceVisible(1)).toBe(false);

    const shown = runtime.setPartVisible(1, true);
    expect(shown.changedInstanceIds).toEqual([0, 1, 2]);
    expect(shown.visibleCount).toBe(3);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1, 2]);
    expect(runtime.getPartId(0)).toBe(1);
    expect(runtime.getTransform(0)?.[12]).toBe(1);
  });

  it("culls a nested assembly subtree and reports it as one delta", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: identity() },
            { kind: "assembly", assemblyId: 2, transform: identity() },
            { kind: "part", partId: 4, transform: identity() },
          ],
        },
        {
          id: 2,
          placements: [
            { kind: "part", partId: 2, transform: identity() },
            { kind: "assembly", assemblyId: 3, transform: identity() },
          ],
        },
        { id: 3, placements: [{ kind: "part", partId: 3, transform: identity() }] },
      ],
      [1, 2, 3, 4],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(Array.from(runtime.instancePartIds)).toEqual([1, 2, 3, 4]);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1, 2, 3]);

    const delta = runtime.setAssemblyVisible(2, false);
    expect(delta.changedInstanceIds).toEqual([1, 2]);
    expect(delta.visibleCount).toBe(2);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 3]);

    const restored = runtime.setAssemblyVisible(2, true);
    expect(restored.changedInstanceIds).toEqual([1, 2]);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1, 2, 3]);
  });

  it("requires every ancestor to be visible for an instance to appear", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: identity() },
            { kind: "assembly", assemblyId: 2, transform: identity() },
          ],
        },
        { id: 2, placements: [{ kind: "assembly", assemblyId: 3, transform: identity() }] },
        { id: 3, placements: [{ kind: "part", partId: 2, transform: identity() }] },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1]);

    expect(runtime.setAssemblyVisible(3, false).changedInstanceIds).toEqual([1]);
    expect(runtime.setAssemblyVisible(2, false).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyVisible(2, true).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyVisible(3, true).changedInstanceIds).toEqual([1]);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1]);
  });

  it("keeps a part hidden while its assembly is hidden", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: identity() },
            { kind: "assembly", assemblyId: 2, transform: identity() },
          ],
        },
        { id: 2, placements: [{ kind: "part", partId: 2, transform: identity() }] },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.setAssemblyVisible(2, false).changedInstanceIds).toEqual([1]);
    expect(runtime.setPartVisible(2, true).changedInstanceIds).toEqual([]);
    expect(runtime.visibleCount).toBe(1);
    expect(runtime.setPartVisible(2, false).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyVisible(2, true).changedInstanceIds).toEqual([]);
    expect(runtime.visibleCount).toBe(1);
    expect(runtime.setPartVisible(2, true).changedInstanceIds).toEqual([1]);
    expect(runtime.visibleCount).toBe(2);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1]);
  });

  it("updates only a single instance with setInstanceVisible", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: translation(1, 0, 0) },
            { kind: "part", partId: 1, transform: translation(2, 0, 0) },
            { kind: "part", partId: 1, transform: translation(3, 0, 0) },
          ],
        },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    const delta = runtime.setInstanceVisible(1, false);
    expect(delta.changedInstanceIds).toEqual([1]);
    expect(delta.visibleCount).toBe(2);
    expect(runtime.isInstanceVisible(1)).toBe(false);
    expect(runtime.isInstanceVisible(0)).toBe(true);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 2]);
    expect(runtime.setInstanceVisible(1, true).changedInstanceIds).toEqual([1]);
    expect(runtime.visibleCount).toBe(3);
  });

  it("updates only one occurrence of a repeated assembly", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "assembly", assemblyId: 2, transform: identity() },
            { kind: "assembly", assemblyId: 2, transform: identity() },
          ],
        },
        { id: 2, placements: [{ kind: "part", partId: 1, transform: identity() }] },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.nodeAssemblyIds).toEqual(new Uint32Array([1, 2, 2]));

    expect(runtime.setAssemblyNodeVisible(1, false)).toMatchObject({
      changedInstanceIds: [0],
      visibleCount: 1,
    });
    expect(runtime.isInstanceVisible(0)).toBe(false);
    expect(runtime.isInstanceVisible(1)).toBe(true);
    expect(runtime.setAssemblyNodeVisible(1, true).changedInstanceIds).toEqual([0]);
  });

  it("returns empty deltas for out-of-range or no-op updates", () => {
    const scene = buildScene(
      1,
      [{ id: 1, placements: [{ kind: "part", partId: 1, transform: identity() }] }],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.setPartVisible(1, true).changedInstanceIds).toEqual([]);
    expect(runtime.setPartVisible(999, true).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyVisible(999, true).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyVisible(1, true).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyNodeVisible(0, true).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyNodeVisible(99, false).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyNodeVisible(-1, false).changedInstanceIds).toEqual([]);
    expect(runtime.setInstanceVisible(0, true).changedInstanceIds).toEqual([]);
    expect(runtime.setInstanceVisible(99, false).changedInstanceIds).toEqual([]);
    expect(runtime.setInstanceVisible(-1, false).changedInstanceIds).toEqual([]);
    expect(runtime.getPartId(99)).toBeUndefined();
    expect(runtime.getTransform(99)).toBeUndefined();
    expect(runtime.isInstanceVisible(99)).toBe(false);
  });

  it("preserves deterministic draw order across hide/show round trips", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 2, transform: identity() },
            { kind: "part", partId: 1, transform: identity() },
            { kind: "assembly", assemblyId: 2, transform: identity() },
          ],
        },
        { id: 2, placements: [{ kind: "part", partId: 3, transform: identity() }] },
      ],
      [1, 2, 3],
    );
    const runtime = createPackedSceneRuntime(scene);
    const initial = Array.from(runtime.getDrawList());
    runtime.setPartVisible(1, false);
    runtime.setAssemblyVisible(2, false);
    runtime.setPartVisible(1, true);
    runtime.setAssemblyVisible(2, true);
    expect(Array.from(runtime.getDrawList())).toEqual(initial);
  });

  it("keeps depth-first slot and draw ordering deterministic", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 2, transform: translation(1, 0, 0) },
            { kind: "assembly", assemblyId: 2, transform: translation(0, 0, 0) },
            { kind: "part", partId: 1, transform: translation(2, 0, 0) },
          ],
        },
        { id: 2, placements: [{ kind: "part", partId: 3, transform: translation(0, 0, 0) }] },
      ],
      [1, 2, 3],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1, 2]);
    expect(Array.from(runtime.instancePartIds)).toEqual([2, 3, 1]);
    expect(runtime.getInstanceId(0)).toBe("1/0");
    expect(runtime.getInstanceId(1)).toBe("1/1/0");
    expect(runtime.getInstanceId(2)).toBe("1/2");
  });

  it("keeps authoring placement handles stable and hidden slots resolvable", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: translation(1, 0, 0) },
            { kind: "assembly", assemblyId: 2, transform: identity() },
          ],
        },
        { id: 2, placements: [{ kind: "part", partId: 2, transform: identity() }] },
      ],
      [1, 2],
      [2],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.getInstanceId(0)).toBe("1/0");
    expect(runtime.getInstanceId(1)).toBe("1/1/0");
    expect(runtime.getInstanceId(2)).toBeUndefined();
    runtime.setAssemblyVisible(2, false);
    runtime.setInstanceVisible(0, false);
    expect(runtime.getInstanceId(0)).toBe("1/0");
    expect(runtime.getInstanceId(1)).toBe("1/1/0");
  });

  it("keeps explicit placement handles stable across reorder and transform edits", () => {
    const first = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", placementId: "left", partId: 1, transform: translation(1, 0, 0) },
            { kind: "part", placementId: "right", partId: 2, transform: translation(2, 0, 0) },
          ],
        },
      ],
      [1, 2],
    );
    const reordered = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", placementId: "right", partId: 2, transform: translation(20, 0, 0) },
            { kind: "part", placementId: "left", partId: 1, transform: translation(10, 0, 0) },
          ],
        },
      ],
      [1, 2],
    );
    const firstRuntime = createPackedSceneRuntime(first);
    const nextRuntime = createPackedSceneRuntime(reordered);

    expect(firstRuntime.getInstanceSlot("1/left")).toBe(0);
    expect(firstRuntime.getInstanceSlot("1/right")).toBe(1);
    expect(nextRuntime.getInstanceSlot("1/right")).toBe(0);
    expect(nextRuntime.getInstanceSlot("1/left")).toBe(1);
    expect(nextRuntime.getTransform(nextRuntime.getInstanceSlot("1/left") ?? -1)?.[12]).toBe(10);
    expect(nextRuntime.getTransform(nextRuntime.getInstanceSlot("1/right") ?? -1)?.[12]).toBe(20);
  });

  it("rejects malformed structural scenes before packing", () => {
    const nonFiniteTransform = identity();
    nonFiniteTransform[3] = Number.NaN;
    const cases: readonly [string, () => Scene, RegExp][] = [
      [
        "invalid root",
        () => structuralScene({ rootAssemblyId: Number.NaN }),
        /Scene root assembly id/,
      ],
      [
        "invalid placement identity",
        () =>
          sceneWithPlacement({
            kind: "part",
            partId: 1,
            placementId: "invalid/id",
            transform: identity(),
          }),
        /placement 0 id must be a non-empty string without '\/'/,
      ],
      [
        "invalid assembly identity",
        () =>
          structuralScene({
            assemblies: new Map([[Number.NaN, { id: Number.NaN, placements: [] }]]),
          }),
        /Assembly id NaN/,
      ],
      [
        "mismatched part registry key",
        () => structuralScene({ parts: new Map([[2, part(1)]]) }),
        /Part registry key 2 does not match part id 1/,
      ],
      [
        "mismatched assembly registry key",
        () => structuralScene({ assemblies: new Map([[2, { id: 1, placements: [] }]]) }),
        /Assembly registry key 2 does not match assembly id 1/,
      ],
      [
        "unsupported placement kind",
        () => sceneWithPlacement({ kind: "mesh", transform: identity() } as never),
        /unsupported kind mesh/,
      ],
      [
        "missing part reference",
        () => sceneWithPlacement({ kind: "part", partId: 99, transform: identity() }),
        /references missing part 99/,
      ],
      [
        "missing assembly reference",
        () => sceneWithPlacement({ kind: "assembly", assemblyId: 99, transform: identity() }),
        /references missing assembly 99/,
      ],
      [
        "short transform",
        () => sceneWithPlacement({ kind: "part", partId: 1, transform: new Float32Array(15) }),
        /transform must contain exactly 16 components/,
      ],
      [
        "non-finite transform",
        () => sceneWithPlacement({ kind: "part", partId: 1, transform: nonFiniteTransform }),
        /transform component 3 must be finite/,
      ],
      [
        "unknown visible part",
        () => structuralScene({ visiblePartIds: new Set([2]) }),
        /Visible part 2 is not registered/,
      ],
      [
        "unknown visible assembly",
        () => structuralScene({ visibleAssemblyIds: new Set([2]) }),
        /Visible assembly 2 is not registered/,
      ],
      [
        "cyclic hierarchy",
        () =>
          structuralScene({
            assemblies: new Map([
              [
                1,
                { id: 1, placements: [{ kind: "assembly", assemblyId: 2, transform: identity() }] },
              ],
              [
                2,
                { id: 2, placements: [{ kind: "assembly", assemblyId: 1, transform: identity() }] },
              ],
            ]),
          }),
        /contains a cycle/,
      ],
    ];

    for (const [name, create, message] of cases) {
      expect(() => createPackedSceneRuntime(create()), name).toThrow(message);
    }
  });

  it("handles an assembly placed more than once as separate expansions", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "assembly", assemblyId: 2, transform: identity() },
            { kind: "assembly", assemblyId: 2, transform: identity() },
          ],
        },
        { id: 2, placements: [{ kind: "part", partId: 1, transform: identity() }] },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.instanceCount).toBe(2);
    expect(runtime.nodeCount).toBe(3);
    expect(runtime.setAssemblyVisible(2, false).changedInstanceIds).toEqual([0, 1]);
    expect(runtime.visibleCount).toBe(0);
  });

  it("hiding the root assembly hides everything", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: identity() },
            { kind: "assembly", assemblyId: 2, transform: identity() },
          ],
        },
        { id: 2, placements: [{ kind: "part", partId: 2, transform: identity() }] },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.setAssemblyVisible(1, false).changedInstanceIds).toEqual([0, 1]);
    expect(runtime.visibleCount).toBe(0);
    expect(runtime.setAssemblyVisible(1, true).changedInstanceIds).toEqual([0, 1]);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1]);
  });

  it("keeps draw order and visibility deltas stable across visibility edits", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: translation(1, 0, 0) },
            { kind: "part", partId: 1, transform: translation(2, 0, 0) },
            { kind: "part", partId: 1, transform: translation(3, 0, 0) },
          ],
        },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    const initial = Array.from(runtime.getDrawList());
    expect(initial).toEqual([0, 1, 2]);
    expect(Array.from(runtime.getDrawList())).toEqual(initial);
    expect(runtime.setInstanceVisible(1, false).changedInstanceIds).toEqual([1]);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 2]);
    expect(runtime.setInstanceVisible(1, true).changedInstanceIds).toEqual([1]);
    expect(Array.from(runtime.getDrawList())).toEqual(initial);
  });
});
