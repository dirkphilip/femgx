import { describe, expect, it } from "vitest";
import {
  part,
  buildScene,
  structuralScene,
  sceneWithPlacement,
  identity,
  translation,
  type Scene,
  createPackedSceneRuntime,
} from "./support";

describe("createPackedSceneRuntime", () => {
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
        /AssemblyDefinition id NaN/,
      ],
      [
        "mismatched part registry key",
        () => structuralScene({ parts: new Map([[2, part(1)]]) }),
        /Part registry key 2 does not match part id 1/,
      ],
      [
        "mismatched assembly registry key",
        () => structuralScene({ assemblies: new Map([[2, { id: 1, placements: [] }]]) }),
        /AssemblyDefinition registry key 2 does not match assembly id 1/,
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
