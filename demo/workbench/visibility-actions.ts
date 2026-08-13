import {
  isBodyVisible,
  isElementVisible,
  isTargetHighlighted,
  selectedTargets,
  setElementVisible,
  setTargetHighlighted,
  setBodyVisible,
  type BodyId,
  type FemViewport,
  type InteractionTarget,
  type InstanceId,
  type InteractionState,
  type PartId,
  type Scene,
  type SceneRuntime,
} from "../../src/index";
import type { SelectTarget } from "./pick";
import { elementTarget } from "./pick";

/** Runtime hooks used by menu and visibility-panel visibility actions. */
export interface VisibilityActionOptions {
  readonly viewport: () => FemViewport;
  readonly viewports?: () => readonly FemViewport[];
  readonly scene: () => Scene;
  readonly runtime: () => SceneRuntime;
  readonly interaction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly applyInteraction: (interaction: InteractionState) => void;
  readonly syncPanel: () => void;
  readonly render: () => void;
  readonly feedback?: (message: string) => void;
}

type SelectedElementTarget = Extract<InteractionTarget, { readonly kind: "element" }>;

/** Returns selected element occurrences without promoting other target kinds. */
export function selectedElementTargets(
  interaction: InteractionState,
): readonly SelectedElementTarget[] {
  const seen = new Set<string>();
  const elements: SelectedElementTarget[] = [];
  for (const target of selectedTargets(interaction)) {
    if (target.kind !== "element") continue;
    const key = `${target.instanceId}:${target.elementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push(target);
  }
  return elements;
}

/** Keeps all demo visibility mutations on the viewport/runtime path. */
export class WorkbenchVisibilityActions {
  private readonly options: VisibilityActionOptions;

  constructor(options: VisibilityActionOptions) {
    this.options = options;
  }

  setPart(partId: PartId, visible: boolean): void {
    for (const viewport of this.viewports()) viewport.setPartVisible(partId, visible);
    this.finish();
  }

  setInstance(instanceId: InstanceId, visible: boolean): void {
    for (const viewport of this.viewports()) viewport.setInstanceVisible(instanceId, visible);
    this.finish();
  }

  setAssemblyNode(nodeId: string, visible: boolean): void {
    for (const viewport of this.viewports()) viewport.setAssemblyNodeVisible(nodeId, visible);
    this.finish();
  }

  setBody(instanceId: InstanceId, bodyId: BodyId, visible: boolean): void {
    const ref = { instanceId, bodyId };
    this.options.setInteraction(setBodyVisible(this.options.interaction(), ref, visible));
    this.finish();
  }

  setElement(instanceId: InstanceId, elementId: number, visible: boolean): void {
    const ref = { instanceId, elementId };
    this.options.setInteraction(setElementVisible(this.options.interaction(), ref, visible));
    this.finish();
  }

  toggleElement(target: SelectTarget): void {
    const element = elementTarget(target);
    if (element?.kind !== "element") return;
    this.setElement(
      element.instanceId,
      element.elementId,
      !isElementVisible(this.options.interaction(), element),
    );
  }

  /** Hides selected element occurrences in one synchronized interaction update. */
  hideSelected(): void {
    const interaction = this.options.interaction();
    const selected = selectedElementTargets(interaction);
    const visible = selected.filter((target) => isElementVisible(interaction, target));
    if (visible.length === 0) {
      this.options.feedback?.(
        selected.length === 0
          ? "No selected elements to hide."
          : "Selected elements are already hidden.",
      );
      return;
    }

    let next = interaction;
    for (const target of visible) {
      next = setElementVisible(next, target, false);
    }
    this.options.applyInteraction(next);
    this.finish();
    this.options.feedback?.(
      visible.length === selected.length
        ? `Hidden ${visible.length} selected element${visible.length === 1 ? "" : "s"}.`
        : `Hidden ${visible.length} of ${selected.length} selected elements.`,
    );
  }

  bodyHighlight(instanceId: InstanceId, bodyId: BodyId): void {
    const ref = { instanceId, bodyId };
    const state = this.options.interaction();
    const highlighted = isTargetHighlighted(state, { kind: "body", instanceId, bodyId });
    this.options.setInteraction(
      setTargetHighlighted(state, { kind: "body", ...ref }, !highlighted),
    );
    this.finish();
  }

  toggleInstance(target: SelectTarget): void {
    if (target.kind === "part") return;
    const runtime = this.options.runtime();
    if (runtime.getInstance(target.instanceId) === undefined) return;
    this.setInstance(target.instanceId, !runtime.isInstanceVisible(target.instanceId));
  }

  togglePart(target: SelectTarget): void {
    const partId = target.kind === "part" ? target.partId : this.partForTarget(target);
    if (partId === undefined) return;
    this.setPart(partId, !this.partVisible(partId));
  }

  /** Restores every current model-visibility bit without changing interaction emphasis. */
  showAll(): void {
    const scene = this.options.scene();
    const runtime = this.options.runtime();
    let interaction = this.options.interaction();
    for (const instance of runtime.getInstances()) {
      const part = scene.parts.get(instance.partId);
      for (const body of part?.geometry.bodies ?? []) {
        interaction = setBodyVisible(
          interaction,
          { instanceId: instance.instanceId, bodyId: body.id },
          true,
        );
      }
      for (const element of part?.geometry.elements ?? []) {
        interaction = setElementVisible(
          interaction,
          { instanceId: instance.instanceId, elementId: element.id },
          true,
        );
      }
    }
    this.options.applyInteraction(interaction);
    for (const viewport of this.viewports()) {
      viewport.batch(() => {
        for (const assemblyId of scene.assemblies.keys()) {
          viewport.setAssemblyVisible(assemblyId, true);
        }
        for (const nodeId of runtime.getNodeIds()) {
          viewport.setAssemblyNodeVisible(nodeId, true);
        }
        for (const partId of scene.parts.keys()) {
          viewport.setPartVisible(partId, true);
        }
        for (const instanceId of runtime.getInstanceIds()) {
          viewport.setInstanceVisible(instanceId, true);
        }
      });
    }
    this.finish();
  }

  partVisible(partId: PartId): boolean {
    const instance = this.options
      .runtime()
      .getInstances()
      .find((candidate) => candidate.partId === partId);
    return instance?.partVisible ?? false;
  }

  bodyVisible(instanceId: InstanceId, bodyId: BodyId): boolean {
    return isBodyVisible(this.options.interaction(), { instanceId, bodyId });
  }

  bodyHighlighted(instanceId: InstanceId, bodyId: BodyId): boolean {
    return isTargetHighlighted(this.options.interaction(), { kind: "body", instanceId, bodyId });
  }

  private partForTarget(target: SelectTarget): PartId | undefined {
    if (target.kind === "part") return target.partId;
    return this.options.runtime().getPartId(target.instanceId);
  }

  private finish(render = true): void {
    this.options.syncPanel();
    if (render) this.options.render();
  }

  private viewports(): readonly FemViewport[] {
    return this.options.viewports?.() ?? [this.options.viewport()];
  }
}
