import { describe, expect, it } from "vitest";
import { createPart, type Part } from "@/geometry/part";
import { createInteractionState } from "@/interaction/interaction";
import { setNodeHighlighted } from "@/interaction/nodes";
import { setTargetsSelected, setTargetHovered } from "@/interaction/targets";
import { identityMatrix } from "@/math/mat4";
import {
  collectEmphasisUpdates,
  type EmphasisUpdates,
} from "@/renderer/resources/element-resources";
import { buildInstanceLayout } from "@/renderer/runtime-state";
import { buildSelectionOrder } from "@/renderer/runtime-state";
import { refreshTransparencyFlags } from "@/renderer/interaction-sync";
import {
  createHighlightStorage,
  writeElementHighlights,
} from "@/renderer/selection/highlight-storage";
import { HIGHLIGHT_HEADER } from "@/renderer/selection/highlight-layout";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";
import {
  denseNodeSelectionContains,
  collectDenseNodeSelections,
  sparseNodeEmphasisRefs,
} from "@/renderer/selection/node-selection";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

describe("dense node selections", () => {
  it("keeps tiny selections sparse and large selections typed", () => {
    const fixture = nodeFixture(1);
    const sparse = select([0, 1]);
    expect(
      collectDenseNodeSelections(fixture.runtime, fixture.layout, fixture.parts, sparse),
    ).toEqual(new Map());

    const dense = select(Array.from({ length: 128 }, (_, nodeId) => nodeId));
    const selections = collectDenseNodeSelections(
      fixture.runtime,
      fixture.layout,
      fixture.parts,
      dense,
    );
    const occurrence = selections.get(1)?.occurrences[0];
    expect(occurrence?.selectedCount).toBe(128);
    expect(occurrence?.words).toBeInstanceOf(Uint32Array);
    expect(occurrence?.words[0]).toBe(0xffffffff);
    expect(sparseNodes(fixture, dense, selections)).toHaveLength(0);
    expect(collectDenseNodeSelections(fixture.runtime, fixture.layout, fixture.parts, dense)).toBe(
      selections,
    );
    collectDenseNodeSelections(fixture.runtime, fixture.layout, fixture.parts, sparse);
    expect(
      collectDenseNodeSelections(fixture.runtime, fixture.layout, fixture.parts, dense),
    ).not.toBe(selections);
  });

  it("retains hovered and highlighted nodes over dense selected membership", () => {
    const fixture = nodeFixture(1);
    let interaction = select(Array.from({ length: 128 }, (_, nodeId) => nodeId));
    interaction = setNodeHighlighted(interaction, { partOccurrenceId: "1/0", nodeId: 2 }, true);
    interaction = setTargetHovered(interaction, {
      kind: "node",
      partOccurrenceId: "1/0",
      nodeId: 3,
    });
    const selections = collectDenseNodeSelections(
      fixture.runtime,
      fixture.layout,
      fixture.parts,
      interaction,
    );
    const refs = sparseNodes(fixture, interaction, selections);
    expect(refs).toEqual([
      { partOccurrenceId: "1/0", nodeId: 3 },
      { partOccurrenceId: "1/0", nodeId: 2 },
    ]);
    expect(emphasis(fixture, interaction, selections).get(1)).toHaveLength(2);
  });

  it("falls back conservatively for invalid or fractional node ids", () => {
    const fixture = nodeFixture(1);
    for (const nodeIds of [
      [0, 1024],
      [0, 0.5],
      [-1, 0, 1024],
    ]) {
      const interaction = select(nodeIds);
      const selections = collectDenseNodeSelections(
        fixture.runtime,
        fixture.layout,
        fixture.parts,
        interaction,
      );
      expect(selections).toEqual(new Map());
      expect(emphasis(fixture, interaction, selections).get(1)).toHaveLength(1);
    }
    const invalidOnly = select([1024]);
    expect(
      buildSelectionOrder(fixture.layout, fixture.runtime, 1, invalidOnly, fixture.parts),
    ).toEqual(new Uint32Array());
    expect(emphasis(fixture, invalidOnly, new Map()).get(1)).toBeUndefined();
    const stale = setTargetsSelected(
      createInteractionState(),
      [{ kind: "node" as const, partOccurrenceId: "stale", nodeId: 0 }],
      true,
    );
    expect(emphasis(fixture, stale, new Map()).get(1)).toBeUndefined();
  });

  it("does not retain a million-node bitset for a tiny selection", () => {
    const fixture = nodeFixture(1, 1_000_000);
    const selections = collectDenseNodeSelections(
      fixture.runtime,
      fixture.layout,
      fixture.parts,
      select([0, 1]),
    );
    expect(selections).toEqual(new Map());
  });

  it("rejects aggregate dense storage before allocating a million-node bitset", () => {
    const fixture = nodeFixture(11, 1_000_000);
    const interaction = select(Array.from({ length: 2_605 }, (_, nodeId) => nodeId));
    const allocations: number[] = [];
    const NativeUint32Array = globalThis.Uint32Array;
    class TrackingUint32Array extends Uint32Array {
      public constructor(length: number) {
        allocations.push(length);
        super(length);
      }
    }
    globalThis.Uint32Array = TrackingUint32Array as Uint32ArrayConstructor;
    try {
      expect(
        collectDenseNodeSelections(fixture.runtime, fixture.layout, fixture.parts, interaction),
      ).toEqual(new Map());
      expect(allocations).not.toContain(31_250);
    } finally {
      globalThis.Uint32Array = NativeUint32Array;
    }
  });

  it("keeps dense membership occurrence-scoped", () => {
    const fixture = nodeFixture(2);
    const interaction = setTargetsSelected(
      createInteractionState(),
      Array.from({ length: 128 }, (_, nodeId) => ({
        kind: "node" as const,
        partOccurrenceId: "1/1",
        nodeId,
      })),
      true,
    );
    const selections = collectDenseNodeSelections(
      fixture.runtime,
      fixture.layout,
      fixture.parts,
      interaction,
    );
    expect(selections.get(1)?.occurrences).toHaveLength(1);
    expect(emphasis(fixture, interaction, selections).get(1)).toBeUndefined();
  });

  it("charges one shared slot table across dense occurrences at crossover", () => {
    const fixture = nodeFixture(32);
    const targets = ["1/0", "1/1"].flatMap((partOccurrenceId) =>
      Array.from({ length: 5 }, (_, nodeId) => ({
        kind: "node" as const,
        partOccurrenceId,
        nodeId,
      })),
    );
    const interaction = setTargetsSelected(createInteractionState(), targets, true);
    const selections = collectDenseNodeSelections(
      fixture.runtime,
      fixture.layout,
      fixture.parts,
      interaction,
    );
    expect(selections.get(1)?.occurrences).toHaveLength(2);
  });

  it("packs node membership beside dense element data without aliases", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const emptyHighlight = createHighlightStorage(gpu.device, 1);
      const storage = {
        highlight: emptyHighlight,
        emptyHighlight,
        highlightOwned: false,
      } as Parameters<typeof writeElementHighlights>[1];
      const nodeSelection = {
        nodeCount: 65,
        occurrences: [{ slot: 0, selectedCount: 2, words: new Uint32Array([1, 2, 0]) }],
      };
      const elementSelection = {
        elementCount: 33,
        occurrences: [{ slot: 0, selectedCount: 1, words: new Uint32Array([1, 0]) }],
      };

      writeElementHighlights(gpu.device, storage, [], {
        selection: elementSelection,
        nodeSelection,
        selectedTheme: { color: { r: 1, g: 0, b: 0, a: 1 } },
        slotCapacity: 1,
      });

      const table = new Uint32Array(storage.highlight.data.buffer);
      const payload = HIGHLIGHT_HEADER / 4;
      const elementBits = table[5] ?? 0;
      const nodeOffset = table[16] ?? 0;
      const nodeBits = table[17] ?? 0;
      expect(table[3]).toBe(2);
      expect(table[15]).toBe(3);
      expect(nodeOffset).toBe(elementBits + 2);
      expect(table[payload + (table[4] ?? 0)]).toBe(0);
      expect(table[payload + (table[5] ?? 0)]).toBe(1);
      expect(table[payload + nodeOffset]).toBe(0);
      expect(table[payload + nodeBits]).toBe(1);
      expect(table[payload + nodeBits + 1]).toBe(2);
      expect(denseNodeSelectionContains(nodeSelection, 0, 0)).toBe(true);
      expect(denseNodeSelectionContains(nodeSelection, 0, 33)).toBe(true);
      expect(denseNodeSelectionContains(nodeSelection, 0, -1)).toBe(false);
      expect(denseNodeSelectionContains(nodeSelection, 0, 65)).toBe(false);
      expect(denseNodeSelectionContains(nodeSelection, 0, 0.5)).toBe(false);
    } finally {
      restore();
    }
  });

  it("admits transparent selected-only dense node occurrences", () => {
    const fixture = nodeFixture(1);
    const interaction = selectWithTheme(
      Array.from({ length: 128 }, (_, nodeId) => nodeId),
      { highlighted: {}, selected: { opacity: 0.5 } },
    );
    const denseNodeSelections = collectDenseNodeSelections(
      fixture.runtime,
      fixture.layout,
      fixture.parts,
      interaction,
    );
    const currentFlags = [false];
    const changed = refreshTransparencyFlags({
      runtime: fixture.runtime,
      layout: fixture.layout,
      interaction,
      parts: fixture.parts,
      currentFlags,
      slotByInstanceId: new Map([["1/0", 0]]),
      changedSlots: [0],
      affectedParts: new Set([1]),
      emphasisUpdates: new Map(),
      denseNodeSelections,
    });
    expect(currentFlags[0]).toBe(true);
    expect(changed).toEqual(new Set([1]));
  });

  it("admits transparent selected-only dense element occurrences", () => {
    const fixture = nodeFixture(1);
    const interaction = selectWithTheme([], {
      highlighted: {},
      selected: { opacity: 0.5 },
    });
    const currentFlags = [false];
    const changed = refreshTransparencyFlags({
      runtime: fixture.runtime,
      layout: fixture.layout,
      interaction,
      parts: fixture.parts,
      currentFlags,
      slotByInstanceId: new Map([["1/0", 0]]),
      changedSlots: [0],
      affectedParts: new Set([1]),
      emphasisUpdates: new Map(),
      denseSelections: denseElementSelection(),
    });
    expect(currentFlags[0]).toBe(true);
    expect(changed).toEqual(new Set([1]));
  });

  it("admits transparent dense element and node occurrences together", () => {
    const fixture = nodeFixture(1);
    const interaction = selectWithTheme(
      Array.from({ length: 128 }, (_, nodeId) => nodeId),
      { highlighted: {}, selected: { opacity: 0.5 } },
    );
    const denseNodeSelections = collectDenseNodeSelections(
      fixture.runtime,
      fixture.layout,
      fixture.parts,
      interaction,
    );
    const denseSelections = denseElementSelection();
    const currentFlags = [false];
    const changed = refreshTransparencyFlags({
      runtime: fixture.runtime,
      layout: fixture.layout,
      interaction,
      parts: fixture.parts,
      currentFlags,
      slotByInstanceId: new Map([["1/0", 0]]),
      changedSlots: [0],
      affectedParts: new Set([1]),
      emphasisUpdates: new Map(),
      denseSelections,
      denseNodeSelections,
    });
    expect(currentFlags[0]).toBe(true);
    expect(changed).toEqual(new Set([1]));
  });
});

