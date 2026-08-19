import { afterEach, describe, expect, it, vi } from "vitest";
import { createCamera } from "../../src/camera/camera";
import {
  applyViewCubeAction,
  rotateCameraByStep,
  type ViewCubeAction,
} from "../../src/camera/view-cube";
import { createInteractionState } from "../../src/interaction/interaction";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { CameraFocusController } from "../../src/viewport/camera-focus";
import { sceneWorldBounds } from "../../src/viewport/scene-bounds";
import { createViewport } from "../../src/viewport/viewport";
import { fakeCanvas } from "../renderer/fake-gpu";
import { fakeGpuDevice, installNavigator, installTestGpuGlobals, scene } from "./viewport/support";

class TestNode {
  readonly children: TestNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  readonly style: Record<string, string> = {};
  parent: TestNode | undefined;
  ownerDocument: TestDocument | undefined;
  className = "";
  textContent = "";

  constructor(private readonly contained?: unknown) {}

  appendChild(child: TestNode): TestNode {
    const index = child.parent?.children.indexOf(child) ?? -1;
    if (index >= 0) child.parent?.children.splice(index, 1);
    child.parent = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  contains(candidate: unknown): boolean {
    return (
      candidate === this.contained ||
      this.children.some((child) => child === candidate || child.contains(candidate))
    );
  }

  remove(): void {
    const index = this.parent?.children.indexOf(this) ?? -1;
    if (index >= 0) this.parent?.children.splice(index, 1);
    this.parent = undefined;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(name: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  dispatchEvent(name: string, event: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

class TestDocument {
  activeElement: TestNode | null = null;

  createElement(): TestNode {
    return this.createNode();
  }

  createElementNS(): TestNode {
    return this.createNode();
  }

  private createNode(): TestNode {
    const node = new TestNode();
    node.ownerDocument = this;
    return node;
  }
}

interface ScheduledFrame {
  readonly id: number;
  readonly callback: (time: number) => void;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("camera focus gizmo actions", () => {
  it("animates face snaps to the exact endpoint across a viewport resize", () => {
    const frames: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const currentScene = scene();
    const runtime = createPackedSceneRuntime(currentScene);
    const initial = createCamera({ position: [4, 3, 8], target: [0, 0, 0] });
    const cameraRef = { camera: initial };
    const focus = new CameraFocusController({
      cameraRef,
      canvas: fakeCanvas(),
      scene: () => currentScene,
      runtime: () => runtime,
      interaction: createInteractionState,
      deformation: () => undefined,
      invalidate: vi.fn(),
    });

    focus.applyOrientationAction({ kind: "face", face: "right" });

    expect(frames).toHaveLength(1);
    frames.shift()?.(0);
    cameraRef.camera = { ...cameraRef.camera, width: 1200, height: 700 };
    frames.shift()?.(200);
    frames.shift()?.(400);
    expect(cameraRef.camera.position[1]).toBe(cameraRef.camera.target[1]);
    expect(cameraRef.camera.position[2]).toBe(cameraRef.camera.target[2]);
    expect(cameraRef.camera.position[0]).toBeGreaterThan(cameraRef.camera.target[0]);
    expect(cameraRef.camera.width).toBe(1200);
    expect(cameraRef.camera.height).toBe(700);
  });

  it("animates orientation actions with the default camera transition", () => {
    const frames: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const currentScene = scene();
    const runtime = createPackedSceneRuntime(currentScene);
    const cameraRef = {
      camera: createCamera({ position: [0, 0, 8], target: [0, 0, 0] }),
    };
    const focus = new CameraFocusController({
      cameraRef,
      canvas: fakeCanvas(),
      scene: () => currentScene,
      runtime: () => runtime,
      interaction: createInteractionState,
      deformation: () => undefined,
      invalidate: vi.fn(),
    });
    const initial = cameraRef.camera;

    focus.applyOrientationAction({ kind: "rotate", rotation: "left", stepDegrees: 15 });

    expect(frames).toHaveLength(1);
    expect(cameraRef.camera).toBe(initial);
    frames.shift()?.(0);
    frames.shift()?.(200);
    expect(cameraRef.camera.position).not.toEqual(initial.position);
    expect(frames).toHaveLength(1);
    frames.shift()?.(400);

    const expected = rotateCameraByStep(
      initial,
      { minX: -1, minY: -1, minZ: 0, maxX: 1, maxY: 1, maxZ: 0 },
      "left",
      15,
    );
    expect(cameraRef.camera).toEqual(expected);
    expect(frames).toHaveLength(0);
  });

  it("animates public gizmo actions across viewport resize", async () => {
    vi.stubGlobal("document", new TestDocument());
    installTestGpuGlobals();
    installNavigator();
    const frames: ScheduledFrame[] = [];
    let nextFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
      const frame = { id: nextFrameId++, callback };
      frames.push(frame);
      return frame.id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      const index = frames.findIndex((frame) => frame.id === id);
      if (index >= 0) frames.splice(index, 1);
    });
    const runFrame = (time: number): void => {
      const frame = frames.shift();
      if (frame === undefined) throw new Error("Expected a scheduled frame");
      frame.callback(time);
    };

    const currentScene = scene();
    const runtime = createPackedSceneRuntime(currentScene);
    const bounds = sceneWorldBounds(currentScene, runtime, undefined);
    const canvas = fakeCanvas();
    const container = new TestNode(canvas);
    container.ownerDocument = globalThis.document as unknown as TestDocument;
    const viewport = await createViewport({
      canvas,
      scene: currentScene,
      device: fakeGpuDevice().device,
      camera: createCamera({ position: [0, 0, 8], target: [0, 0, 0] }),
      orientationGizmo: { container: container as unknown as HTMLElement },
    });
    const svg = container.children[0]?.children[0];
    const target = (attribute: string, value: string): TestNode => {
      const match = svg?.children.find((child) => child.getAttribute(attribute) === value);
      if (match === undefined) throw new Error(`Missing gizmo target ${attribute}=${value}`);
      return match;
    };
    const dispatch = (action: TestNode, event: Readonly<Record<string, unknown>> = {}): void => {
      action.dispatchEvent("pointerup", { button: 0, isPrimary: true, ...event });
    };
    const initial = viewport.view.camera;
    const expectedFace = applyViewCubeAction(initial, bounds, { kind: "face", face: "back" });
    dispatch(target("data-view-face", "back"));
    expect(frames).toHaveLength(1);
    runFrame(0);
    runFrame(200);
    runFrame(200);
    const inFlight = viewport.view.camera;
    expect(inFlight).not.toBe(initial);
    expect(Math.hypot(...inFlight.position)).toBeGreaterThan(7.9);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 1200 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 700 });
    viewport.resize();
    runFrame(600);
    runFrame(600);
    runFrame(600);
    expect(viewport.view.camera).toEqual({ ...expectedFace, width: 1200, height: 700 });
    const cornerAction: ViewCubeAction = { kind: "corner", corner: "+++" };
    const expectedCorner = applyViewCubeAction(viewport.view.camera, bounds, cornerAction);
    dispatch(target("data-view-corner", "+++"));
    expect(frames).toHaveLength(1);
    runFrame(200);
    runFrame(600);
    runFrame(600);
    expect(viewport.view.camera).toEqual(expectedCorner);
    runFrame(600);

    const arrowAction: ViewCubeAction = {
      kind: "rotate",
      rotation: "left",
      stepDegrees: 15,
    };
    const expectedArrow = applyViewCubeAction(viewport.view.camera, bounds, arrowAction);
    dispatch(target("data-rotate", "left"));
    runFrame(800);
    runFrame(1200);
    runFrame(1200);
    expect(viewport.view.camera).toEqual(expectedArrow);
    runFrame(1200);

    const publicTarget = { ...viewport.view.camera, position: [12, 8, 10] as const };
    viewport.view.setCamera(publicTarget, { durationMs: 400 });
    runFrame(1400);
    runFrame(1600);
    viewport.resize();
    runFrame(1800);
    expect(viewport.view.camera).not.toEqual(publicTarget);
    viewport.destroy();
  });
});
