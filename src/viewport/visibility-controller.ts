import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { SceneNavigationBoundsCache } from "./scene-bounds";
import type { ViewportSceneController } from "./scene-controller";
import { UnknownSceneIdentityError } from "./visibility-error";

interface VisibilityControllerOptions {
  readonly sceneController: ViewportSceneController;
  readonly renderer: WebGpuRenderer;
  readonly isBatching: () => boolean;
  readonly invalidate: () => void;
  readonly navigationBoundsCache: SceneNavigationBoundsCache;
}

/** Owns viewport visibility mutations and their deferred renderer updates. */
export class ViewportVisibilityController {
  private readonly pendingVisibility = new Set<PartId>();

  constructor(private readonly options: VisibilityControllerOptions) {}

  setPart(partId: PartId, visible: boolean): void {
    if (!this.options.sceneController.scene.parts.has(partId)) {
      throw new UnknownSceneIdentityError("part", partId);
    }
    const runtime = this.options.sceneController.runtime;
    this.applyChanged(
      this.options.sceneController.visibility.setPart(runtime, partId, visible).affectedPartIds,
    );
  }

  setAssemblyOccurrence(occurrenceId: AssemblyOccurrenceId, visible: boolean): void {
    const runtime = this.options.sceneController.runtime;
    const node = runtime.getNodeSlot(occurrenceId);
    if (node === undefined)
      throw new UnknownSceneIdentityError("assembly-occurrence", occurrenceId);
    this.applyChanged(
      this.options.sceneController.visibility.setAssemblyOccurrence(
        runtime,
        occurrenceId,
        node,
        visible,
      ).affectedPartIds,
    );
  }

  setAssembly(assemblyId: AssemblyId, visible: boolean): void {
    if (!this.options.sceneController.scene.assemblies.has(assemblyId)) {
      throw new UnknownSceneIdentityError("assembly", assemblyId);
    }
    const runtime = this.options.sceneController.runtime;
    this.applyChanged(
      this.options.sceneController.visibility.setAssembly(runtime, assemblyId, visible)
        .affectedPartIds,
    );
  }

  setPartOccurrence(partOccurrenceId: PartOccurrenceId, visible: boolean): void {
    this.setPartOccurrences([partOccurrenceId], visible);
  }

  setPartOccurrences(partOccurrenceIds: Iterable<PartOccurrenceId>, visible: boolean): void {
    const runtime = this.options.sceneController.runtime;
    const occurrenceIds: PartOccurrenceId[] = [];
    const slots: number[] = [];
    const seen = new Set<PartOccurrenceId>();
    for (const occurrenceId of partOccurrenceIds) {
      const slot = runtime.getInstanceSlot(occurrenceId);
      if (slot === undefined) throw new UnknownSceneIdentityError("partOccurrence", occurrenceId);
      if (seen.has(occurrenceId)) continue;
      seen.add(occurrenceId);
      occurrenceIds.push(occurrenceId);
      slots.push(slot);
    }
    this.applyChanged(
      this.options.sceneController.visibility.setPartOccurrences(
        runtime,
        occurrenceIds,
        slots,
        visible,
      ).affectedPartIds,
    );
  }

  reset(): void {
    this.pendingVisibility.clear();
  }

  flush(): void {
    if (this.pendingVisibility.size === 0) return;
    const changed = [...this.pendingVisibility].sort((a, b) => a - b);
    this.pendingVisibility.clear();
    this.options.renderer.updateVisibility(this.options.sceneController.runtime, changed);
  }

  private applyChanged(changed: readonly PartId[]): void {
    if (changed.length === 0) return;
    this.options.navigationBoundsCache.invalidate();
    if (this.options.isBatching()) {
      for (const partId of changed) this.pendingVisibility.add(partId);
    } else {
      this.options.renderer.updateVisibility(this.options.sceneController.runtime, changed);
    }
    this.options.invalidate();
  }
}
