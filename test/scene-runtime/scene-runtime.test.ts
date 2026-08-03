import { describe, expect, it } from "vitest";
import type { Assembly } from "../../src/scene/assembly";
import { flattenAssembly } from "../../src/runtime/flatten";
import { identity, translation } from "../../src/math/mat4";
import { computeBounds, type Part } from "../../src/geometry/part";
import { createScene, type Scene } from "../../src/scene/scene";
import { createSceneRuntime } from "../../src/scene-runtime/runtime";

function part(id: number): Part {
  const geometry = { positions: new Float32Array([0, 0, 0]), indices: new Uint32Array() };
  return { id, geometry, bounds: computeBounds(geometry) };
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

describe("createSceneRuntime", () => {
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
    const runtime = createSceneRuntime(scene);
    expect(runtime.instanceCount).toBe(2);
    expect(runtime.nodeCount).toBe(2);
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
    const runtime = createSceneRuntime(scene);
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
    const runtime = createSceneRuntime(scene);
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
    const runtime = createSceneRuntime(scene);
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
    const runtime = createSceneRuntime(scene);
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
    const runtime = createSceneRuntime(scene);
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
    const runtime = createSceneRuntime(scene);
    const delta = runtime.setInstanceVisible(1, false);
    expect(delta.changedInstanceIds).toEqual([1]);
    expect(delta.visibleCount).toBe(2);
    expect(runtime.isInstanceVisible(1)).toBe(false);
    expect(runtime.isInstanceVisible(0)).toBe(true);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 2]);
    expect(runtime.setInstanceVisible(1, true).changedInstanceIds).toEqual([1]);
    expect(runtime.visibleCount).toBe(3);
  });

  it("returns empty deltas for out-of-range or no-op updates", () => {
    const scene = buildScene(
      1,
      [{ id: 1, placements: [{ kind: "part", partId: 1, transform: identity() }] }],
      [1],
    );
    const runtime = createSceneRuntime(scene);
    expect(runtime.setPartVisible(1, true).changedInstanceIds).toEqual([]);
    expect(runtime.setPartVisible(999, true).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyVisible(999, true).changedInstanceIds).toEqual([]);
    expect(runtime.setAssemblyVisible(1, true).changedInstanceIds).toEqual([]);
    expect(runtime.setInstanceVisible(0, true).changedInstanceIds).toEqual([]);
    expect(runtime.setInstanceVisible(99, false).changedInstanceIds).toEqual([]);
    expect(runtime.setInstanceVisible(-1, false).changedInstanceIds).toEqual([]);
    expect(runtime.getPartId(99)).toBeUndefined();
    expect(runtime.getTransform(99)).toBeUndefined();
    expect(runtime.isInstanceVisible(99)).toBe(false);
  });

  it("updates a single instance transform without touching others", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", partId: 1, transform: translation(1, 0, 0) },
            { kind: "part", partId: 1, transform: translation(2, 0, 0) },
          ],
        },
      ],
      [1],
    );
    const runtime = createSceneRuntime(scene);
    expect(runtime.setInstanceTransform(1, translation(50, 0, 0))).toBe(true);
    expect(runtime.setInstanceTransform(99, translation(0, 0, 0))).toBe(false);
    expect(runtime.getTransform(1)?.[12]).toBe(50);
    expect(runtime.getTransform(0)?.[12]).toBe(1);
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
    const runtime = createSceneRuntime(scene);
    const initial = Array.from(runtime.getDrawList());
    runtime.setPartVisible(1, false);
    runtime.setAssemblyVisible(2, false);
    runtime.setPartVisible(1, true);
    runtime.setAssemblyVisible(2, true);
    expect(Array.from(runtime.getDrawList())).toEqual(initial);
  });

  it("matches flattenAssembly ordering for the visible subset", () => {
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
    const runtime = createSceneRuntime(scene);
    const flattened = flattenAssembly({
      assemblyId: scene.rootAssemblyId,
      assemblies: scene.assemblies,
      visibleAssemblyIds: scene.visibleAssemblyIds,
      visiblePartIds: scene.visiblePartIds,
    });
    expect(flattened.map((instance) => instance.index)).toEqual(Array.from(runtime.getDrawList()));
    expect(flattened.map((instance) => instance.partId)).toEqual(
      Array.from(runtime.instancePartIds).slice(0, flattened.length),
    );
  });

  it("skips missing assembly references in an unvalidated scene", () => {
    const scene: Scene = {
      rootAssemblyId: 1,
      parts: new Map(),
      assemblies: new Map([
        [1, { id: 1, placements: [{ kind: "assembly", assemblyId: 99, transform: identity() }] }],
      ]),
      visiblePartIds: new Set(),
      visibleAssemblyIds: new Set([1]),
    };
    const runtime = createSceneRuntime(scene);
    expect(runtime.nodeCount).toBe(1);
    expect(runtime.instanceCount).toBe(0);
    expect(runtime.visibleCount).toBe(0);
    expect(runtime.getDrawList()).toHaveLength(0);
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
    const runtime = createSceneRuntime(scene);
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
    const runtime = createSceneRuntime(scene);
    expect(runtime.setAssemblyVisible(1, false).changedInstanceIds).toEqual([0, 1]);
    expect(runtime.visibleCount).toBe(0);
    expect(runtime.setAssemblyVisible(1, true).changedInstanceIds).toEqual([0, 1]);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1]);
  });
});
