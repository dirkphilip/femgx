import type { CameraFocusController } from "./camera-focus";
import type { OrientationGizmoHandle } from "./orientation-gizmo";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { Camera } from "../camera/camera";

interface LifecycleControllerOptions {
  readonly renderer: WebGpuRenderer;
  readonly cameraFocus: CameraFocusController;
  readonly removeControls: () => void;
  readonly removeResize: () => void;
  readonly removeKeyboard: () => void;
  readonly orientationGizmo: OrientationGizmoHandle | undefined;
  readonly resetInteraction: () => void;
  readonly render: () => void;
  readonly onRecovered: (() => void) | undefined;
  readonly onError: ((error: unknown) => void) | undefined;
}

/** Owns the viewport's recovery state machine and final resource teardown. */
export class ViewportLifecycleController {
  private batchDepth = 0;
  private batchDirty = false;
  private frame: number | undefined;
  private recoveryPromise: Promise<void> | undefined;
  private destroyed = false;

  constructor(private readonly options: LifecycleControllerOptions) {}

  ensureAlive(): void {
    if (this.destroyed) throw new Error("Viewport has been destroyed");
  }

  get isBatching(): boolean {
    return this.batchDepth > 0;
  }

  batch<T>(operation: () => T, flush: () => void): T {
    this.batchDepth += 1;
    try {
      return operation();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) {
        flush();
        const dirty = this.batchDirty;
        this.batchDirty = false;
        if (dirty) this.invalidate();
      }
    }
  }

  markDirty(): void {
    this.batchDirty = true;
  }

  invalidate(): void {
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    if (this.frame !== undefined) return;
    if (typeof requestAnimationFrame === "undefined") {
      this.options.render();
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.options.render();
    });
  }

  updateOrientationGizmo(camera: Camera): void {
    this.options.orientationGizmo?.update(camera);
  }

  recover(): Promise<void> {
    this.ensureAlive();
    if (this.recoveryPromise !== undefined) return this.recoveryPromise;
    const recovery = this.options.renderer.recover().then(() => {
      this.options.resetInteraction();
      this.options.render();
      this.options.onRecovered?.();
    });
    this.recoveryPromise = recovery;
    const clearRecovery = (): void => {
      if (this.recoveryPromise === recovery) this.recoveryPromise = undefined;
    };
    recovery.then(clearRecovery, clearRecovery);
    return recovery;
  }

  handleDeviceLoss(): void {
    if (this.destroyed) return;
    void this.recover().catch((error: unknown) => {
      if (this.destroyed) return;
      this.destroy();
      this.options.onError?.(error);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelFrame();
    this.options.cameraFocus.dispose();
    this.options.removeControls();
    this.options.removeResize();
    this.options.removeKeyboard();
    this.options.orientationGizmo?.destroy();
    this.options.renderer.destroy();
  }

  private cancelFrame(): void {
    if (this.frame !== undefined && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.frame);
    }
    this.frame = undefined;
  }
}
