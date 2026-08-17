import { vi } from "vitest";
import {
  createInteractionState,
  type InteractionState,
  type InteractionTarget,
  type PickHit,
  type Viewport,
} from "../../src/entries/root";
import { createCamera } from "../../src/camera/camera";

type Listener = (event: unknown) => void;
type FaceTarget = Extract<InteractionTarget, { readonly kind: "face" }>;
interface ScheduledFrame {
  readonly handle: number;
  readonly callback: FrameRequestCallback;
}

type RuntimeWithAnimationFrame = {
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
};

const runtime = globalThis as RuntimeWithAnimationFrame;
const originalRequestAnimationFrame = runtime.requestAnimationFrame;
const originalCancelAnimationFrame = runtime.cancelAnimationFrame;
let scheduledFrames: ScheduledFrame[] = [];
let nextFrameHandle = 0;

/** Minimal event target used to exercise listener lifecycle without a browser. */
export class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    const callback = toListener(listener);
    const listeners = this.listenersFor(type);
    listeners.add(callback);
    options?.signal?.addEventListener("abort", () => listeners.delete(callback), { once: true });
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(toListener(listener));
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  private listenersFor(type: string): Set<Listener> {
    const existing = this.listeners.get(type);
    if (existing !== undefined) return existing;
    const created = new Set<Listener>();
    this.listeners.set(type, created);
    return created;
  }
}

/** Canvas-shaped event target used by the interaction harness. */
export class FakeCanvas extends FakeEventTarget {
  private readonly captures = new Set<number>();

  getBoundingClientRect(): DOMRect {
    return { left: 10, top: 20, width: 200, height: 100 } as DOMRect;
  }

  setPointerCapture(pointerId: number): void {
    this.captures.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captures.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captures.delete(pointerId);
  }
}

export interface PointerInput {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly preventDefault: ReturnType<typeof vi.fn>;
}

export const target: FaceTarget = {
  kind: "face",
  instanceId: "1/0",
  elementId: 2,
  faceIndex: 0,
};

export const hit: PickHit = {
  kind: "face",
  partId: 1,
  instanceId: "1/0",
  elementId: 2,
  faceIndex: 0,
  key: "1:2:0",
  nodeIds: [1, 2, 3],
  neighborElementIds: [],
  worldPosition: [0, 0, 0],
  normal: [0, 0, 1],
};

export interface ViewportHarness {
  readonly canvas: FakeCanvas;
  readonly window: FakeEventTarget;
  readonly viewport: Viewport;
  readonly setInteraction: ReturnType<typeof vi.fn>;
  readonly pick: ReturnType<typeof vi.fn>;
  readonly pickRegion: ReturnType<typeof vi.fn>;
}

/** Creates a viewport with deterministic pick and region-query seams. */
export function viewportHarness(initial = createInteractionState()): ViewportHarness {
  const canvas = new FakeCanvas();
  const window = new FakeEventTarget();
  let interaction = initial;
  const setInteraction = vi.fn((next: InteractionState) => {
    interaction = next;
  });
  const pick = vi.fn(() => Promise.resolve(hit));
  const pickRegion = vi.fn(() => Promise.resolve([target]));
  const viewport = {
    view: {
      get camera() {
        return createCamera({ width: 200, height: 100 });
      },
    },
    interaction: {
      get state() {
        return interaction;
      },
      pick,
      pickRegion,
      set: setInteraction,
    },
  } as unknown as Viewport;
  return { canvas, window, viewport, setInteraction, pick, pickRegion };
}

export const pointer = (overrides: Partial<PointerInput> = {}): PointerInput => ({
  pointerId: 1,
  pointerType: "mouse",
  button: 0,
  buttons: 0,
  clientX: 50,
  clientY: 60,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  preventDefault: vi.fn(),
  ...overrides,
});

export const click = (overrides: Partial<PointerInput> = {}): PointerInput => pointer(overrides);

/** Flushes one queued animation frame and the two promise turns used by interaction handlers. */
export async function settle(): Promise<void> {
  flushAnimationFrame();
  await Promise.resolve();
  await Promise.resolve();
}

/** Runs one queued animation-frame batch from the interaction harness. */
export function flushAnimationFrame(): void {
  const frames = scheduledFrames;
  scheduledFrames = [];
  for (const frame of frames) frame.callback(0);
}

const originalWindow = (globalThis as { readonly window?: unknown }).window;

/** Installs the fake global window used by viewport interaction registration. */
export function installFakeWindow(): void {
  (globalThis as { window?: unknown }).window = new FakeEventTarget();
  scheduledFrames = [];
  nextFrameHandle = 0;
  runtime.requestAnimationFrame = (callback) => {
    const handle = ++nextFrameHandle;
    scheduledFrames.push({ handle, callback });
    return handle;
  };
  runtime.cancelAnimationFrame = (handle) => {
    scheduledFrames = scheduledFrames.filter((frame) => frame.handle !== handle);
  };
}

/** Restores the global window captured before the interaction suite. */
export function restoreFakeWindow(): void {
  scheduledFrames = [];
  if (originalRequestAnimationFrame === undefined) delete runtime.requestAnimationFrame;
  else runtime.requestAnimationFrame = originalRequestAnimationFrame;
  if (originalCancelAnimationFrame === undefined) delete runtime.cancelAnimationFrame;
  else runtime.cancelAnimationFrame = originalCancelAnimationFrame;
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
}

function toListener(listener: EventListenerOrEventListenerObject): Listener {
  return typeof listener === "function"
    ? (listener as Listener)
    : (event) => {
        listener.handleEvent(event as Event);
      };
}
