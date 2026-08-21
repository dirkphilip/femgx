import { describe, expect, it } from "vitest";
import { createElement } from "@/elements/element";
import { createElementModel } from "@/elements/model";
import { ElementShape } from "@/elements/shapes";
import { createPartFromElementModel } from "@/geometry/element-model-part";
import { setTargetSelected } from "@/interaction/targets";
import { createResultField } from "@/results/fields";
import { createSceneBuilder } from "@/scene/scene";
import {
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  translationMatrix,
  type Part,
} from "./support";

describe("Viewport mixed hierarchy and part revisions", () => {
  it("publishes topology, definition, bounds, results, glyphs, and caps atomically", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: mixedScene(),
      results: mixedResults(),
      device: gpu.device,
    });
    viewport.presentation.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    viewport.interaction.set(
      setTargetSelected(viewport.interaction.state, { kind: "part", partId: 2 }, true),
    );
    viewport.render();
    const draw = rendererDraw(viewport);
    const caps = rendererCaps(viewport);
    const retained = retainedIdentities(draw, caps);
    const revised = tetraPart(1, 2);

    const outcome = viewport.updateScene((update) => {
      update.replacePart(revised);
      update.addPlacement(2, {
        kind: "part",
        placementId: "added-revised",
        partId: 1,
        transform: translationMatrix(4, 0, 0),
      });
    });

    expect(outcome).toEqual({ results: "preserved" });
    expect(viewport.scene.parts.get(1)).toBe(revised);
    expect(viewport.occurrences.getPartOccurrence("1/branch/added-revised")).toMatchObject({
      partId: 1,
    });
    expect(viewport.results.state).toBeDefined();
    expect(viewportBounds(viewport).maxZ).toBe(2);
    expectRetainedIdentities(draw, rendererCaps(viewport), retained);
    expect(capForSource(rendererCaps(viewport), 1)).not.toBe(capForSource(caps, 1));
    viewport.render();
    await viewport.recover();
    viewport.render();
    expect(viewport.occurrences.getPartOccurrence("1/branch/added-revised")).toBeDefined();
    viewport.destroy();
  });

  it("restores every live owner when mixed replacement allocation fails", async () => {
    installTestGpuGlobals();
    installNavigator();
    let fail = false;
    let stagedInstanceStorages = 0;
    const stagedLabels: string[] = [];
    const gpu = fakeGpuDevice({
      onCreateBuffer: (_creation, descriptor) => {
        if (fail) stagedLabels.push(String(descriptor.label));
        if (fail && descriptor.label === "femgx instance storage") {
          stagedInstanceStorages += 1;
          if (stagedInstanceStorages === 2) {
            throw new Error("injected mixed cap allocation failure");
          }
        }
      },
    });
    const scene = mixedScene();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      results: mixedResults(),
      device: gpu.device,
    });
    viewport.presentation.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    viewport.render();
    const draw = rendererDraw(viewport);
    const frame = rendererCaps(viewport);
    const retained = retainedIdentities(draw, frame);
    const retainedResultBuffers = resultBuffers(retained);
    const retainedDestroyCounts = bufferDestroyCounts(gpu, retainedResultBuffers);
    const results = viewport.results.state;
    const bounds = viewportBounds(viewport);
    const bufferStart = gpu.buffers.length;
    const liveDestroyCounts = gpu.buffers.map(({ destroyCount }) => destroyCount);
    const writeStart = gpu.writes.length;
    const liveBuffers = new Set(gpu.buffers.map(({ resource }) => resource));
    fail = true;

    expect(() =>
      viewport.updateScene((update) => {
        update.replacePart(tetraPart(1, 2));
        update.addPlacement(2, {
          kind: "part",
          placementId: "added-revised",
          partId: 1,
          transform: translationMatrix(4, 0, 0),
        });
      }),
    ).toThrow("injected mixed cap allocation failure");

    expect(viewport.scene).toBe(scene);
    expect(viewport.occurrences.getPartOccurrence("1/branch/added-revised")).toBeUndefined();
    expect(viewport.results.state).toBe(results);
    expect(viewportBounds(viewport)).toEqual(bounds);
    expect(rendererCaps(viewport)).toBe(frame);
    expectRetainedIdentities(draw, frame, retained);
    const leaked = gpu.buffers
      .slice(bufferStart)
      .map((buffer, index) => ({ label: stagedLabels[index], destroys: buffer.destroyCount }))
      .filter(({ destroys }) => destroys !== 1);
    expect(leaked).toEqual([]);
    expect(stagedLabels).toEqual(
      expect.arrayContaining([
        "femgx orientation glyph records",
        "femgx deformation storage",
        "femgx result color storage",
      ]),
    );
    expect(gpu.writes.slice(writeStart).some(({ buffer }) => liveBuffers.has(buffer))).toBe(false);
    expect(bufferDestroyCounts(gpu, retainedResultBuffers)).toEqual(retainedDestroyCounts);
    expect(gpu.buffers.slice(0, bufferStart).map(({ destroyCount }) => destroyCount)).toEqual(
      liveDestroyCounts,
    );
    fail = false;
    viewport.render();
    expectRetainedIdentities(draw, frame, retained);
    expect(bufferDestroyCounts(gpu, retainedResultBuffers)).toEqual(retainedDestroyCounts);
    expect(gpu.buffers.slice(0, bufferStart).map(({ destroyCount }) => destroyCount)).toEqual(
      liveDestroyCounts,
    );
    await viewport.recover();
    viewport.render();
    viewport.destroy();
  });
});

