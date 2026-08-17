import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyOccurrenceId, InstanceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { Scene } from "../scene/scene";
import type { SceneNavigationBoundsCache } from "./scene-bounds";
import { UnknownSceneIdentityError } from "./visibility-error";

interface VisibilityControllerOptions {
  readonly scene: () => Scene;
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

  setPart(partId: PartId, visible: boolean): void {
    if (!this.options.scene().parts.has(partId)) {
      throw new UnknownSceneIdentityError("part", partId);
    }
    this.applyChanged(this.options.runtime().setPartVisible(partId, visible).changedInstanceIds);
  }

  setAssemblyOccurrence(occurrenceId: AssemblyOccurrenceId, visible: boolean): void {
    const runtime = this.options.runtime();
    const node = runtime.getNodeSlot(occurrenceId);
    if (node === undefined)
      throw new UnknownSceneIdentityError("assembly-occurrence", occurrenceId);
    this.applyChanged(runtime.setAssemblyNodeVisible(node, visible).changedInstanceIds);
  }

  setAssembly(assemblyId: AssemblyId, visible: boolean): void {
    if (!this.options.scene().assemblies.has(assemblyId)) {
      throw new UnknownSceneIdentityError("assembly", assemblyId);
    }
    this.applyChanged(
      this.options.runtime().setAssemblyVisible(assemblyId, visible).changedInstanceIds,
    );
  }

  setInstance(instanceId: InstanceId, visible: boolean): void {
    const runtime = this.options.runtime();
    const slot = runtime.getInstanceSlot(instanceId);
    if (slot === undefined) throw new UnknownSceneIdentityError("instance", instanceId);
    this.applyChanged(runtime.setInstanceVisible(slot, visible).changedInstanceIds);
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
