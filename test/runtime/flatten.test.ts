import { describe, expect, it } from "vitest";
import { flattenAssembly, type FlattenOptions } from "../../src/runtime/flatten";
import { translation } from "../../src/math/mat4";
import type { Assembly } from "../../src/scene/assembly";

function options(overrides: Partial<FlattenOptions>): FlattenOptions {
  return {
    assemblyId: 1,
    assemblies: new Map(),
    visibleAssemblyIds: new Set([1]),
    visiblePartIds: new Set([1, 2]),
    ...overrides,
  };
}

function assembly(id: number, placements: Assembly["placements"]): Assembly {
  return { id, placements };
}

describe("flattenAssembly", () => {
  it("flattens part placements into instances", () => {
    const assemblies = new Map([
      [
        1,
        assembly(1, [
          { kind: "part", partId: 1, transform: translation(1, 0, 0) },
          { kind: "part", partId: 2, transform: translation(2, 0, 0) },
        ]),
      ],
    ]);
    const instances = flattenAssembly(options({ assemblies }));
    expect(instances).toHaveLength(2);
    expect(instances[0]).toMatchObject({ index: 0, partId: 1 });
    expect(instances[1]).toMatchObject({ index: 1, partId: 2 });
    expect(instances[0]?.worldTransform[12]).toBe(1);
    expect(instances[1]?.worldTransform[12]).toBe(2);
  });

  it("culls instances of hidden parts", () => {
    const assemblies = new Map([
      [
        1,
        assembly(1, [
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
          { kind: "part", partId: 2, transform: translation(0, 0, 0) },
        ]),
      ],
    ]);
    const instances = flattenAssembly(options({ assemblies, visiblePartIds: new Set([2]) }));
    expect(instances).toHaveLength(1);
    expect(instances[0]?.partId).toBe(2);
  });

  it("culls hidden assemblies and everything beneath them", () => {
    const assemblies = new Map([
      [1, assembly(1, [{ kind: "assembly", assemblyId: 2, transform: translation(0, 0, 0) }])],
      [2, assembly(2, [{ kind: "part", partId: 1, transform: translation(0, 0, 0) }])],
    ]);
    const instances = flattenAssembly(options({ assemblies, visibleAssemblyIds: new Set([1]) }));
    expect(instances).toHaveLength(0);
  });

  it("composes nested transforms depth-first", () => {
    const assemblies = new Map([
      [1, assembly(1, [{ kind: "assembly", assemblyId: 2, transform: translation(10, 0, 0) }])],
      [2, assembly(2, [{ kind: "part", partId: 1, transform: translation(1, 0, 0) }])],
    ]);
    const instances = flattenAssembly(options({ assemblies, visibleAssemblyIds: new Set([1, 2]) }));
    expect(instances).toHaveLength(1);
    expect(instances[0]?.worldTransform[12]).toBe(11);
  });

  it("produces stable deterministic ordering", () => {
    const assemblies = new Map([
      [
        1,
        assembly(1, [
          { kind: "part", partId: 2, transform: translation(0, 0, 0) },
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
        ]),
      ],
    ]);
    const first = flattenAssembly(options({ assemblies }));
    const second = flattenAssembly(options({ assemblies }));
    expect(first.map((i) => i.partId)).toEqual([2, 1]);
    expect(first.map((i) => i.partId)).toEqual(second.map((i) => i.partId));
  });

  it("keeps placement handles stable when an earlier instance is hidden", () => {
    const assemblies = new Map([
      [
        1,
        assembly(1, [
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
          { kind: "part", partId: 2, transform: translation(0, 0, 0) },
        ]),
      ],
    ]);
    const visible = flattenAssembly(options({ assemblies }));
    const hidden = flattenAssembly(options({ assemblies, visiblePartIds: new Set([2]) }));
    expect(visible[1]?.instanceId).toBe(hidden[0]?.instanceId);
    expect(hidden[0]?.index).toBe(0);
  });

  it("walks deeply nested hierarchies without recursion", () => {
    const assemblies = new Map<number, Assembly>();
    const depth = 5_000;
    for (let id = depth; id >= 1; id -= 1) {
      assemblies.set(
        id,
        assembly(
          id,
          id === depth
            ? [{ kind: "part", partId: 1, transform: translation(1, 0, 0) }]
            : [{ kind: "assembly", assemblyId: id + 1, transform: translation(1, 0, 0) }],
        ),
      );
    }
    const instances = flattenAssembly(
      options({ assemblyId: 1, assemblies, visibleAssemblyIds: new Set(assemblies.keys()) }),
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]?.worldTransform[12]).toBe(depth);
  });
});