function mixedScene() {
  return createSceneBuilder()
    .addPart(tetraPart(1, 1))
    .addPart(tetraPart(2, 1))
    .addAssembly({ id: 2, placements: [] })
    .addAssembly({
      id: 1,
      placements: [
        { kind: "part", placementId: "revised", partId: 1, transform: translationMatrix(0, 0, 0) },
        { kind: "part", placementId: "retained", partId: 2, transform: translationMatrix(8, 0, 0) },
        {
          kind: "assembly",
          placementId: "branch",
          assemblyId: 2,
          transform: translationMatrix(0, 0, 0),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
}

function tetraPart(id: number, extent: number): Part {
  const nodes = [0, 0, 0, extent, 0, 0, 0, extent, 0, 0, 0, extent];
  return createPartFromElementModel(
    id,
    createElementModel(nodes, [createElement(0, ElementShape.Tet4, [0, 1, 2, 3])]),
  );
}

function mixedResults() {
  return {
    scalar: { field: field("scalar", "scalar", new Float32Array([1, 2, 3, 4])) },
    deformation: { field: field("deformation", "vector", new Float32Array(12)) },
    orientation: {
      field: createResultField({
        id: "orientation",
        name: "orientation",
        location: "elemental",
        shape: "vector",
        count: 1,
        unit: "source",
        values: new Float32Array([1, 0, 0]),
      }),
      glyph: "arrow" as const,
      transform: "direction" as const,
    },
  };
}

function field<const Shape extends "scalar" | "vector">(
  id: string,
  shape: Shape,
  values: Float32Array,
) {
  return createResultField({
    id,
    name: id,
    location: "nodal",
    shape,
    count: 4,
    unit: "source",
    values,
  });
}

function rendererDraw(viewport: Awaited<ReturnType<typeof createViewport>>) {
  return (
    viewport as unknown as {
      readonly renderer: { readonly lifecycle: { readonly bundle: { readonly draw: DrawView } } };
    }
  ).renderer.lifecycle.bundle.draw;
}

interface DrawView {
  readonly storages: ReadonlyMap<number, unknown>;
  readonly primitiveParts: ReadonlyMap<number, ReadonlyMap<string, unknown>>;
  readonly resultColors: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
  readonly deformations: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
  readonly orientationGlyphs: {
    readonly parts: ReadonlyMap<
      number,
      {
        readonly normalBuffer: GPUBuffer;
        readonly groups: ReadonlyMap<
          unknown,
          { readonly recordBuffer: GPUBuffer; readonly orderBuffer: GPUBuffer }
        >;
      }
    >;
  };
}

function rendererCaps(viewport: Awaited<ReturnType<typeof createViewport>>) {
  return (
    viewport as unknown as {
      readonly renderer: {
        readonly sectionCaps: {
          readonly currentFrame: {
            readonly parts: ReadonlyMap<number, Part>;
            readonly sourcePartIds: ReadonlyMap<number, number>;
          };
        };
      };
    }
  ).renderer.sectionCaps.currentFrame;
}

function capForSource(frame: ReturnType<typeof rendererCaps>, source: number): Part | undefined {
  for (const [capId, partId] of frame.sourcePartIds) {
    if (partId === source) return frame.parts.get(capId);
  }
  return undefined;
}

function retainedIdentities(draw: DrawView, caps: ReturnType<typeof rendererCaps>) {
  return {
    storage: draw.storages.get(2),
    geometry: draw.primitiveParts.get(2)?.get("triangles"),
    color: draw.resultColors.get(2),
    deformation: draw.deformations.get(2),
    glyph: draw.orientationGlyphs.parts.get(2),
    cap: capForSource(caps, 2),
  };
}

function resultBuffers(retained: ReturnType<typeof retainedIdentities>): readonly GPUBuffer[] {
  const glyph = retained.glyph;
  return [
    retained.color?.buffer,
    retained.deformation?.buffer,
    glyph?.normalBuffer,
    ...[...(glyph?.groups.values() ?? [])].flatMap(({ recordBuffer, orderBuffer }) => [
      recordBuffer,
      orderBuffer,
    ]),
  ].filter((buffer): buffer is GPUBuffer => buffer !== undefined);
}

function bufferDestroyCounts(
  gpu: ReturnType<typeof fakeGpuDevice>,
  buffers: readonly GPUBuffer[],
): readonly number[] {
  return buffers.map(
    (buffer) => gpu.buffers.find(({ resource }) => resource === buffer)?.destroyCount ?? -1,
  );
}

function expectRetainedIdentities(
  draw: DrawView,
  caps: ReturnType<typeof rendererCaps>,
  retained: ReturnType<typeof retainedIdentities>,
): void {
  expect(draw.storages.get(2)).toBe(retained.storage);
  expect(draw.primitiveParts.get(2)?.get("triangles")).toBe(retained.geometry);
  expect(draw.resultColors.get(2)).toBe(retained.color);
  expect(draw.deformations.get(2)).toBe(retained.deformation);
  expect(draw.orientationGlyphs.parts.get(2)).toBe(retained.glyph);
  expect(capForSource(caps, 2)).toBe(retained.cap);
}

function viewportBounds(viewport: Awaited<ReturnType<typeof createViewport>>) {
  return (
    viewport as unknown as {
      readonly sceneController: { readonly placedBounds: { readonly bounds: BoundsView } };
    }
  ).sceneController.placedBounds.bounds;
}

interface BoundsView {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}
