import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyOccurrenceId, InstanceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { SceneNavigationBoundsCache } from "./scene-bounds";

interface VisibilityControllerOptions {
  readonly runtime: () => PackedSceneRuntime;
  readonly renderer: WebGpuRenderer;
  readonly isBatching: () => boolean;
  readonly invalidate: () => void;
  readonly navigationBoundsCache: SceneNavigationBoundsCache;
}

/** Owns viewport visibility mutations and their deferred renderer updates. */
export class ViewportVisibilityController {
  private readonly pendingVisibility = new Set<number>();

  constructor(private readonly options: VisibilityControllerOptions) {}

  setPartVisible(partId: PartId, visible: boolean): void {
    this.applyChanged(this.options.runtime().setPartVisible(partId, visible).changedInstanceIds);
  }

  setAssemblyOccurrenceVisible(occurrenceId: AssemblyOccurrenceId, visible: boolean): void {
    const runtime = this.options.runtime();
    const node = runtime.getNodeSlot(occurrenceId);
    this.applyChanged(
      node === undefined ? [] : runtime.setAssemblyNodeVisible(node, visible).changedInstanceIds,
    );
  }

  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void {
    this.applyChanged(
      this.options.runtime().setAssemblyVisible(assemblyId, visible).changedInstanceIds,
    );
  }

  setInstanceVisible(instanceId: InstanceId, visible: boolean): void {
    const runtime = this.options.runtime();
    const slot = runtime.getInstanceSlot(instanceId);
    this.applyChanged(
      slot === undefined ? [] : runtime.setInstanceVisible(slot, visible).changedInstanceIds,
    );
  }

  reset(): void {
    this.pendingVisibility.clear();
  }

  flush(): void {
    if (this.pendingVisibility.size === 0) return;
    const changed = [...this.pendingVisibility].sort((a, b) => a - b);
    this.pendingVisibility.clear();
    this.options.renderer.updateVisibility(this.options.runtime(), changed);
  }

  private applyChanged(changed: readonly number[]): void {
    if (changed.length === 0) return;
    this.options.navigationBoundsCache.invalidate();
    if (this.options.isBatching()) {
      for (const slot of changed) this.pendingVisibility.add(slot);
    } else {
      this.options.renderer.updateVisibility(this.options.runtime(), changed);
    }
    this.options.invalidate();
  }
}
