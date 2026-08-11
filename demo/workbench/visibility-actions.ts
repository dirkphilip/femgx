import {
  isBodyVisible,
  setBodyHighlighted,
  setBodyOverride,
  setBodyVisible,
  type BodyId,
  type Color,
  type FemViewport,
  type InstanceId,
  type InteractionState,
  type PartId,
  type SceneRuntime,
  type StyleOverride,
} from "../../src/index";
import type { SelectTarget } from "../pick";
import type { BodyAction } from "./visibility-panel";

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

const BODY_COLOR: Color = { r: 0.98, g: 0.58, b: 0.16, a: 1 };

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

  setBodyGroup(instanceId: InstanceId, bodyIds: readonly BodyId[], visible: boolean): void {
    const viewport = this.options.viewport();
    viewport.batch(() => {
      let state = this.options.interaction();
      for (const bodyId of bodyIds) {
        state = setBodyVisible(state, { instanceId, bodyId }, visible);
        this.options.applyInteraction(state);
      }
    });
    this.finish(false);
  }

  bodyAction(instanceId: InstanceId, bodyId: BodyId, action: BodyAction): void {
    const ref = { instanceId, bodyId };
    const state = this.options.interaction();
    if (action === "highlight") {
      const highlighted = state.highlightedBodyIds.get(instanceId)?.has(bodyId) ?? false;
      this.options.setInteraction(setBodyHighlighted(state, ref, !highlighted));
    } else {
      this.options.setInteraction(setBodyOverride(state, ref, nextBodyOverride(state, ref)));
    }
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

  bodyGroupVisible(instanceId: InstanceId, bodyIds: readonly BodyId[]): boolean {
    return bodyIds.every((bodyId) => this.bodyVisible(instanceId, bodyId));
  }

  bodyHighlighted(instanceId: InstanceId, bodyId: BodyId): boolean {
    return this.options.interaction().highlightedBodyIds.get(instanceId)?.has(bodyId) ?? false;
  }

  bodyColorActive(instanceId: InstanceId, bodyId: BodyId): boolean {
    return (
      this.options.interaction().bodyOverrides.get(instanceId)?.get(bodyId)?.color !== undefined
    );
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

function nextBodyOverride(
  state: InteractionState,
  ref: { readonly instanceId: InstanceId; readonly bodyId: BodyId },
): StyleOverride | undefined {
  const current = state.bodyOverrides.get(ref.instanceId)?.get(ref.bodyId);
  if (current?.color !== undefined) {
    const { color: _color, ...withoutColor } = current;
    return Object.keys(withoutColor).length === 0 ? undefined : withoutColor;
  }
  return { ...current, color: BODY_COLOR };
}
