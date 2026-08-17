import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInteractionState,
  hoveredTarget,
  installViewportInteraction,
  isTargetSelected,
  selectedTargets,
  type BoxSelectionEvent,
  type InteractionState,
  type InteractionTarget,
  type PickHit,
  type Viewport,
  type ViewportInteractionBoxSelection,
} from "../../src/entries/root";
import { createCamera } from "../../src/camera/camera";

type Listener = (event: unknown) => void;

class FakeEventTarget {
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

class FakeCanvas extends FakeEventTarget {
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

interface PointerInput {
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

const pointer = (overrides: Partial<PointerInput> = {}): PointerInput => ({
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

const target: InteractionTarget = { kind: "face", instanceId: "1/0", elementId: 2, faceIndex: 0 };
const hit: PickHit = {
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

interface ViewportHarness {
  readonly canvas: FakeCanvas;
  readonly window: FakeEventTarget;
  readonly viewport: Viewport;
  readonly setInteraction: ReturnType<typeof vi.fn>;
  readonly pick: ReturnType<typeof vi.fn>;
  readonly pickRegion: ReturnType<typeof vi.fn>;
}

function viewportHarness(initial = createInteractionState()): ViewportHarness {
  const canvas = new FakeCanvas();
  const window = new FakeEventTarget();
  let interaction = initial;
  const setInteraction = vi.fn((next: InteractionState) => {
    interaction = next;
  });
  const pick = vi.fn(() => Promise.resolve(hit));
  const pickRegion = vi.fn(() => Promise.resolve([target]));
  const viewport = {
    get interaction() {
      return interaction;
    },
    camera: createCamera({ width: 200, height: 100 }),
    pick,
    pickRegion,
    setInteraction,
  } as unknown as Viewport;
  return { canvas, window, viewport, setInteraction, pick, pickRegion };
}

const click = (overrides: Partial<PointerInput> = {}): PointerInput => pointer(overrides);

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function toListener(listener: EventListenerOrEventListenerObject): Listener {
  return typeof listener === "function"
    ? (listener as Listener)
    : (event) => {
        listener.handleEvent(event as Event);
      };
}

const originalWindow = (globalThis as { readonly window?: unknown }).window;

beforeEach(() => {
  (globalThis as { window?: unknown }).window = new FakeEventTarget();
});

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

describe("installViewportInteraction", () => {
  it("maps default hover and click candidates into one immutable interaction state", async () => {
    const harness = viewportHarness();
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointermove", pointer({ clientX: 30, clientY: 40 }));
    await settle();
    expect(harness.pick).toHaveBeenCalledWith(20, 20, undefined);
    expect(hoveredTarget(harness.viewport.interaction)).toEqual(target);

    harness.canvas.dispatch("pointerdown", pointer());
    harness.canvas.dispatch("click", click());
    await settle();
    expect(selectedTargets(harness.viewport.interaction)).toEqual([target]);
    expect(harness.setInteraction).toHaveBeenCalledTimes(2);
    disposer();
  });

  it("replaces on plain click and toggles only the clicked target with Control or Meta", async () => {
    const other: InteractionTarget = {
      kind: "face",
      instanceId: "1/0",
      elementId: 3,
      faceIndex: 0,
    };
    const harness = viewportHarness();
    harness.pick.mockResolvedValueOnce(hit).mockResolvedValueOnce({ ...hit, elementId: 3 });
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("click", click());
    await settle();
    harness.canvas.dispatch("click", click({ ctrlKey: true }));
    await settle();
    expect(isTargetSelected(harness.viewport.interaction, target)).toBe(true);
    expect(isTargetSelected(harness.viewport.interaction, other)).toBe(true);

    harness.pick.mockResolvedValueOnce(hit);
    harness.canvas.dispatch("click", click({ metaKey: true }));
    await settle();
    expect(isTargetSelected(harness.viewport.interaction, target)).toBe(false);
    expect(isTargetSelected(harness.viewport.interaction, other)).toBe(true);
    disposer();
  });

  it("resolves a box once, reports its frustum, and applies one bulk transition", async () => {
    const harness = viewportHarness();
    const boxEvents: BoxSelectionEvent[] = [];
    const selections: ViewportInteractionBoxSelection[] = [];
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
      onBoxEvent: (event) => boxEvents.push(event),
      onBoxSelection: (selection) => selections.push(selection),
    });

    harness.canvas.dispatch("pointerdown", pointer({ clientX: 30, clientY: 40, buttons: 1 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 80, clientY: 90, buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 80, clientY: 90 }));
    await settle();

    expect(boxEvents.map((event) => event.type)).toEqual(["start", "complete"]);
    expect(harness.pickRegion).toHaveBeenCalledOnce();
    expect(selections).toHaveLength(1);
    const selection = selections[0];
    expect(selection?.granularity).toBe("face");
    expect(selection?.targets).toEqual([target]);
    expect(selection?.frustum.left.normal).toHaveLength(3);
    expect(selection?.frustum.far.normal).toHaveLength(3);
    expect(isTargetSelected(harness.viewport.interaction, target)).toBe(true);
    expect(harness.setInteraction).toHaveBeenCalledOnce();
    disposer();
  });

  it("serializes region queries and keeps only the newest queued box", async () => {
    let resolveFirst: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const first = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveFirst = resolve;
    });
    const newest: InteractionTarget = { ...target, elementId: 3 };
    let resolveNewest: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const newestResult = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveNewest = resolve;
    });
    const harness = viewportHarness();
    harness.pickRegion.mockReturnValueOnce(first).mockReturnValueOnce(newestResult);
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });
    const completeBox = (anchor: [number, number], current: [number, number]): void => {
      harness.canvas.dispatch(
        "pointerdown",
        pointer({ clientX: anchor[0], clientY: anchor[1], buttons: 1 }),
      );
      harness.canvas.dispatch(
        "pointermove",
        pointer({ clientX: current[0], clientY: current[1], buttons: 1 }),
      );
      harness.canvas.dispatch("pointerup", pointer({ clientX: current[0], clientY: current[1] }));
    };

