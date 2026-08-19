import { describe, expect, it } from "vitest";

import { createPart } from "../../src/geometry/part";
import { identity, translation } from "../../src/math/mat4";
import { createScene } from "../../src/scene/scene";
import {
  prepareSceneTransition,
  prepareSceneUpdate,
  type SceneUpdate,
} from "../../src/scene/update";

const firstPart = createPart(1, {
  geometries: [
    {
      primitive: "points",
      positions: new Float32Array([0, 0, 0]),
      indices: new Uint32Array([0]),
    },
  ],
});

const secondPart = createPart(2, {
  geometries: [
    {
      primitive: "points",
      positions: new Float32Array([1, 0, 0]),
      indices: new Uint32Array([0]),
    },
  ],
});

function scene() {
  return createScene()
    .addPart(firstPart)
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        { kind: "part", placementId: "first", partId: firstPart.id, transform: identity() },
      ],
    })
    .withRoot(1)
    .build();
}

describe("prepareSceneUpdate", () => {
  it("prepares stable-identity structural changes without exposing runtime slots", () => {
    const source = scene();
    const prepared = prepareSceneTransition(source, (update) => {
      update.addPart(secondPart);
      update.rebindPartOccurrence({ assemblyId: 1, placementId: "first", partId: 2 });
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "added",
        partId: 1,
        transform: translation(2, 0, 0),
      });
    });

    expect([...(prepared?.changes.parts.added ?? [])]).toEqual([2]);
    expect(prepared?.changes.assemblies.replaced.size).toBe(0);
    const rebound = prepared?.changes.placements[0];
    expect(rebound?.ownerAssemblyId).toBe(1);
    expect(rebound?.before).toBe(source.assemblies.get(1)?.placements[0]);
    expect(rebound?.after).toMatchObject({ kind: "part", placementId: "first", partId: 2 });
    const added = prepared?.changes.placements[1];
    expect(added?.ownerAssemblyId).toBe(1);
    expect(added?.before).toBeUndefined();
    expect(added?.after).toMatchObject({ kind: "part", placementId: "added", partId: 1 });
  });

  it("adds and edits placements while retaining untouched definitions", () => {
    const source = scene();
    const next = prepareSceneUpdate(source, (update) => {
      update.addPart(secondPart);
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "second",
        partId: secondPart.id,
        transform: translation(2, 0, 0),
      });
      update.setPartOccurrenceTransform({
        assemblyId: 1,
        placementId: "first",
        transform: translation(1, 0, 0),
      });
    });

    expect(next?.parts.get(1)).toBe(firstPart);
    expect(next?.parts.get(2)).toBe(secondPart);
    expect(next?.assemblies.get(1)?.placements).toHaveLength(2);
    expect(source.parts.size).toBe(1);
    expect(source.assemblies.get(1)?.placements).toHaveLength(1);
  });

  it("removes a part and every authoring occurrence only when requested", () => {
    const source = scene();
    expect(() =>
      prepareSceneUpdate(source, (update) => {
        update.removePart(1);
      }),
    ).toThrow(/still referenced/);

    const next = prepareSceneUpdate(source, (update) => {
      update.removePart(1, { occurrences: "remove" });
    });

    expect(next?.parts.has(1)).toBe(false);
    expect(next?.assemblies.get(1)?.placements).toEqual([]);
  });

  it("rebinds and removes explicitly identified authoring placements", () => {
    const source = scene();
    const rebound = prepareSceneUpdate(source, (update) => {
      update.addPart(secondPart);
      update.rebindPartOccurrence({ assemblyId: 1, placementId: "first", partId: 2 });
    });
    expect(rebound?.assemblies.get(1)?.placements[0]).toMatchObject({ partId: 2 });

    const removed = prepareSceneUpdate(rebound ?? source, (update) => {
      update.removePartOccurrence({ assemblyId: 1, placementId: "first" });
    });
    expect(removed?.assemblies.get(1)?.placements).toEqual([]);
  });

  it("edits and removes child-assembly definitions and occurrences", () => {
    const nested = prepareSceneUpdate(scene(), (update) => {
      update.addAssembly({ id: 2, name: "first child", placements: [] });
      update.addAssembly({ id: 3, name: "second child", placements: [] });
      update.replaceAssembly({ id: 2, name: "renamed child", placements: [] });
      update.addAssemblyOccurrence({
        parentAssemblyId: 1,
        placementId: "child",
        assemblyId: 2,
        transform: identity(),
      });
      update.rebindAssemblyOccurrence({
        parentAssemblyId: 1,
        placementId: "child",
        assemblyId: 3,
      });
      update.setAssemblyOccurrenceTransform({
        parentAssemblyId: 1,
        placementId: "child",
        transform: translation(4, 0, 0),
      });
    });
    if (nested === undefined) throw new Error("expected a scene revision");
    expect(nested.assemblies.get(1)?.placements[1]).toMatchObject({ assemblyId: 3 });
    expect(() =>
      prepareSceneUpdate(nested, (update) => {
        update.removeAssembly(3);
      }),
    ).toThrow(/still referenced/);

    const removed = prepareSceneUpdate(nested, (update) => {
      update.removeAssembly(3, { occurrences: "remove" });
      update.removeAssembly(2);
    });
    expect(removed?.assemblies.has(2)).toBe(false);
    expect(removed?.assemblies.has(3)).toBe(false);
    expect(removed?.assemblies.get(1)?.placements).toHaveLength(1);
    expect(() =>
      prepareSceneUpdate(removed ?? nested, (update) => {
        update.removeAssembly(1);
      }),
    ).toThrow(/root assembly/);
  });

  it("returns no revision for semantic no-ops", () => {
    const source = scene();
    expect(prepareSceneUpdate(source, () => undefined)).toBeUndefined();
    expect(
      prepareSceneUpdate(source, (update) => {
        update.replacePart(firstPart);
        update.rebindPartOccurrence({ assemblyId: 1, placementId: "first", partId: 1 });
        update.setPartOccurrenceTransform({
          assemblyId: 1,
          placementId: "first",
          transform: identity(),
        });
      }),
    ).toBeUndefined();
    expect(
      prepareSceneUpdate(source, (update) => {
        update.setPartOccurrenceTransform({
          assemblyId: 1,
          placementId: "first",
          transform: translation(3, 0, 0),
        });
        update.setPartOccurrenceTransform({
          assemblyId: 1,
          placementId: "first",
          transform: identity(),
        });
      }),
    ).toBeUndefined();
  });

  it("rejects an invalid transform before the transform-only fast path can commit", () => {
    const source = scene();
    const invalid = identity();
    invalid[7] = Number.NaN;

    expect(() =>
      prepareSceneUpdate(source, (update) => {
        update.setPartOccurrenceTransform({
          assemblyId: 1,
          placementId: "first",
          transform: invalid,
        });
      }),
    ).toThrow(/transform component 7 must be finite/);
    expect(source.assemblies.get(1)?.placements[0]?.transform).toEqual(identity());
  });

  it("rejects an invalid added part id at the changed registry boundary", () => {
    const source = scene();

    expect(() =>
      prepareSceneUpdate(source, (update) => {
        update.addPart({ ...secondPart, id: -1 });
      }),
    ).toThrow(/Part id/);
    expect(source.parts.size).toBe(1);
  });

  it("accumulates many edits and can reuse one part definition", () => {
    const source = scene();
    const next = prepareSceneUpdate(source, (update) => {
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "reused",
        partId: 1,
        transform: identity(),
      });
      for (let id = 2; id < 66; id += 1) {
        update.addPart({ ...secondPart, id });
        update.addPartOccurrence({
          assemblyId: 1,
          placementId: `part-${id}`,
          partId: id,
          transform: identity(),
        });
      }
      for (let id = 2; id < 66; id += 2) {
        update.removePart(id, { occurrences: "remove" });
      }
    });

    expect(next?.parts.size).toBe(33);
    expect(next?.assemblies.get(1)?.placements).toHaveLength(34);
    expect(next?.assemblies.get(1)?.placements[0]?.placementId).toBe("first");
  });

  it.each([
    [
      "duplicate placement",
      (update: SceneUpdate) => {
        update.addPartOccurrence({
          assemblyId: 1,
          placementId: "first",
          partId: 1,
          transform: identity(),
        });
      },
    ],
    [
      "malformed placement",
      (update: SceneUpdate) => {
        update.addPartOccurrence({
          assemblyId: 1,
          placementId: "bad/id",
          partId: 1,
          transform: identity(),
        });
      },
    ],
    [
      "missing part",
      (update: SceneUpdate) => {
        update.addPartOccurrence({
          assemblyId: 1,
          placementId: "missing",
          partId: 99,
          transform: identity(),
        });
      },
    ],
    [
      "missing assembly",
      (update: SceneUpdate) => {
        update.addPartOccurrence({
          assemblyId: 99,
          placementId: "missing",
          partId: 1,
          transform: identity(),
        });
      },
    ],
  ] as const)("rejects a %s without publishing partial state", (_label, operation) => {
    const source = scene();
    expect(() => prepareSceneUpdate(source, operation)).toThrow();
    expect(source.parts.size).toBe(1);
    expect(source.assemblies.get(1)?.placements).toHaveLength(1);
  });

  it("closes the transaction after a host callback throws", () => {
    const source = scene();
    let escaped: SceneUpdate | undefined;
    expect(() =>
      prepareSceneUpdate(source, (update) => {
        escaped = update;
        update.addPart(secondPart);
        throw new Error("host failure");
      }),
    ).toThrow("host failure");
    expect(() => escaped?.addPart(secondPart)).toThrow(/no longer active/);
    expect(source.parts.size).toBe(1);
  });

  it("rejects async operations and escaped drafts", async () => {
    const source = scene();
    let escaped: SceneUpdate | undefined;
    expect(() =>
      prepareSceneUpdate(source, async (update) => {
        escaped = update;
        await Promise.resolve();
      }),
    ).toThrow(/synchronous/);
    await Promise.resolve();
    expect(() => escaped?.addPart(secondPart)).toThrow(/no longer active/);
  });

  it("validates the complete candidate before returning it", () => {
    const source = scene();
    expect(() =>
      prepareSceneUpdate(source, (update) => {
        update.addAssembly({
          id: 2,
          placements: [
            { kind: "assembly", placementId: "cycle", assemblyId: 1, transform: identity() },
          ],
        });
        update.addAssemblyOccurrence({
          parentAssemblyId: 1,
          placementId: "child",
          assemblyId: 2,
          transform: identity(),
        });
      }),
    ).toThrow(/cycle/);
    expect(source.assemblies.size).toBe(1);
  });
});
