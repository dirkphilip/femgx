import { describe, expect, it } from "vitest";
import { createPart } from "../../../src/geometry/part";
import {
  createInteractionState,
  setPartOccurrenceOverride,
  setPartOverride,
} from "../../../src/interaction/interaction";
import { translation } from "../../../src/math/mat4";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { createScene } from "../../../src/scene/scene";
import {
  interactionDirtyParts,
  refreshTransparencyFlags,
} from "../../../src/renderer/interaction-sync";
import type { EmphasisUpdate } from "../../../src/renderer/resources/element-resources";
import { defaultStyle } from "../../../src/renderer/resources/foundation";
import { buildInstanceLayout } from "../../../src/renderer/runtime-state";

function sceneRuntime() {
  const geometry = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
  };
  const part = createPart(1, { geometries: [geometry] });
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        { kind: "part" as const, partId: 1, transform: translation(0, 0, 0) },
        { kind: "part" as const, partId: 1, transform: translation(2, 0, 0) },
      ],
    })
    .withRoot(1)
    .build();
  return { runtime: createPackedSceneRuntime(scene), parts: new Map([[1, part]]) };
}

describe("interactionDirtyParts", () => {
  it("marks node orders dirty when part or part-occurrence style overrides change", () => {
    const { runtime } = sceneRuntime();
    const layout = buildInstanceLayout(runtime);
    const empty = createInteractionState();
    const partState = setPartOverride(empty, 1, { nodes: true });
    const instanceState = setPartOccurrenceOverride(empty, "1/1", { nodes: true });

    expect(interactionDirtyParts(runtime, layout, empty, partState, false).nodeParts).toEqual(
      new Set([1]),
    );
    expect(interactionDirtyParts(runtime, layout, empty, instanceState, false).nodeParts).toEqual(
      new Set([1]),
    );
  });

  it("consumes the shared emphasis snapshot for transparency classification", () => {
    const { runtime, parts } = sceneRuntime();
    const layout = buildInstanceLayout(runtime);
    const updates: EmphasisUpdate[] = [
      {
        slot: 0,
        elementPickId: 1,
        facePickId: 0,
        nodePickId: 0,
        style: { ...defaultStyle, color: { ...defaultStyle.color, a: 0.5 } },
      },
    ];
    const currentFlags = [false, false];
    const changed = refreshTransparencyFlags({
      runtime,
      layout,
      interaction: createInteractionState(),
      parts,
      currentFlags,
      slotByInstanceId: new Map([["1/0", 0]]),
      changedSlots: [0],
      affectedParts: new Set([1]),
      emphasisUpdates: new Map([[1, updates]]),
    });
    expect(currentFlags[0]).toBe(true);
    expect(changed).toEqual(new Set([1]));
  });

  it("maps transparent emphasis through a retained local after shrink and reorder", () => {
    const { parts } = sceneRuntime();
    const part = parts.get(1);
    if (part === undefined) throw new Error("Transparency part is missing");
    const scene = (ids: readonly string[]) =>
      createScene()
        .addPart(part)
        .addAssembly({
          id: 1,
          name: "root",
          placements: ids.map((placementId) => ({
            kind: "part" as const,
            placementId,
            partId: 1,
            transform: translation(0, 0, 0),
          })),
        })
        .withRoot(1)
        .build();
    const firstRuntime = createPackedSceneRuntime(scene(["a", "b", "c", "d"]));
    const firstLayout = buildInstanceLayout(firstRuntime);
    const runtime = createPackedSceneRuntime(scene(["d", "new", "b"]));
    const layout = buildInstanceLayout(runtime, { runtime: firstRuntime, layout: firstLayout });
    const currentFlags = [false, false, false];
    const changed = refreshTransparencyFlags({
      runtime,
      layout,
      interaction: createInteractionState(),
      parts,
      currentFlags,
      slotByInstanceId: new Map(),
      changedSlots: [0],
      affectedParts: new Set([1]),
      emphasisUpdates: new Map([
        [
          1,
          [
            {
              slot: 3,
              elementPickId: 1,
              facePickId: 0,
              nodePickId: 0,
              style: { ...defaultStyle, opacity: 0.5 },
            },
          ],
        ],
      ]),
    });

    expect(currentFlags).toEqual([true, false, false]);
    expect(changed).toEqual(new Set([1]));
  });
});
