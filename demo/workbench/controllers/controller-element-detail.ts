import {
  isTargetSelected,
  type ElementId,
  type InstanceId,
  type InteractionState,
  type SceneRuntime,
} from "../../../src/index";
import type { WorkbenchInteraction } from "../interaction/interaction";
import type { WorkbenchModel } from "../models/model";
import type { WorkbenchElementDetailSnapshot } from "../results/snapshot";
import {
  clearElementDetailHover,
  setElementDetailHover,
  type WorkbenchHoverController,
} from "./controller-hover";
import type { VisibilityRowTarget } from "../state/visibility-snapshot";

export interface WorkbenchElementDetailActions {
  readonly openElementDetail: (target: Extract<VisibilityRowTarget, { kind: "body" }>) => void;
  readonly closeElementDetail: () => void;
  readonly elementIdsForDetail: (detail: WorkbenchElementDetailSnapshot) => readonly ElementId[];
  readonly isElementSelected: (instanceId: InstanceId, elementId: ElementId) => boolean;
  readonly selectElementDetail: (
    detail: WorkbenchElementDetailSnapshot,
    elementId: ElementId,
  ) => void;
  readonly setElementDetailHover: (
    detail: WorkbenchElementDetailSnapshot,
    elementId: ElementId,
  ) => void;
  readonly clearElementDetailHover: (
    detail: WorkbenchElementDetailSnapshot,
    elementId: ElementId,
  ) => void;
}

interface WorkbenchElementDetailOwner extends WorkbenchHoverController {
  readonly model: WorkbenchModel;
  readonly runtime: SceneRuntime;
  interaction: InteractionState;
  readonly interactionController: WorkbenchInteraction;
  elementDetail: WorkbenchElementDetailSnapshot | undefined;
  publishSnapshot(): void;
}

/** Creates the bounded body-detail actions around the shared workbench state. */
export function createElementDetailActions(
  owner: WorkbenchElementDetailOwner,
): WorkbenchElementDetailActions {
  return {
    openElementDetail: (target) => {
      openElementDetail(owner, target);
    },
    closeElementDetail: () => {
      closeElementDetail(owner);
    },
    elementIdsForDetail: (detail) => elementIdsForDetail(owner, detail),
    isElementSelected: (instanceId, elementId) => isElementSelected(owner, instanceId, elementId),
    selectElementDetail: (detail, elementId) => {
      selectElementDetail(owner, detail, elementId);
    },
    setElementDetailHover: (detail, elementId) => {
      setElementDetailHover(owner, { instanceId: detail.instanceId, elementId });
    },
    clearElementDetailHover: (detail, elementId) => {
      clearElementDetailHover(owner, { instanceId: detail.instanceId, elementId });
    },
  };
}

function openElementDetail(
  owner: WorkbenchElementDetailOwner,
  target: Extract<VisibilityRowTarget, { kind: "body" }>,
): void {
  const instance = owner.runtime.getInstance(target.instanceId);
  const part = instance === undefined ? undefined : owner.model.scene.parts.get(instance.partId);
  const body = part?.bodies?.find((candidate) => candidate.id === target.bodyId);
  const count = part?.elements === undefined ? 0 : (body?.elementIds.length ?? 0);
  if (instance === undefined || body === undefined || count === 0) return;
  const partName = owner.model.partNames.get(instance.partId) ?? `Part ${instance.partId}`;
  owner.elementDetail = {
    instanceId: target.instanceId,
    bodyId: target.bodyId,
    label: body.name ?? `Body ${body.id}`,
    partName,
    count,
  };
  owner.publishSnapshot();
}

function closeElementDetail(owner: WorkbenchElementDetailOwner): void {
  if (owner.elementDetail === undefined) return;
  owner.elementDetail = undefined;
  owner.publishSnapshot();
}

function elementIdsForDetail(
  owner: WorkbenchElementDetailOwner,
  detail: WorkbenchElementDetailSnapshot,
): readonly ElementId[] {
  const instance = owner.runtime.getInstance(detail.instanceId);
  const part = instance === undefined ? undefined : owner.model.scene.parts.get(instance.partId);
  return part?.bodies?.find((body) => body.id === detail.bodyId)?.elementIds ?? [];
}

function isElementSelected(
  owner: WorkbenchElementDetailOwner,
  instanceId: InstanceId,
  elementId: ElementId,
): boolean {
  return isTargetSelected(owner.interaction, { kind: "element", instanceId, elementId });
}

function selectElementDetail(
  owner: WorkbenchElementDetailOwner,
  detail: WorkbenchElementDetailSnapshot,
  elementId: ElementId,
): void {
  if (!elementIdsForDetail(owner, detail).includes(elementId)) return;
  owner.interactionController.replace({
    kind: "element",
    instanceId: detail.instanceId,
    elementId,
  });
}
