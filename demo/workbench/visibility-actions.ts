import type { FemViewport, PartId, SceneRuntime } from "../../src/index";
import type { SelectTarget } from "../pick";

/** Runtime hooks used by menu and visibility-panel visibility actions. */
export interface VisibilityActionOptions {
  readonly viewport: () => FemViewport;
  readonly runtime: () => SceneRuntime;
  readonly slotByInstanceId: ReadonlyMap<string, number>;
  readonly firstSlotByPart: ReadonlyMap<PartId, number>;
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

  setInstance(slot: number, visible: boolean): void {
    this.options.viewport().setInstanceVisible(slot, visible);
    this.finish();
  }

  setAssemblyNode(nodeId: number, visible: boolean): void {
    this.options.viewport().setAssemblyNodeVisible(nodeId, visible);
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
