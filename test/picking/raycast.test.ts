import { describe, expect, it } from "vitest";
import { createCamera, projectPoint, resizeCamera } from "../../src/camera/camera";
import type { ElementModel } from "../../src/elements/model";
import { createFrameFixture } from "../../src/fixture/frame-fixture";
import { createPanelFixture } from "../../src/fixture/panel";
import {
  createPickScene,
  faceOwnership,
  pick,
  pickElement,
  pickNode,
  resolveFacePick,
  type PickScene,
} from "../../src/picking/raycast";
import type { PickRequest } from "../../src/picking/pick-scene";
import { rayFromCamera } from "../../src/picking/ray";
import { createSceneRuntime, type SceneRuntime } from "../../src/scene-runtime/runtime";

interface Harness {
  readonly runtime: SceneRuntime;
  readonly pickScene: PickScene;
  readonly camera: ReturnType<typeof resizeCamera>;
}

function frameHarness(): Harness {
  const fixture = createFrameFixture();
  const runtime = createSceneRuntime(fixture.scene);
  const pickScene = createPickScene(fixture.scene.parts, fixture.elementModels);
  const camera = resizeCamera(
    createCamera({ position: [3.5, 2.5, 12], target: [3.5, 2.5, 0.5] }),
    800,
    600,
  );
  return { runtime, pickScene, camera };
}

function request(harness: Harness, point: [number, number, number]): PickRequest {
  const screen = projectPoint(harness.camera, point);
  if (screen === undefined) throw new Error("point does not project");
  return {
    runtime: harness.runtime,
    camera: harness.camera,
    x: screen[0],
    y: screen[1],
  };
}

function nodeIdAt(model: ElementModel, x: number, y: number, z: number): number {
  for (let id = 0; id < model.nodes.length / 3; id++) {
    if (
      model.nodes[id * 3] === x &&
      model.nodes[id * 3 + 1] === y &&
      model.nodes[id * 3 + 2] === z
    ) {
      return id;
    }
  }
  throw new Error(`no node at ${x},${y},${z}`);
}

describe("rayFromCamera", () => {
  it("builds a ray through the projected point of a world position", () => {
    const { camera } = frameHarness();
    const screen = projectPoint(camera, [0.5, 2.5, 1]);
    if (screen === undefined) throw new Error("point does not project");
    const ray = rayFromCamera(camera, screen[0], screen[1]);
    const direction = normalize(subtract([0.5, 2.5, 1], ray.origin));
    expect(dot(normalize(ray.direction), direction)).toBeGreaterThan(0.999);
  });
});

describe("pickElement", () => {
  it("hits the front face of the frame column", () => {
    const harness = frameHarness();
    const hit = pickElement(harness.pickScene, request(harness, [0.5, 2.5, 1]));
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe("element");
    expect(hit?.elementId).toBe(3);
    expect(hit?.partId).toBe(1);
    expect(Math.abs(hit?.normal[2] ?? 0)).toBeGreaterThan(0.99);
  });

  it("returns undefined when the ray misses", () => {
    const harness = frameHarness();
    const req: PickRequest = { runtime: harness.runtime, camera: harness.camera, x: 5, y: 5 };
    expect(pickElement(harness.pickScene, req)).toBeUndefined();
  });
});

describe("pickNode", () => {
  it("finds the column-beam joint node near the pointer", () => {
    const harness = frameHarness();
    const model = harness.pickScene.elementModels.get(1) as ElementModel;
    const id = nodeIdAt(model, 0, 5, 0);
    const hit = pickNode(harness.pickScene, request(harness, [0, 5, 0]), 12);
    expect(hit?.kind).toBe("node");
    expect(hit?.nodeId).toBe(id);
    expect(hit?.position).toEqual([0, 5, 0]);
    expect(hit?.adjacentElementIds.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("picks shell corner nodes on the deck panel", () => {
    const fixture = createPanelFixture();
    const runtime = createSceneRuntime(fixture.scene);
    const pickScene = createPickScene(fixture.scene.parts, fixture.elementModels);
    const camera = resizeCamera(
      createCamera({ position: [2, 1.5, 6], target: [2, 1.5, 0] }),
      800,
      600,
    );
    const screen = projectPoint(camera, [0, 0, 0]);
    if (screen === undefined) throw new Error("corner does not project");
    const hit = pickNode(pickScene, { runtime, camera, x: screen[0], y: screen[1] }, 12);
    expect(hit?.kind).toBe("node");
    expect(hit?.position).toEqual([0, 0, 0]);
  });
});

describe("resolveFacePick", () => {
  it("resolves an element hit to its front face with an outward normal", () => {
    const harness = frameHarness();
    const req = request(harness, [0.5, 2.5, 1]);
    const elementHit = pickElement(harness.pickScene, req);
    expect(elementHit).toBeDefined();
    const face = resolveFacePick(harness.pickScene, req, elementHit as never);
    expect(face?.kind).toBe("face");
    expect(Math.abs(face?.normal[2] ?? 0)).toBeGreaterThan(0.99);
    expect(face?.boundary).toBe(true);
    expect(face?.adjacentElementIds).toContain(3);
  });

  it("reports shared interior faces with two adjacent elements", () => {
    const { pickScene } = frameHarness();
    const model = pickScene.elementModels.get(1) as ElementModel;
    const ids = [
      nodeIdAt(model, 0, 5, 0),
      nodeIdAt(model, 1, 5, 0),
      nodeIdAt(model, 1, 5, 1),
      nodeIdAt(model, 0, 5, 1),
    ].sort((a, b) => a - b);
    const ownership = faceOwnership(pickScene, 1, ids.join(","));
    expect(ownership?.boundary).toBe(false);
    expect(ownership?.adjacentElementIds.length).toBe(2);
  });
});

describe("pick", () => {
  it("prefers a node over a face at a joint", () => {
    const harness = frameHarness();
    const hit = pick(harness.pickScene, request(harness, [0, 5, 0]), 12);
    expect(hit?.kind).toBe("node");
  });

  it("resolves an element when no node is near", () => {
    const harness = frameHarness();
    const hit = pick(harness.pickScene, request(harness, [0.5, 2.5, 1]), 12);
    expect(hit?.kind).toBe("face");
  });
});

function subtract(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: readonly [number, number, number]): readonly [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}
