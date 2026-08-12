import { fitCamera, type Bounds, type Camera, type FemViewport, type Vec3 } from "../../src/index";

const FIT_TRANSITION_MS = 1000;

/** Owns the interruptible camera transition used by selection fitting. */
export class WorkbenchCameraTransition {
  private cancelAnimation: (() => void) | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly viewport: () => FemViewport,
    private readonly onFrame: () => void,
    signal: AbortSignal,
  ) {
    canvas.addEventListener(
      "wheel",
      () => {
        this.cancel();
      },
      { passive: true, signal },
    );
  }

  fit(bounds: Bounds): void {
    this.cancel();
    const viewport = this.viewport();
    const rect = this.canvas.getBoundingClientRect();
    const target = fitCamera(
      viewport.camera,
      bounds,
      Math.max(1, rect.width),
      Math.max(1, rect.height),
    );
    this.cancelAnimation = animateCamera(viewport, target, this.onFrame);
  }

  cancel(): void {
    this.cancelAnimation?.();
    this.cancelAnimation = undefined;
  }
}

function animateCamera(viewport: FemViewport, target: Camera, onFrame: () => void): () => void {
  const initial = viewport.camera;
  let startTime: number | undefined;
  let frame = requestAnimationFrame(function tick(time): void {
    startTime ??= time;
    const progress = Math.min(1, (time - startTime) / FIT_TRANSITION_MS);
    viewport.setCamera(interpolateCamera(initial, target, easeOutCubic(progress)));
    onFrame();
    if (progress < 1) frame = requestAnimationFrame(tick);
  });
  return () => {
    cancelAnimationFrame(frame);
  };
}

function interpolateCamera(initial: Camera, target: Camera, amount: number): Camera {
  return {
    ...target,
    position: interpolateVector(initial.position, target.position, amount),
    target: interpolateVector(initial.target, target.target, amount),
    up: interpolateVector(initial.up, target.up, amount),
    fovY: interpolate(initial.fovY, target.fovY, amount),
    near: interpolate(initial.near, target.near, amount),
    far: interpolate(initial.far, target.far, amount),
    orthoHeight: interpolate(initial.orthoHeight, target.orthoHeight, amount),
  };
}

function interpolateVector(initial: Vec3, target: Vec3, amount: number): Vec3 {
  return [
    interpolate(initial[0], target[0], amount),
    interpolate(initial[1], target[1], amount),
    interpolate(initial[2], target[2], amount),
  ];
}

function interpolate(initial: number, target: number, amount: number): number {
  return initial + (target - initial) * amount;
}

function easeOutCubic(amount: number): number {
  return 1 - (1 - amount) ** 3;
}
