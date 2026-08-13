import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";

/** Flushes deferred viewport visibility updates and the pending render. */
export function flushViewportBatch(options: {
  readonly pendingVisibility: Set<number>;
  readonly batchDirty: boolean;
  readonly runtime: PackedSceneRuntime;
  readonly renderer: WebGpuRenderer;
  readonly invalidate: () => void;
}): void {
  if (options.pendingVisibility.size > 0) {
    const changed = [...options.pendingVisibility].sort((a, b) => a - b);
    options.pendingVisibility.clear();
    options.renderer.updateVisibility(options.runtime, changed);
  }
  if (options.batchDirty) options.invalidate();
}
