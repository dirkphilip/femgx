import { computed, inject, Injectable } from "@angular/core";
import { createTet4Fixture } from "fixtures/fe/tet4";
import { ViewportCoordinator } from "../../effects/viewport/viewport-coordinator";
import { AngularApplicationState, lifecycleMessage } from "../../state/application-state";

/** Narrow feature surface for the first Angular viewer slice. */
@Injectable()
export class ViewerFacade {
  private readonly scene = createTet4Fixture().scene;
  private readonly state = inject(AngularApplicationState);
  private readonly coordinator = inject(ViewportCoordinator);
  readonly lifecycle = this.state.lifecycle;
  readonly statusMessage = computed(() => lifecycleMessage(this.lifecycle()));
  readonly retryable = computed(() => {
    const status = this.lifecycle().status;
    return status === "unsupported" || status === "failed";
  });

  /** Starts the fixed-scene viewer through the viewport effect owner. */
  start(canvas: HTMLCanvasElement): Promise<void> {
    return this.coordinator.start(canvas, this.scene);
  }

  /** Routes supported-path recovery through the viewport effect owner. */
  recover(): Promise<void> {
    return this.coordinator.recover();
  }

  /** Releases the feature's viewport lifecycle owner. */
  destroy(): void {
    this.coordinator.destroy();
  }
}
