import { describe, expect, it } from "vitest";
import { createPart } from "../../../src/geometry/part";
import { translation } from "../../../src/math/mat4";
import { RendererAttachment } from "../../../src/renderer/attachment";
import { createGpuBundle, destroyGpuBundle } from "../../../src/renderer/recovery";
import {
  encodeInstanceRecord,
  INSTANCE_STRIDE,
  type InstanceStorage,
} from "../../../src/renderer/resources/instance-storage";
import { defaultStyle } from "../../../src/renderer/resources/foundation";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { createScene } from "../../../src/scene/scene";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

describe("cold renderer attachment", () => {
  it("writes exact records and visible order again after a cleared attachment", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const scene = buildScene();
      const runtime = createPackedSceneRuntime(scene);
      runtime.setInstanceVisible(1, false);
      const attachment = new RendererAttachment();
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);

      const first = bundle.draw.storages.get(1);
      expect(first).toBeDefined();
      assertStorage(first, runtime);
      const writesAfterFirst = gpu.writes.length;

      attachment.clear(bundle);
      attachment.attach(runtime, bundle);
      const second = bundle.draw.storages.get(1);
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(gpu.writes).toHaveLength(writesAfterFirst + 2);
      assertStorage(second, runtime);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });
});

function assertStorage(
  storage: InstanceStorage | undefined,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
): void {
  if (storage === undefined) throw new Error("Instance storage is missing");
  expect(storage.capacity).toBe(3);
  expect(storage.orderLength).toBe(2);
  expect(Array.from(storage.orderData.subarray(0, 2))).toEqual([0, 2]);
  for (let slot = 0; slot < 3; slot += 1) {
    const expected = encodeInstanceRecord(
      runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
      defaultStyle,
      slot + 1,
    );
    expect(new Uint8Array(storage.data, slot * INSTANCE_STRIDE, INSTANCE_STRIDE)).toEqual(
      new Uint8Array(expected),
    );
  }
}

function buildScene() {
  const part = createPart(1, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
  });
  return createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "cold-attachment",
      placements: [0, 1, 2].map((slot) => ({
        kind: "part" as const,
        placementId: String(slot),
        partId: 1,
        transform: translation(slot, slot * 2, slot * 3),
      })),
    })
    .withRoot(1)
    .build();
}
