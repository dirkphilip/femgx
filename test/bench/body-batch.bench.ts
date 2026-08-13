import { afterAll, beforeAll, bench, describe } from "vitest";
import { createPart, type ElementTessellation, type GeometryBody } from "../../src/geometry/part";
import { setBodyVisible } from "../../src/interaction/bodies";
import { identity } from "../../src/math/mat4";
import type { FemViewport } from "../../src/viewport/fem-viewport";
import { createFemViewport } from "../../src/viewport/fem-viewport";
import { createScene } from "../../src/scene/scene";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";

const BODY_COUNT = 64;
const originalNavigator = globalThis.navigator;
let restoreGpuGlobals: (() => void) | undefined;
let viewport: FemViewport | undefined;
let visible = false;

function bodyScene() {
  const positions = new Float32Array(BODY_COUNT * 9);
  const indices = new Uint32Array(BODY_COUNT * 3);
  const elements: ElementTessellation[] = [];
  const bodies: GeometryBody[] = [];
  for (let bodyId = 0; bodyId < BODY_COUNT; bodyId += 1) {
    const vertex = bodyId * 3;
    const x = bodyId * 2;
    positions.set([x, 0, 0, x + 1, 0, 0, x, 1, 0], vertex * 3);
    indices.set([vertex, vertex + 1, vertex + 2], bodyId * 3);
    elements.push({ id: bodyId, primitiveStart: bodyId, primitiveCount: 1, bodyId });
    bodies.push({ id: bodyId, elementIds: [bodyId] });
  }
  const geometry = { primitive: "triangles" as const, positions, indices, elements, bodies };
  return createScene()
    .addPart(createPart(1, geometry))
    .addAssembly({
      id: 1,
      name: "body-benchmark",
      placements: [{ kind: "part", partId: 1, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

function currentViewport(): FemViewport {
  if (viewport === undefined) throw new Error("body benchmark viewport is not initialized");
  return viewport;
}

function updateBodies(batched: boolean): void {
  visible = !visible;
  const apply = (): void => {
    let interaction = currentViewport().interaction;
    for (let bodyId = 0; bodyId < BODY_COUNT; bodyId += 1) {
      interaction = setBodyVisible(interaction, { instanceId: "1/0", bodyId }, visible);
      currentViewport().setInteraction(interaction);
    }
  };
  if (batched) currentViewport().batch(apply);
  else apply();
}

beforeAll(async () => {
  restoreGpuGlobals = installGpuGlobals();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
  const gpu = fakeGpuDevice();
  viewport = await createFemViewport({
    canvas: fakeCanvas(),
    scene: bodyScene(),
    device: gpu.device,
  });
});

afterAll(() => {
  viewport?.destroy();
  restoreGpuGlobals?.();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

describe("body interaction batching", () => {
  bench(`updates ${BODY_COUNT} bodies individually`, () => {
    updateBodies(false);
  });

  bench(`updates ${BODY_COUNT} bodies in one viewport batch`, () => {
    updateBodies(true);
  });
});
