import { describe, expect, it } from "vitest";
import { createPart, type Geometry } from "../../src/geometry/part";
import { identity } from "../../src/math/mat4";
import { pickTargetsFromRegion, renderPixelRect } from "../../src/renderer/gpu-pick-region";
import {
  createPickTargets,
  ensurePickTargets,
  type PickTargets,
} from "../../src/renderer/gpu-pick";
import type { PickContext } from "../../src/picking/pick";
import type { Instance } from "../../src/scene/types";
import type { BoxSelectionRect } from "../../src/interaction/box-selection";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "./fake-gpu";
import { createPickDepthReadback } from "../../src/renderer/gpu-pick-depth";

function rect(overrides: Partial<BoxSelectionRect> = {}): BoxSelectionRect {
  return {
    left: 10,
    top: 20,
    right: 110,
    bottom: 120,
    width: 100,
    height: 100,
    ...overrides,
  };
}

function instance(partId = 1): Instance {
  return { index: 0, instanceId: "root/0", partId, worldTransform: identity() };
}

function triangleGeometry(): Geometry {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles",
    elements: [{ id: 4, primitiveStart: 0, primitiveCount: 1 }],
  };
}

async function targets(
  gpu: ReturnType<typeof fakeGpuDevice>,
  context: PickContext,
  granularity: "part" | "instance" | "element",
  selection = rect(),
  existingPick?: PickTargets,
) {
  const pick = existingPick ?? createPickTargets(await createPickDepthReadback(gpu.device));
  ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
  return pickTargetsFromRegion({
    device: gpu.device,
    canvas: fakeCanvas(),
    pick,
    readback: pick.readback,
    context,
    rect: selection,
    granularity,
  });
}

describe("GPU pick regions", () => {
  it("normalizes reversed CSS rectangles and maps edges inclusively", () => {
    const canvas = fakeCanvas(780, 1688);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 390 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 844 });
    expect(
      renderPixelRect(
        rect({ left: 200, top: 400, right: 100, bottom: 200, width: 100, height: 200 }),
        canvas,
      ),
    ).toEqual({ left: 200, top: 400, right: 400, bottom: 800 });
  });

  it("returns one deterministic target for repeated visible pixels", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ pickValue: 1 });
      const context: PickContext = {
        instances: [instance()],
        parts: new Map([[1, createPart(1, triangleGeometry())]]),
      };
      await expect(
        targets(gpu, context, "part", rect({ right: 250, bottom: 250 })),
      ).resolves.toEqual([{ kind: "part", partId: 1 }]);
    } finally {
      restore();
    }
  });

  it("copies only the requested IDs and never reads depth", async () => {
    const restore = installGpuGlobals();
    try {
      const copied: unknown[] = [];
      const gpu = fakeGpuDevice({
        pickValue: 1,
        elementPickValue: 5,
        onCopyTextureToBuffer: (source) => copied.push(source.texture),
      });
      const context: PickContext = {
        instances: [instance()],
        parts: new Map([[1, createPart(1, triangleGeometry())]]),
      };
      const result = await targets(gpu, context, "element");
      expect(result).toEqual([{ kind: "element", instanceId: "root/0", elementId: 4 }]);
      expect(copied.length).toBeGreaterThan(0);
      expect(new Set(copied).size).toBe(2);
      expect(gpu.computeDispatchCount).toBe(0);
    } finally {
      restore();
    }
  });

  it("batches each repeated viewport-sized region into one GPU readback", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ pickValue: 1, elementPickValue: 5 });
      const context: PickContext = {
        instances: [instance()],
        parts: new Map([[1, createPart(1, triangleGeometry())]]),
      };
      const pick = createPickTargets(await createPickDepthReadback(gpu.device));
      const selection = rect({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
      });

      for (let index = 0; index < 3; index += 1) {
        await expect(targets(gpu, context, "element", selection, pick)).resolves.toEqual([
          { kind: "element", instanceId: "root/0", elementId: 4 },
        ]);
      }

      expect(gpu.submissionCount).toBe(3);
    } finally {
      restore();
    }
  });

  it("ignores empty, non-finite, and stale rectangles or IDs safely", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ pickValue: 99 });
      const context: PickContext = {
        instances: [instance()],
        parts: new Map([[1, createPart(1, triangleGeometry())]]),
      };
      await expect(
        targets(gpu, context, "element", rect({ left: 10, right: 10, width: 0 })),
      ).resolves.toEqual([]);
      await expect(targets(gpu, context, "element", rect({ left: Number.NaN }))).rejects.toThrow(
        "finite",
      );
      await expect(targets(gpu, context, "element")).resolves.toEqual([]);
    } finally {
      restore();
    }
  });
});
