import {
  isBodyVisible,
  isTargetHighlighted,
  setTargetHighlighted,
  setBodyVisible,
  type BodyId,
  type FemViewport,
  type InstanceId,
  type InteractionState,
  type PartId,
  type SceneRuntime,
} from "../../src/index";
import type { SelectTarget } from "./pick";

/** Runtime hooks used by menu and visibility-panel visibility actions. */
export interface VisibilityActionOptions {
  readonly viewport: () => FemViewport;
  readonly runtime: () => SceneRuntime;
  readonly interaction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly applyInteraction: (interaction: InteractionState) => void;
  readonly syncPanel: () => void;
  readonly render: () => void;
}

/** Keeps all demo visibility mutations on the viewport/runtime path. */
export class WorkbenchVisibilityActions {
  private readonly options: VisibilityActionOptions;

  constructor(options: VisibilityActionOptions) {
    this.options = options;
  }

  setPart(partId: PartId, visible: boolean): void {
    this.options.viewport().setPartVisible(partId, visible);
    this.finish();
  }

  setInstance(instanceId: InstanceId, visible: boolean): void {
    this.options.viewport().setInstanceVisible(instanceId, visible);
    this.finish();
  }

  setAssemblyNode(nodeId: string, visible: boolean): void {
    this.options.viewport().setAssemblyNodeVisible(nodeId, visible);
    this.finish();
  }

  setBody(instanceId: InstanceId, bodyId: BodyId, visible: boolean): void {
    const ref = { instanceId, bodyId };
    this.options.setInteraction(setBodyVisible(this.options.interaction(), ref, visible));
    this.finish();
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

  /** Restores every authored assembly, part, and instance visibility bit. */
  showAll(): void {
    const viewport = this.options.viewport();
    viewport.batch(() => {
      for (const nodeId of this.options.runtime().getNodeIds()) {
        viewport.setAssemblyNodeVisible(nodeId, true);
      }
      for (const partId of this.options
        .runtime()
        .getInstances()
        .map((instance) => instance.partId)) {
        viewport.setPartVisible(partId, true);
      }
      for (const instanceId of this.options.runtime().getInstanceIds()) {
        viewport.setInstanceVisible(instanceId, true);
      }
    });
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
}
