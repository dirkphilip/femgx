import { describe, expect, it, vi } from "vitest";
import { createPart, type Geometry } from "../../../src/geometry/part";
import { identity } from "../../../src/math/mat4";
import {
  pickEdgeTargetsFromRegion,
  pickTargetsFromRegion,
  renderPixelRect,
} from "../../../src/renderer/picking/region";
import { createPickRegionTargetResolver } from "../../../src/renderer/picking/region-resolver";
import { createPickRegionTargetCollector } from "../../../src/renderer/picking/region-targets";
import {
  createPickTargets,
  ensureEdgePickTarget,
  ensurePickTargets,
  resetPickTargets,
  type PickTargets,
} from "../../../src/renderer/picking/pick";
import type { DrawResources } from "../../../src/renderer/resources/draw-resources";
import type { InteractionGranularity } from "../../../src/picking/types";
import type { PickContext, ResolvedPickIds } from "../../../src/picking/pick";
import type { Instance } from "../../../src/scene/types";
import type { BoxSelectionRect } from "../../../src/interaction/box-selection";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../fake-gpu";
import { createPickDepthReadback } from "../../../src/renderer/picking/depth";
import { getPartSemanticIndex } from "../../../src/geometry/part-semantic-index";

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
  return { instanceId: "root/0", partId, worldTransform: identity() };
}

function triangleGeometry(): Geometry {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles",
  };
}

function trianglePart(): ReturnType<typeof createPart> {
  return createPart(1, {
    geometries: [triangleGeometry()],
    elements: [
      {
        id: 4,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
    ],
  });
}

function richTrianglePart(): ReturnType<typeof createPart> {
  return createPart(1, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
        nodePickIds: new Uint32Array([1, 2, 3]),
        faces: [
          {
            elementId: 4,
            faceIndex: 2,
            primitiveStart: 0,
            primitiveCount: 1,
            bodyId: 7,
            key: "0:1:2",
            nodeIds: [0, 1, 2],
          },
        ],
      },
    ],
    elements: [
      {
        id: 4,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        bodyId: 7,
      },
    ],
    bodies: [{ id: 7, elementIds: [4] }],
    nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  });
}

function ids(overrides: Partial<ResolvedPickIds> = {}): ResolvedPickIds {
  return { instancePickId: 1, elementPickId: 0, facePickId: 0, nodePickId: 0, ...overrides };
}

