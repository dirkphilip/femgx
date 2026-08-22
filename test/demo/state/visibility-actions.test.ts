import { describe, expect, it } from "vitest";
import { type Viewport, type Scene } from "@/entries/root";
import {
  createInteractionState,
  isTargetSelected,
  selectedTargets,
  setTargetSelected,
  type InteractionState,
} from "@/entries/interaction";
import { isBodyVisible, setBodyVisible } from "@/interaction/bodies";
import { isElementVisible, setElementVisible } from "@/interaction/elements";
import { hideSelectedElements } from "@/interaction/selection-queries";
import { withInteractionVisibility } from "@/interaction/state";
import { createSceneOccurrenceSnapshot, type SceneOccurrences } from "@/scene-runtime/occurrences";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { WorkbenchVisibilityActions } from "../../../demo/workbench/state/visibility-actions";
import { selectedElementVisibilitySummary } from "@/interaction/selection-queries";

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

    expect(harness.appliedInteractionCount).toBe(0);
    expect(harness.panelSyncCount).toBe(1);
    expect(harness.renderCount).toBe(1);
    expect(harness.feedback).toEqual(["Hidden 2 selected elements."]);
    expect(isElementVisible(harness.visibility, firstTarget)).toBe(false);
    expect(isElementVisible(harness.visibility, secondTarget)).toBe(false);
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

    expect(selectedElementVisibilitySummary(interaction)).toEqual({
      selectedCount: 1,
      visibleCount: 1,
    });

    interaction = setElementVisible(interaction, elementTarget, false);
    expect(selectedElementVisibilitySummary(interaction)).toEqual({
      selectedCount: 1,
      visibleCount: 0,
    });
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
        showAll(): void {
          visibilityState = withInteractionVisibility(visibilityState, {
            hiddenBodyIds: new Map(),
            hiddenElementIds: new Map(),
          });
          calls.push("show-all");
        },
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
    let visibilityState = interaction;
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

    expect(appliedInteractionCount).toBe(0);
    expect(panelSyncCount).toBe(1);
    expect(renderCount).toBe(1);
    expect(calls).toEqual(["show-all"]);

    for (const instance of runtime.partOccurrences()) {
      const bodies = scene.parts.get(instance.partId)?.bodies ?? [];
      for (const body of bodies) {
        expect(
          isBodyVisible(visibilityState, {
            partOccurrenceId: instance.partOccurrenceId,
            bodyId: body.id,
          }),
        ).toBe(true);
      }
      for (const element of scene.parts.get(instance.partId)?.elements ?? []) {
        expect(
          isElementVisible(visibilityState, {
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
  let visibilityState = initial;
  let appliedInteractionCount = 0;
  let panelSyncCount = 0;
  let renderCount = 0;
  const feedback: string[] = [];
  return {
    actions: new WorkbenchVisibilityActions({
      viewport: () =>
        ({
          visibility: {
            setBodyVisible: (ref: Parameters<typeof setBodyVisible>[1], visible: boolean) => {
              visibilityState = setBodyVisible(visibilityState, ref, visible);
            },
            setElementVisible: (ref: Parameters<typeof setElementVisible>[1], visible: boolean) => {
              visibilityState = setElementVisible(visibilityState, ref, visible);
            },
            hideSelectedElements: () => {
              visibilityState = hideSelectedElements(interaction);
            },
            showAll: () => {
              visibilityState = withInteractionVisibility(visibilityState, {
                hiddenBodyIds: new Map(),
                hiddenElementIds: new Map(),
              });
            },
            isBodyEffectivelyVisible: (ref: Parameters<typeof isBodyVisible>[1]) =>
              isBodyVisible(visibilityState, ref),
            isElementEffectivelyVisible: (ref: Parameters<typeof isElementVisible>[1]) =>
              isElementVisible(visibilityState, ref),
          },
        }) as unknown as Viewport,
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
    get visibility(): InteractionState {
      return visibilityState;
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
