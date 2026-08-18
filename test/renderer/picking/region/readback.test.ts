import { expect, it, describe } from "vitest";
import {
  renderPixelRect,
  createPickRegionTargetResolver,
  fakeCanvas,
  fakeGpuDevice,
  installGpuGlobals,
  rect,
  instance,
  trianglePart,
  richTrianglePart,
  ids,
  targets,
  type PickContext,
} from "./support";

describe("GPU pick regions", () => {
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
        partOccurrenceId: "root/0",
        nodeId: 1,
      });
      const gpu = fakeGpuDevice({ pickValue: 1, elementPickValue: 2 });
      await expect(targets(gpu, context, "node")).resolves.toEqual([
        { kind: "node", partOccurrenceId: "root/0", nodeId: 1 },
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
      expect(result).toEqual([{ kind: "element", partOccurrenceId: "root/0", elementId: 4 }]);
      expect(copied.length).toBeGreaterThan(0);
      expect(new Set(copied).size).toBe(2);
      expect(gpu.computeDispatchCount).toBe(0);
    } finally {
      restore();
    }
  });
});
