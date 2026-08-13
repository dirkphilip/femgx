import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  createSceneRuntime,
  isBodyVisible,
  isElementVisible,
  setElementVisible,
  setBodyVisible,
  type FemViewport,
} from "../../src/index";
import { createBoltedPlatePreset } from "../../demo/fixture/presets";
import { WorkbenchVisibilityActions } from "../../demo/workbench/visibility-actions";

describe("WorkbenchVisibilityActions", () => {
  it("restores every visibility layer while preserving one interaction update", () => {
    const scene = createBoltedPlatePreset().scene;
    const runtime = createSceneRuntime(scene);
    const firstInstance = runtime.getInstances()[0];
    if (firstInstance === undefined) throw new Error("Fixture must contain an instance");
    const firstBody = scene.parts.get(firstInstance.partId)?.geometry.bodies?.[0];
    if (firstBody === undefined) throw new Error("Fixture must contain a body");

    let interaction = setBodyVisible(
      createInteractionState(),
      { instanceId: firstInstance.instanceId, bodyId: firstBody.id },
      false,
    );
    const firstElement = scene.parts.get(firstInstance.partId)?.geometry.elements?.[0];
    if (firstElement === undefined) throw new Error("Fixture must contain an element");
    interaction = setElementVisible(
      interaction,
      { instanceId: firstInstance.instanceId, elementId: firstElement.id },
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
      setAssemblyVisible(assemblyId: number, visible: boolean): void {
        calls.push(`assembly:${assemblyId}:${visible}`);
      },
      setAssemblyNodeVisible(nodeId: string, visible: boolean): void {
        calls.push(`node:${nodeId}:${visible}`);
      },
      setPartVisible(partId: number, visible: boolean): void {
        calls.push(`part:${partId}:${visible}`);
      },
      setInstanceVisible(instanceId: string, visible: boolean): void {
        calls.push(`instance:${instanceId}:${visible}`);
      },
    } as unknown as FemViewport;
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
      ...runtime.getNodeIds().map((id) => `node:${id}:true`),
      ...[...scene.parts.keys()].map((id) => `part:${id}:true`),
      ...runtime.getInstanceIds().map((id) => `instance:${id}:true`),
    ];
    expect(calls).toEqual(expectedCalls);

    for (const instance of runtime.getInstances()) {
      const bodies = scene.parts.get(instance.partId)?.geometry.bodies ?? [];
      for (const body of bodies) {
        expect(
          isBodyVisible(interaction, { instanceId: instance.instanceId, bodyId: body.id }),
        ).toBe(true);
      }
      for (const element of scene.parts.get(instance.partId)?.geometry.elements ?? []) {
        expect(
          isElementVisible(interaction, { instanceId: instance.instanceId, elementId: element.id }),
        ).toBe(true);
      }
    }
  });
});
