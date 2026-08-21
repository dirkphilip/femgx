import { describe, expect, it } from "vitest";
import { createElement } from "@/elements/element";
import { createElementModel } from "@/elements/model";
import { ElementShape } from "@/elements/shapes";
import { createPartFromElementModel } from "@/geometry/element-model-part";
import {
  createPart,
  createViewport,
  explicitScene,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  translationMatrix,
  type Part,
} from "./support";

describe("Viewport part revision geometry allocation atomicity", () => {
  it.each([3, 5])(
    "releases source geometry locals when allocation %i fails",
    async (failureAllocation) => {
      installTestGpuGlobals();
      installNavigator();
      let fail = false;
      let allocation = 0;
      const gpu = fakeGpuDevice({
        onCreateBuffer: () => {
          if (fail && ++allocation === failureAllocation) {
            throw new Error(`failed source geometry allocation ${failureAllocation}`);
          }
        },
      });
      const original = coloredTriangle(1, 1);
      const viewport = await geometryViewport(gpu.device, original);
      const draw = rendererDraw(viewport);
      const oldResource = draw.primitiveParts.get(1)?.get("triangles");
      const bufferStart = gpu.buffers.length;
      fail = true;

      expect(() => {
        viewport.updateScene((update) => {
          update.replacePart(coloredTriangle(1, 2));
        });
      }).toThrow(`failed source geometry allocation ${failureAllocation}`);

      expect(viewport.scene.parts.get(1)).toBe(original);
      expect(draw.primitiveParts.get(1)?.get("triangles")).toBe(oldResource);
      expectOldResourceAlive(gpu, oldResource);
      expectStagedBuffersDestroyedOnce(gpu, bufferStart);
      expect(() => {
        viewport.render();
      }).not.toThrow();
      viewport.destroy();
    },
  );

  it("releases cap and source locals when an early cap geometry allocation fails", async () => {
    installTestGpuGlobals();
    installNavigator();
    let fail = false;
    let capStorageStarted = false;
    let capGeometryAllocation = 0;
    const gpu = fakeGpuDevice({
      onCreateBuffer: (_creation, descriptor) => {
        if (!fail) return;
        if (descriptor.label === "femgx instance storage") capStorageStarted = true;
        if (
          capStorageStarted &&
          descriptor.label === "femgx uploaded buffer" &&
          ++capGeometryAllocation === 2
        ) {
          throw new Error("failed staged cap geometry");
        }
      },
    });
    const original = tetraPart(1, 1);
    const viewport = await geometryViewport(gpu.device, original);
    viewport.presentation.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    viewport.render();
    const renderer = rendererInternals(viewport);
    const oldFrame = renderer.sectionCaps.currentFrame;
    const oldCapId = oldFrame === undefined ? undefined : [...oldFrame.parts.keys()][0];
    const oldCapResource =
      oldCapId === undefined
        ? undefined
        : renderer.lifecycle.bundle.draw.primitiveParts.get(oldCapId)?.get("triangles");
    expect(oldCapResource).toBeDefined();
    const bufferStart = gpu.buffers.length;
    fail = true;

    expect(() => {
      viewport.updateScene((update) => {
        update.replacePart(tetraPart(1, 2));
      });
    }).toThrow("failed staged cap geometry");

    expect(viewport.scene.parts.get(1)).toBe(original);
    expect(renderer.sectionCaps.currentFrame).toBe(oldFrame);
    expectOldResourceAlive(gpu, oldCapResource);
    expectStagedBuffersDestroyedOnce(gpu, bufferStart);
    expect(() => {
      viewport.render();
    }).not.toThrow();
    viewport.destroy();
  });
});

async function geometryViewport(device: GPUDevice, part: Part) {
  const viewport = await createViewport({
    canvas: fakeCanvas(),
    scene: explicitScene(
      [part],
      [{ kind: "part", placementId: "part", partId: 1, transform: translationMatrix(0, 0, 0) }],
    ),
    device,
  });
  viewport.render();
  return viewport;
}

function coloredTriangle(id: number, extent: number): Part {
  return createPart(id, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, extent, 0, 0, 0, extent, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitiveColors: new Float32Array([1, 0, 0, 1]),
      },
    ],
  });
}

function tetraPart(id: number, extent: number): Part {
  return createPartFromElementModel(
    id,
    createElementModel(
      [0, 0, 0, extent, 0, 0, 0, extent, 0, 0, 0, extent],
      [createElement(0, ElementShape.Tet4, [0, 1, 2, 3])],
    ),
  );
}

function rendererDraw(viewport: Awaited<ReturnType<typeof geometryViewport>>) {
  return rendererInternals(viewport).lifecycle.bundle.draw;
}

function rendererInternals(viewport: Awaited<ReturnType<typeof geometryViewport>>) {
  return (
    viewport as unknown as {
      readonly renderer: {
        readonly sectionCaps: {
          readonly currentFrame?: { readonly parts: ReadonlyMap<number, Part> };
        };
        readonly lifecycle: {
          readonly bundle: {
            readonly draw: {
              readonly primitiveParts: ReadonlyMap<
                number,
                ReadonlyMap<string, { readonly vertexBuffer: GPUBuffer }>
              >;
            };
          };
        };
      };
    }
  ).renderer;
}

function expectOldResourceAlive(
  gpu: ReturnType<typeof fakeGpuDevice>,
  resource: { readonly vertexBuffer: GPUBuffer } | undefined,
): void {
  expect(resource).toBeDefined();
  expect(
    gpu.buffers.find((buffer) => buffer.resource === resource?.vertexBuffer)?.destroyCount,
  ).toBe(0);
}

function expectStagedBuffersDestroyedOnce(
  gpu: ReturnType<typeof fakeGpuDevice>,
  start: number,
): void {
  expect(gpu.buffers.slice(start).length).toBeGreaterThan(0);
  expect(gpu.buffers.slice(start).map((buffer) => buffer.destroyCount)).toEqual(
    gpu.buffers.slice(start).map(() => 1),
  );
}
