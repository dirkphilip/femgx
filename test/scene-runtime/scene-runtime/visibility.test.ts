import { describe, expect, it } from "vitest";
import { buildScene, identity, translation, createPackedSceneRuntime } from "./support";

describe("createPackedSceneRuntime", () => {
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
    expect(hidden.affectedPartIds).toEqual([1]);
    expect(hidden.previousVisibleCount).toBe(3);
    expect(hidden.visibleCount).toBe(0);
    expect(runtime.visibleCount).toBe(0);
    expect(runtime.isInstanceVisible(0)).toBe(false);
    expect(runtime.isInstanceVisible(1)).toBe(false);

    const shown = runtime.setPartVisible(1, true);
    expect(shown.affectedPartIds).toEqual([1]);
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
    expect(delta.affectedPartIds).toEqual([2, 3]);
    expect(delta.visibleCount).toBe(2);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 3]);

    const restored = runtime.setAssemblyVisible(2, true);
    expect(restored.affectedPartIds).toEqual([2, 3]);
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

    expect(runtime.setAssemblyVisible(3, false).affectedPartIds).toEqual([2]);
    expect(runtime.setAssemblyVisible(2, false).affectedPartIds).toEqual([]);
    expect(runtime.setAssemblyVisible(2, true).affectedPartIds).toEqual([]);
    expect(runtime.setAssemblyVisible(3, true).affectedPartIds).toEqual([2]);
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
    expect(runtime.setAssemblyVisible(2, false).affectedPartIds).toEqual([2]);
    expect(runtime.setPartVisible(2, true).affectedPartIds).toEqual([]);
    expect(runtime.visibleCount).toBe(1);
    expect(runtime.setPartVisible(2, false).affectedPartIds).toEqual([]);
    expect(runtime.setAssemblyVisible(2, true).affectedPartIds).toEqual([]);
    expect(runtime.visibleCount).toBe(1);
    expect(runtime.setPartVisible(2, true).affectedPartIds).toEqual([2]);
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
    expect(delta.affectedPartIds).toEqual([1]);
    expect(delta.visibleCount).toBe(2);
    expect(runtime.isInstanceVisible(1)).toBe(false);
    expect(runtime.isInstanceVisible(0)).toBe(true);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 2]);
    expect(runtime.setInstanceVisible(1, true).affectedPartIds).toEqual([1]);
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
      affectedPartIds: [1],
      visibleCount: 1,
    });
    expect(runtime.isInstanceVisible(0)).toBe(false);
    expect(runtime.isInstanceVisible(1)).toBe(true);
    expect(runtime.setAssemblyNodeVisible(1, true).affectedPartIds).toEqual([1]);
  });

  it("combines four independent definition and occurrence causes", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [{ kind: "assembly", assemblyId: 2, transform: identity() }],
        },
        { id: 2, placements: [{ kind: "part", partId: 1, transform: identity() }] },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);

    runtime.setPartVisible(1, false);
    runtime.setInstanceVisible(0, false);
    runtime.setAssemblyNodeVisible(1, false);
    runtime.setAssemblyVisible(2, false);
    runtime.setAssemblyVisible(2, true);
    expect(runtime.isInstanceVisible(0)).toBe(false);

    runtime.setAssemblyNodeVisible(1, true);
    expect(runtime.isInstanceVisible(0)).toBe(false);
    runtime.setPartVisible(1, true);
    expect(runtime.isInstanceVisible(0)).toBe(false);
    runtime.setInstanceVisible(0, true);
    expect(runtime.isInstanceVisible(0)).toBe(true);
  });

  it("returns empty deltas for out-of-range or no-op updates", () => {
    const scene = buildScene(
      1,
      [{ id: 1, placements: [{ kind: "part", partId: 1, transform: identity() }] }],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.setPartVisible(1, true).affectedPartIds).toEqual([]);
    expect(runtime.setPartVisible(999, true).affectedPartIds).toEqual([]);
    expect(runtime.setAssemblyVisible(999, true).affectedPartIds).toEqual([]);
    expect(runtime.setAssemblyVisible(1, true).affectedPartIds).toEqual([]);
    expect(runtime.setAssemblyNodeVisible(0, true).affectedPartIds).toEqual([]);
    expect(runtime.setAssemblyNodeVisible(99, false).affectedPartIds).toEqual([]);
    expect(runtime.setAssemblyNodeVisible(-1, false).affectedPartIds).toEqual([]);
    expect(runtime.setInstanceVisible(0, true).affectedPartIds).toEqual([]);
    expect(runtime.setInstanceVisible(99, false).affectedPartIds).toEqual([]);
    expect(runtime.setInstanceVisible(-1, false).affectedPartIds).toEqual([]);
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
});