    completeBox([30, 40], [80, 90]);
    await vi.waitFor(() => {
      expect(harness.pickRegion).toHaveBeenCalledOnce();
    });

    completeBox([40, 50], [90, 95]);
    completeBox([50, 55], [100, 99]);
    await settle();
    expect(harness.pickRegion).toHaveBeenCalledOnce();

    resolveFirst?.([target]);
    await vi.waitFor(() => {
      expect(harness.pickRegion).toHaveBeenCalledTimes(2);
    });
    resolveNewest?.([newest]);
    await settle();

    expect(selectedTargets(harness.viewport.interaction)).toEqual([newest]);
    disposer();
  });

  it("reports a current region failure without changing interaction state", async () => {
    const error = new Error("region failed");
    const errors: Array<{ readonly error: unknown; readonly phase: string }> = [];
    const harness = viewportHarness();
    harness.pickRegion.mockRejectedValue(error);
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
      onError: (failure, phase) => errors.push({ error: failure, phase }),
    });

    harness.canvas.dispatch("pointerdown", pointer({ buttons: 1 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 90, clientY: 95, buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 90, clientY: 95 }));
    await settle();

    expect(errors).toEqual([{ error, phase: "box" }]);
    expect(selectedTargets(harness.viewport.interaction)).toEqual([]);
    expect(harness.setInteraction).not.toHaveBeenCalled();
    disposer();
  });

  it("lets hosts replace discovery and suppress the default mutation", async () => {
    const harness = viewportHarness();
    const errors: unknown[] = [];
    const applyInteraction = vi.fn(() => undefined);
    const resolveRegion = vi.fn(({ frustum }: { readonly frustum: unknown }) => {
      expect(frustum).toBeDefined();
      return Promise.resolve([target]);
    });
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
      resolveRegion,
      applyInteraction,
      onError: (error) => errors.push(error),
    });

    harness.canvas.dispatch("pointerdown", pointer({ buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 100, clientY: 100 }));
    await settle();

    expect(resolveRegion).toHaveBeenCalledOnce();
    expect(applyInteraction).toHaveBeenCalledOnce();
    expect(harness.setInteraction).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    disposer();
  });

  it("does not apply a late point result after disposal", async () => {
    const harness = viewportHarness();
    let resolvePick: (value: PickHit) => void = () => undefined;
    const pendingPick = new Promise<PickHit>((resolve) => {
      resolvePick = resolve;
    });
    harness.pick.mockReturnValue(pendingPick);
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointermove", pointer());
    disposer();
    resolvePick(hit);
    await settle();
    expect(harness.setInteraction).not.toHaveBeenCalled();
  });

  it("ignores the synthetic click when touch stays routed to navigation", async () => {
    const harness = viewportHarness();
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    const touch = pointer({ pointerType: "touch" });
    harness.canvas.dispatch("pointerdown", touch);
    harness.canvas.dispatch("pointerup", touch);
    harness.canvas.dispatch("click", click());
    await settle();

    expect(harness.pick).not.toHaveBeenCalled();
    expect(harness.setInteraction).not.toHaveBeenCalled();
    disposer();
  });
});
