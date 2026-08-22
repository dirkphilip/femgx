import { Injectable, signal } from "@angular/core";

/** Explicit lifecycle state presented by the Angular foundation slice. */
export type AngularLifecycle =
  | { readonly status: "idle" }
  | { readonly status: "starting" }
  | { readonly status: "ready" }
  | { readonly status: "unsupported"; readonly reason: string; readonly message: string }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "destroyed" };

/** Owns semantic synchronous state for the Angular application shell. */
@Injectable()
export class AngularApplicationState {
  private readonly lifecycleState = signal<AngularLifecycle>({ status: "idle" });
  readonly lifecycle = this.lifecycleState.asReadonly();

  /** Publishes one complete lifecycle value. */
  transition(next: AngularLifecycle): void {
    this.lifecycleState.set(next);
  }
}

/** Returns concise presentation text for one lifecycle value. */
export function lifecycleMessage(state: AngularLifecycle): string {
  switch (state.status) {
    case "idle":
      return "Waiting to create the WebGPU viewport.";
    case "starting":
      return "Creating the WebGPU viewport…";
    case "ready":
      return "WebGPU viewport ready.";
    case "unsupported":
      return `${state.message} (${state.reason})`;
    case "failed":
      return `Viewport failed: ${state.message}`;
    case "destroyed":
      return "Viewport destroyed.";
  }
}