function denseElementSelection() {
  return new Map([
    [
      1,
      {
        elementCount: 1,
        occurrences: [{ slot: 0, selectedCount: 1, words: new Uint32Array([1]) }],
      },
    ],
  ]);
}

interface NodeFixture {
  readonly part: Part;
  readonly parts: ReadonlyMap<number, Part>;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly layout: ReturnType<typeof buildInstanceLayout>;
}

function nodeFixture(placementCount: number, nodeCount = 1024): NodeFixture {
  const nodePositions = new Float32Array(nodeCount * 3);
  const part = createPart(1, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array(9),
        indices: new Uint32Array([0, 1, 2]),
        nodePickIds: new Uint32Array([1, 2, 3]),
      },
    ],
    nodePositions,
  });
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "node-selection-test",
      placements: Array.from({ length: placementCount }, () => ({
        kind: "part" as const,
        partId: 1,
        transform: identityMatrix(),
      })),
    })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  return { part, parts: scene.parts, runtime, layout: buildInstanceLayout(runtime) };
}

function select(nodeIds: readonly number[]) {
  return selectWithTheme(nodeIds, undefined);
}

function selectWithTheme(
  nodeIds: readonly number[],
  theme:
    | {
        readonly highlighted: Record<string, never>;
        readonly selected: { readonly opacity: number };
      }
    | undefined,
) {
  return setTargetsSelected(
    createInteractionState(theme),
    nodeIds.map((nodeId) => ({ kind: "node" as const, partOccurrenceId: "1/0", nodeId })),
    true,
  );
}

function sparseNodes(
  fixture: NodeFixture,
  interaction: ReturnType<typeof createInteractionState>,
  selections: ReturnType<typeof collectDenseNodeSelections>,
) {
  return sparseNodeEmphasisRefs(fixture.runtime, fixture.layout, interaction, selections);
}

function emphasis(
  fixture: NodeFixture,
  interaction: ReturnType<typeof createInteractionState>,
  selections: ReturnType<typeof collectDenseNodeSelections>,
): EmphasisUpdates {
  return collectEmphasisUpdates(fixture.runtime, fixture.layout, new Map([["1/0", 0]]), {
    parts: fixture.parts,
    interaction,
    denseNodeSelections: selections,
  });
}
