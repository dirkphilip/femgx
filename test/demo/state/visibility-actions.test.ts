import { describe, expect, it } from "vitest";
import { type Viewport, type Scene } from "../../../src/entries/root";
import {
  createInteractionState,
  isBodyVisible,
  isElementVisible,
  isTargetSelected,
  selectedTargets,
  setElementVisible,
  setBodyVisible,
  setTargetSelected,
  type InteractionState,
} from "../../../src/entries/interaction";
import {
  createSceneOccurrenceSnapshot,
  type SceneOccurrences,
} from "../../../src/scene-runtime/occurrences";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import {
  visibleSelectedElementTargets,
  WorkbenchVisibilityActions,
} from "../../../demo/workbench/state/visibility-actions";

describe("WorkbenchVisibilityActions", () => {
  it("hides selected elements in one update while preserving their selection", () => {
    const scene = createBoltedPlatePreset().scene;
    const runtime = createSceneOccurrenceSnapshot(scene);
    const instances = Array.from(runtime.partOccurrences());
    const first = instances[0];
    const second = instances[1];
    if (first === undefined || second === undefined) {
      throw new Error("Fixture must contain two instances");
    }
    const firstElement = scene.parts.get(first.partId)?.elements?.at(0);
    const secondElement = scene.parts.get(second.partId)?.elements?.at(0);
    if (firstElement === undefined || secondElement === undefined) {
      throw new Error("Fixture must contain two elements");
    }
    const firstTarget = {
      kind: "element" as const,
      partOccurrenceId: first.partOccurrenceId,
      elementId: firstElement.id,
    };
    const secondTarget = {
      kind: "element" as const,
      partOccurrenceId: second.partOccurrenceId,
      elementId: secondElement.id,
    };
    const nodeTarget = {
      kind: "node" as const,
      partOccurrenceId: first.partOccurrenceId,
      nodeId: 999,
    };
    let interaction = createInteractionState();
    interaction = setTargetSelected(interaction, firstTarget, true);
    interaction = setTargetSelected(interaction, secondTarget, true);
    interaction = setTargetSelected(interaction, nodeTarget, true);
    const harness = createActionHarness(scene, runtime, interaction);

    harness.actions.hideSelected();

    expect(harness.appliedInteractionCount).toBe(1);
    expect(harness.panelSyncCount).toBe(1);
    expect(harness.renderCount).toBe(1);
    expect(harness.feedback).toEqual(["Hidden 2 selected elements."]);
    expect(isElementVisible(harness.interaction, firstTarget)).toBe(false);
    expect(isElementVisible(harness.interaction, secondTarget)).toBe(false);
    expect(isTargetSelected(harness.interaction, firstTarget)).toBe(true);
    expect(isTargetSelected(harness.interaction, secondTarget)).toBe(true);
    expect(isTargetSelected(harness.interaction, nodeTarget)).toBe(true);
    expect(selectedTargets(harness.interaction)).toHaveLength(3);
  });

  it("reports only visible selected elements as hide eligibility", () => {
    const scene = createBoltedPlatePreset().scene;
    const runtime = createSceneOccurrenceSnapshot(scene);
    const instance = runtime.getPartOccurrenceId(0);
    if (instance === undefined) throw new Error("Fixture must contain an instance");
    const element = scene.parts.get(runtime.getPartId(instance) ?? -1)?.elements?.at(0);
    if (element === undefined) throw new Error("Fixture must contain an element");
    const elementTarget = {
      kind: "element" as const,
      partOccurrenceId: instance,
      elementId: element.id,
    };
    let interaction = createInteractionState();
    for (const target of [
      { kind: "body" as const, partOccurrenceId: instance, bodyId: 1 },
      {
        kind: "face" as const,
        partOccurrenceId: instance,
        elementId: element.id,
        faceIndex: 0,
      },
      { kind: "node" as const, partOccurrenceId: instance, nodeId: 0 },
      { kind: "edge" as const, partOccurrenceId: instance, key: "0:1" },
      elementTarget,
    ]) {
      interaction = setTargetSelected(interaction, target, true);
    }

    expect(visibleSelectedElementTargets(interaction)).toEqual([elementTarget]);

    interaction = setElementVisible(interaction, elementTarget, false);
    expect(visibleSelectedElementTargets(interaction)).toEqual([]);
  });

  it("reports no-op feedback without rendering when selected elements are already hidden", () => {
    const scene = createBoltedPlatePreset().scene;
    const runtime = createSceneOccurrenceSnapshot(scene);
    const instance = runtime.getPartOccurrenceId(0);
    if (instance === undefined) throw new Error("Fixture must contain an instance");
    const element = scene.parts.get(runtime.getPartId(instance) ?? -1)?.elements?.at(0);
    if (element === undefined) throw new Error("Fixture must contain an element");
    const target = {
      kind: "element" as const,
      partOccurrenceId: instance,
      elementId: element.id,
    };
    let interaction = setElementVisible(createInteractionState(), target, false);
    interaction = setTargetSelected(interaction, target, true);
    const harness = createActionHarness(scene, runtime, interaction);

    harness.actions.hideSelected();

    expect(harness.appliedInteractionCount).toBe(0);
    expect(harness.panelSyncCount).toBe(0);
    expect(harness.renderCount).toBe(0);
    expect(harness.feedback).toEqual(["Selected elements are already hidden."]);
    expect(isTargetSelected(harness.interaction, target)).toBe(true);
  });

  it("restores every visibility layer while preserving one interaction update", () => {
    const scene = createBoltedPlatePreset().scene;
    const runtime = createSceneOccurrenceSnapshot(scene);
    const firstInstance = runtime.getPartOccurrenceId(0);
    if (firstInstance === undefined) throw new Error("Fixture must contain an instance");
    const firstPartId = runtime.getPartId(firstInstance);
    const firstBody = scene.parts.get(firstPartId ?? -1)?.bodies?.at(0);
    if (firstBody === undefined) throw new Error("Fixture must contain a body");

    let interaction = setBodyVisible(
      createInteractionState(),
      { partOccurrenceId: firstInstance, bodyId: firstBody.id },
      false,
    );
    const firstElement = scene.parts.get(firstPartId ?? -1)?.elements?.at(0);
    if (firstElement === undefined) throw new Error("Fixture must contain an element");
    interaction = setElementVisible(
      interaction,
      { partOccurrenceId: firstInstance, elementId: firstElement.id },
      false,
    );
    let appliedInteractionCount = 0;
    let panelSyncCount = 0;
    let renderCount = 0;
    const calls: string[] = [];
    const viewport = {
      batch<T>(operation: () => T): T {
        calls.push("batch");
        return operation();
      },
      visibility: {
        setAssemblyVisible(assemblyId: number, visible: boolean): void {
          calls.push(`assembly:${assemblyId}:${visible}`);
        },
        setAssemblyOccurrenceVisible(occurrenceId: string, visible: boolean): void {
          calls.push(`occurrence:${occurrenceId}:${visible}`);
        },
        setPartVisible(partId: number, visible: boolean): void {
          calls.push(`part:${partId}:${visible}`);
        },
        setPartOccurrenceVisible(partOccurrenceId: string, visible: boolean): void {
          calls.push(`instance:${partOccurrenceId}:${visible}`);
        },
      },
    } as unknown as Viewport;
    const actions = new WorkbenchVisibilityActions({
      viewport: () => viewport,
      scene: () => scene,
      runtime: () => runtime,
      interaction: () => interaction,
      setInteraction: (next) => {
        interaction = next;
      },
      applyInteraction: (next) => {
        interaction = next;
        appliedInteractionCount++;
      },
      syncPanel: () => {
        panelSyncCount++;
      },
      render: () => {
        renderCount++;
      },
    });

    actions.showAll();

    expect(appliedInteractionCount).toBe(1);
    expect(panelSyncCount).toBe(1);
    expect(renderCount).toBe(1);
    expect(calls[0]).toBe("batch");
    const expectedCalls = [
      "batch",
      ...[...scene.assemblies.keys()].map((id) => `assembly:${id}:true`),
      ...Array.from(
        runtime.assemblyOccurrences(),
        ({ assemblyOccurrenceId: id }) => `occurrence:${id}:true`,
      ),
      ...[...scene.parts.keys()].map((id) => `part:${id}:true`),
      ...Array.from(runtime.partOccurrences(), ({ partOccurrenceId: id }) => `instance:${id}:true`),
    ];
    expect(calls).toEqual(expectedCalls);

    for (const instance of runtime.partOccurrences()) {
      const bodies = scene.parts.get(instance.partId)?.bodies ?? [];
      for (const body of bodies) {
        expect(
          isBodyVisible(interaction, {
            partOccurrenceId: instance.partOccurrenceId,
            bodyId: body.id,
          }),
        ).toBe(true);
      }
      for (const element of scene.parts.get(instance.partId)?.elements ?? []) {
        expect(
          isElementVisible(interaction, {
            partOccurrenceId: instance.partOccurrenceId,
            elementId: element.id,
          }),
        ).toBe(true);
      }
    }
  });
});

function createActionHarness(scene: Scene, runtime: SceneOccurrences, initial: InteractionState) {
  let interaction = initial;
  let appliedInteractionCount = 0;
  let panelSyncCount = 0;
  let renderCount = 0;
  const feedback: string[] = [];
  return {
    actions: new WorkbenchVisibilityActions({
      viewport: () => ({}) as Viewport,
      scene: () => scene,
      runtime: () => runtime,
      interaction: () => interaction,
      setInteraction: (next) => {
        interaction = next;
      },
      applyInteraction: (next) => {
        interaction = next;
        appliedInteractionCount++;
      },
      syncPanel: () => {
        panelSyncCount++;
      },
      render: () => {
        renderCount++;
      },
      feedback: (message) => {
        feedback.push(message);
      },
    }),
    get interaction(): InteractionState {
      return interaction;
    },
    get appliedInteractionCount(): number {
      return appliedInteractionCount;
    },
    get panelSyncCount(): number {
      return panelSyncCount;
    },
    get renderCount(): number {
      return renderCount;
    },
    feedback,
  };
}
