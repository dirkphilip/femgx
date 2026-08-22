import { inject, Injectable } from "@angular/core";
import { createViewport, WebGpuUnsupportedError, type Scene, type Viewport } from "femgx";
import { AngularApplicationState } from "../../state/application-state";

/** Sole Angular owner of one FemGx viewport and its async lifecycle. */
@Injectable()
export class ViewportCoordinator {
  private readonly state = inject(AngularApplicationState);
  private viewport: Viewport | undefined;
  private generation = 0;
  readonly lifecycle = this.state.lifecycle;

  /** Creates one WebGPU viewport and rejects stale async completion. */
  async start(canvas: HTMLCanvasElement, scene: Scene): Promise<void> {
    this.disposeCurrentViewport();
    const generation = this.generation;
    this.state.transition({ status: "starting" });
    try {
      const viewport = await createViewport({
        canvas,
        scene,
        onDeviceLost: () => {
          this.handleDeviceLoss(generation);
        },
        onRecovered: () => {
          if (this.isCurrent(generation)) this.state.transition({ status: "ready" });
        },
        onError: (error) => {
          this.handleRecoveryFailure(generation, error);
        },
      });
      if (!this.isCurrent(generation)) {
        viewport.destroy();
        return;
      }
      this.viewport = viewport;
      this.state.transition({ status: "ready" });
    } catch (error: unknown) {
      if (this.isCurrent(generation)) this.publishFailure(error);
    }
  }

  /** Recovers the current viewport through its supported WebGPU path. */
  async recover(): Promise<void> {
    const viewport = this.viewport;
    if (viewport === undefined) return;
    const generation = this.generation;
    this.state.transition({ status: "starting" });
    try {
      await viewport.recover();
      if (this.isCurrent(generation)) this.state.transition({ status: "ready" });
    } catch (error: unknown) {
      if (this.isCurrent(generation)) this.publishFailure(error);
    }
  }

  /** Destroys the owned viewport and makes all pending work stale. */
  destroy(): void {
    this.generation += 1;
    this.disposeViewport();
    this.state.transition({ status: "destroyed" });
  }

  private disposeCurrentViewport(): void {
    this.generation += 1;
    this.disposeViewport();
  }

  private disposeViewport(): void {
    this.viewport?.destroy();
    this.viewport = undefined;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && this.state.lifecycle().status !== "destroyed";
  }

  private handleDeviceLoss(generation: number): void {
    if (this.isCurrent(generation)) {
      this.state.transition({ status: "starting" });
    }
  }

  private handleRecoveryFailure(generation: number, error: unknown): void {
    if (!this.isCurrent(generation)) return;
    this.generation += 1;
    this.viewport = undefined;
    this.publishFailure(error);
  }

  private publishFailure(error: unknown): void {
    if (error instanceof WebGpuUnsupportedError) {
      this.state.transition({
        status: "unsupported",
        reason: error.reason,
        message: error.message,
      });
      return;
    }
    this.state.transition({ status: "failed", message: errorMessage(error) });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown viewport creation failure";
}