async function targets(
  gpu: ReturnType<typeof fakeGpuDevice>,
  context: PickContext,
  granularity: InteractionGranularity,
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
  it.each([
    ["part", ids({ elementPickId: 5 }), { kind: "part", partId: 1 }],
    ["instance", ids({ instancePickId: 2 }), { kind: "instance", instanceId: "root/1" }],
    ["body", ids({ elementPickId: 5 }), { kind: "body", instanceId: "root/0", bodyId: 7 }],
    ["element", ids({ elementPickId: 5 }), { kind: "element", instanceId: "root/0", elementId: 4 }],
    [
      "face",
      ids({ facePickId: 1 }),
      { kind: "face", instanceId: "root/0", elementId: 4, faceIndex: 2 },
    ],
    ["node", ids({ nodePickId: 2 }), { kind: "node", instanceId: "root/0", nodeId: 1 }],
  ] as const)("resolves %s targets from minimal metadata", (granularity, pickIds, expected) => {
    const part = richTrianglePart();
    const context: PickContext = {
      instances: [instance(), { ...instance(), instanceId: "root/1" }],
      parts: new Map([[1, part]]),
    };
    expect(createPickRegionTargetResolver(context, granularity)(pickIds)).toEqual(expected);
  });

  it("keeps region target kinds strict and ignores invalid ownership ids", () => {
    const part = richTrianglePart();
    const unownedPart = createPart(2, { geometries: [triangleGeometry()] });
    const context: PickContext = {
      instances: [instance(), { ...instance(), instanceId: "root/1", partId: 2 }],
      parts: new Map([
        [1, part],
        [2, unownedPart],
      ]),
    };
    expect(
      createPickRegionTargetResolver(context, "element")(ids({ elementPickId: 0 })),
    ).toBeUndefined();
    expect(
      createPickRegionTargetResolver(context, "element")(ids({ elementPickId: 99 })),
    ).toBeUndefined();
    expect(
      createPickRegionTargetResolver(context, "body")(ids({ instancePickId: 2, elementPickId: 5 })),
    ).toBeUndefined();
    expect(createPickRegionTargetResolver(context, "face")(ids({ facePickId: 2 }))).toBeUndefined();
    expect(createPickRegionTargetResolver(context, "node")(ids({ nodePickId: 4 }))).toBeUndefined();
  });

  it("reuses one part index while preserving occurrence-scoped targets", () => {
    const context: PickContext = {
      instances: [instance(), { ...instance(), instanceId: "root/1" }],
      parts: new Map([[1, richTrianglePart()]]),
    };
    const resolve = createPickRegionTargetResolver(context, "element");
    expect(resolve(ids({ elementPickId: 5 }))).toEqual({
      kind: "element",
      instanceId: "root/0",
      elementId: 4,
    });
    expect(resolve(ids({ instancePickId: 2, elementPickId: 5 }))).toEqual({
      kind: "element",
      instanceId: "root/1",
      elementId: 4,
    });
  });

  it("resolves sparse authored element ids through prepared metadata", () => {
    const part = createPart(3, {
      geometries: [
        { positions: new Float32Array(6), indices: new Uint32Array([0, 1]), primitive: "points" },
      ],
      elements: [
        { id: 7, primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }] },
        {
          id: 100_000,
          primitiveRanges: [{ primitive: "points", primitiveStart: 1, primitiveCount: 1 }],
        },
      ],
    });
    getPartSemanticIndex(part);
    const originalGeometry = part.geometries[0];
    if (originalGeometry === undefined) throw new Error("Expected point geometry");
    Object.defineProperty(part, "geometries", {
      configurable: true,
      value: [
        new Proxy(originalGeometry, {
          get(target, property, _receiver) {
            if (property === "elements") throw new Error("region resolution scanned the part");
            return (target as unknown as Record<PropertyKey, unknown>)[property];
          },
        }),
      ],
    });
    const resolve = createPickRegionTargetResolver(
      { instances: [instance(3)], parts: new Map([[3, part]]) },
      "element",
    );

    expect(resolve(ids({ elementPickId: 100_001 }))).toEqual({
      kind: "element",
      instanceId: "root/0",
      elementId: 100_000,
    });
  });

  it("deduplicates semantic owners and keeps numeric ordering", () => {
    const collector = createPickRegionTargetCollector();
    collector.add({ kind: "body", instanceId: "root/1", bodyId: 8 }, 2);
    collector.add({ kind: "body", instanceId: "root/0", bodyId: 12 }, 1);
    collector.add({ kind: "body", instanceId: "root/0", bodyId: 12 }, 1);
    collector.add({ kind: "body", instanceId: "root/0", bodyId: 3 }, 1);

    expect(collector.finish()).toEqual([
      { kind: "body", instanceId: "root/0", bodyId: 3 },
      { kind: "body", instanceId: "root/0", bodyId: 12 },
      { kind: "body", instanceId: "root/1", bodyId: 8 },
    ]);
  });

  it("does not derive rich face adjacency for node-region targets", async () => {
    const restore = installGpuGlobals();
    try {
      const source = richTrianglePart();
      const sourceGeometry = source.geometries[0];
      if (sourceGeometry === undefined) throw new Error("rich triangle geometry is missing");
      const guardedPart = {
        ...source,
        geometries: [
          new Proxy(sourceGeometry, {
            get(target, property, _receiver) {
              if (property === "faces") throw new Error("node region must not read faces");
              return (target as unknown as Record<PropertyKey, unknown>)[property];
            },
          }),
        ],
      };
      const context: PickContext = {
        instances: [instance()],
        parts: new Map([[1, guardedPart]]),
      };
      expect(createPickRegionTargetResolver(context, "node")(ids({ nodePickId: 2 }))).toEqual({
        kind: "node",
        instanceId: "root/0",
        nodeId: 1,
      });
      const gpu = fakeGpuDevice({ pickValue: 1, elementPickValue: 2 });
      await expect(targets(gpu, context, "node")).resolves.toEqual([
        { kind: "node", instanceId: "root/0", nodeId: 1 },
      ]);
    } finally {
      restore();
    }
  });

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
        parts: new Map([[1, trianglePart()]]),
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
        parts: new Map([[1, trianglePart()]]),
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
        await expect(targets(gpu, context, "element", selection, pick)).resolves.toEqual([
          { kind: "element", instanceId: "root/0", elementId: 4 },
        ]);
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
