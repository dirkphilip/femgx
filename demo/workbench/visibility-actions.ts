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
  readonly slotByInstanceId: ReadonlyMap<string, number>;
  readonly firstSlotByPart: ReadonlyMap<PartId, number>;
  readonly interaction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
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

  setInstance(slot: number, visible: boolean): void {
    this.options.viewport().setInstanceVisible(slot, visible);
    this.finish();
  }

  setAssemblyNode(nodeId: number, visible: boolean): void {
    this.options.viewport().setAssemblyNodeVisible(nodeId, visible);
    this.finish();
  }

  setBody(instanceId: InstanceId, bodyId: BodyId, visible: boolean): void {
    const ref = { instanceId, bodyId };
    this.options.setInteraction(setBodyVisible(this.options.interaction(), ref, visible));
    this.finish();
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
    const slot = this.slotForInstance(target.instanceId);
    if (slot === undefined) return;
    this.setInstance(slot, !this.options.runtime().isInstanceVisible(slot));
  }

  togglePart(target: SelectTarget): void {
    const partId = target.kind === "part" ? target.partId : this.partForTarget(target);
    if (partId === undefined) return;
    this.setPart(partId, !this.partVisible(partId));
  }

  partVisible(partId: PartId): boolean {
    const slot = this.options.firstSlotByPart.get(partId);
    return slot !== undefined && this.options.runtime().instancePartVisible[slot] === 1;
  }

  bodyVisible(instanceId: InstanceId, bodyId: BodyId): boolean {
    return isBodyVisible(this.options.interaction(), { instanceId, bodyId });
  }

  bodyHighlighted(instanceId: InstanceId, bodyId: BodyId): boolean {
    return this.options.interaction().highlightedBodyIds.get(instanceId)?.has(bodyId) ?? false;
  }

  bodyColorActive(instanceId: InstanceId, bodyId: BodyId): boolean {
    return (
      this.options.interaction().bodyOverrides.get(instanceId)?.get(bodyId)?.color !== undefined
    );
  }

  private slotForInstance(instanceId: string): number | undefined {
    return this.options.slotByInstanceId.get(instanceId);
  }

  private partForTarget(target: SelectTarget): PartId | undefined {
    if (target.kind === "part") return target.partId;
    const runtime = this.options.runtime();
    const slot = this.slotForInstance(target.instanceId);
    return slot === undefined ? undefined : runtime.instancePartIds[slot];
  }

  private finish(): void {
    this.options.syncPanel();
    this.options.render();
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
