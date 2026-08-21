import { expect, it, vi, describe } from "vitest";
import {
  pickEdgeTargetsFromRegion,
  pickTargetsFromRegion,
  createPickTargets,
  ensureEdgePickTarget,
  ensurePickTargets,
  resetPickTargets,
  fakeCanvas,
  fakeGpuDevice,
  installGpuGlobals,
  createPickDepthReadback,
  rect,
  instance,
  trianglePart,
  targets,
  type DrawResources,
  type PickContext,
} from "./support";

describe("GPU pick regions", () => {
  it("batches each repeated viewport-sized region into one GPU readback", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ pickValue: 1, elementPickValue: 5 });
      const context: PickContext = {
        instances: [instance()],
        parts: new Map([[1, trianglePart()]]),
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
        await expect(targets(gpu, context, "element", selection, pick)).resolves.toMatchObject({
          kind: "element",
          count: 1,
          partOccurrenceIds: ["root/0"],
          elementIds: new Uint32Array([4]),
        });
      }

      expect(gpu.submissionCount).toBe(3);
    } finally {
      restore();
    }
  });

  it("rejects a region when resize changes textures between tiles", async () => {
    const restore = installGpuGlobals();
    try {
      const deferred: Array<() => void> = [];
      let mapCalls = 0;
      const staleCopies: GPUTexture[] = [];
      const oldInstanceTexture = { current: undefined as GPUTexture | undefined };
      const gpu = fakeGpuDevice({
        pickValue: 1,
        elementPickValue: 5,
        mapAsync: () => {
          mapCalls += 1;
          if (mapCalls === 1) {
            return new Promise<void>((resolve) => deferred.push(resolve));
          }
          return Promise.resolve();
        },
        onCopyTextureToBuffer: (source) => {
          if (
            source.texture === oldInstanceTexture.current &&
            pick.texture !== oldInstanceTexture.current
          ) {
            staleCopies.push(source.texture);
          }
        },
      });
      const pick = createPickTargets(await createPickDepthReadback(gpu.device));
      ensurePickTargets(gpu.device, pick, 4_000, 140, "depth24plus");
      oldInstanceTexture.current = pick.texture;
      const context: PickContext = {
        instances: [instance()],
        parts: new Map([[1, trianglePart()]]),
      };
      const pending = pickTargetsFromRegion({
        device: gpu.device,
        canvas: fakeCanvas(4_000, 140),
        pick,
        readback: pick.readback,
        context,
        rect: rect({ left: 0, top: 0, right: 4_000, bottom: 140 }),
        granularity: "element",
      });
      await vi.waitFor(() => {
        expect(gpu.submissionCount).toBe(1);
      });
      resetPickTargets(pick);
      ensurePickTargets(gpu.device, pick, 4_000, 140, "depth24plus");
      deferred[0]?.();
      await expect(pending).rejects.toThrow(
        "pick targets changed during region readback; retry the selection",
      );
      expect(staleCopies).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("rejects an authored-edge region when resize changes textures between tiles", async () => {
    const restore = installGpuGlobals();
    try {
      const deferred: Array<() => void> = [];
      let mapCalls = 0;
      const staleCopies: GPUTexture[] = [];
      const oldTextures = {
        instance: undefined as GPUTexture | undefined,
        edge: undefined as GPUTexture | undefined,
      };
      const gpu = fakeGpuDevice({
        pickValue: 1,
        mapAsync: () => {
          mapCalls += 1;
          if (mapCalls === 1) {
            return new Promise<void>((resolve) => deferred.push(resolve));
          }
          return Promise.resolve();
        },
        onCopyTextureToBuffer: (source) => {
          const oldTexture =
            source.texture === oldTextures.instance || source.texture === oldTextures.edge;
          const resized =
            pick.texture !== oldTextures.instance || pick.edgeTexture !== oldTextures.edge;
          if (oldTexture && resized) staleCopies.push(source.texture);
        },
      });
      const pick = createPickTargets(await createPickDepthReadback(gpu.device));
      ensurePickTargets(gpu.device, pick, 4_000, 140, "depth24plus");
      ensureEdgePickTarget(gpu.device, pick, 4_000, 140);
      oldTextures.instance = pick.texture;
      oldTextures.edge = pick.edgeTexture;
      const pending = pickEdgeTargetsFromRegion({
        device: gpu.device,
        canvas: fakeCanvas(4_000, 140),
        pick,
        readback: pick.readback,
        context: { instances: [instance()], parts: new Map([[1, trianglePart()]]) },
        draw: {} as DrawResources,
        rect: rect({ left: 0, top: 0, right: 4_000, bottom: 140 }),
      });
      await vi.waitFor(() => {
        expect(gpu.submissionCount).toBe(1);
      });
      resetPickTargets(pick);
      ensurePickTargets(gpu.device, pick, 4_000, 140, "depth24plus");
      ensureEdgePickTarget(gpu.device, pick, 4_000, 140);
      deferred[0]?.();
      await expect(pending).rejects.toThrow(
        "pick targets changed during region readback; retry the selection",
      );
      expect(staleCopies).toHaveLength(0);
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
        parts: new Map([[1, trianglePart()]]),
      };
      await expect(
        targets(gpu, context, "element", rect({ left: 10, right: 10, width: 0 })),
      ).resolves.toMatchObject({ kind: "element", count: 0, partOccurrenceIds: [] });
      await expect(targets(gpu, context, "element", rect({ left: Number.NaN }))).rejects.toThrow(
        "finite",
      );
      await expect(targets(gpu, context, "element")).resolves.toMatchObject({
        kind: "element",
        count: 0,
      });
    } finally {
      restore();
    }
  });
});
