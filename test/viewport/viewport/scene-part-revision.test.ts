import { describe, expect, it, vi } from "vitest";
import { viewportOrientationRecords, viewportResultColors } from "@/viewport/results";
import {
  createPart,
  createResultField,
  createViewport,
  explicitScene,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  RendererAttachment,
  translationMatrix,
  type Part,
} from "./support";

describe("Viewport incremental part revisions", () => {
  it("replaces one reusable definition without broad renderer reconciliation", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const original = trianglePart(1, 1);
    const retained = trianglePart(2, 2);
    const scene = explicitScene(
      [original, retained],
      [
        { kind: "part", placementId: "first", partId: 1, transform: translationMatrix(0, 0, 0) },
        { kind: "part", placementId: "second", partId: 1, transform: translationMatrix(3, 0, 0) },
        { kind: "part", placementId: "retained", partId: 2, transform: translationMatrix(6, 0, 0) },
      ],
    );
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: gpu.device,
    });
    viewport.render();
    const draw = rendererDraw(viewport);
    const retainedStorage = draw.storages.get(1);
    if (retainedStorage === undefined) throw new Error("revised storage is missing");
    const storageBuffers = [retainedStorage.buffer, retainedStorage.orderBuffer];
    const writesStart = gpu.writes.length;
    const occurrences = viewport.occurrences;
    const prepareParts = vi.spyOn(RendererAttachment.prototype, "prepareParts");

    const revised = trianglePart(1, 4);
    viewport.updateScene((update) => {
      update.replacePart(revised);
    });
    viewport.render();

    expect(prepareParts).not.toHaveBeenCalled();
    expect(draw.storages.get(1)).toBe(retainedStorage);
    expect(draw.storages.get(1)?.buffer).toBe(storageBuffers[0]);
    expect(draw.storages.get(1)?.orderBuffer).toBe(storageBuffers[1]);
    expect(
      gpu.writes.slice(writesStart).some((write) => storageBuffers.includes(write.buffer)),
    ).toBe(false);
    expect(viewport.occurrences).toBe(occurrences);
    expect(Array.from(viewport.occurrences.partOccurrences())).toMatchObject([
      { partOccurrenceId: "1/first", partId: 1 },
      { partOccurrenceId: "1/second", partId: 1 },
      { partOccurrenceId: "1/retained", partId: 2 },
    ]);
    viewport.destroy();
  });

  it("retains the live revision when renderer preparation rejects a replacement", async () => {
    installTestGpuGlobals();
    installNavigator();
    const original = trianglePart(1, 1);
    const scene = explicitScene(
      [original],
      [{ kind: "part", placementId: "first", partId: 1, transform: translationMatrix(0, 0, 0) }],
    );
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: fakeGpuDevice().device,
    });
    const broken = new Proxy(trianglePart(1, 2), {
      get(target, property, receiver) {
        if (property === "nodePositions") throw new Error("replacement preparation failed");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(() => {
      viewport.updateScene((update) => {
        update.replacePart(broken);
      });
    }).toThrow("replacement preparation failed");
    expect(viewport.scene.parts.get(1)).toBe(original);
    expect(viewport.occurrences.getPartId("1/first")).toBe(1);
    viewport.destroy();
  });

  it("keeps prior and unrelated GPU resources usable when staging allocation fails", async () => {
    installTestGpuGlobals();
    installNavigator();
    let failStaging = false;
    let stagingAllocations = 0;
    const gpu = fakeGpuDevice({
      onCreateBuffer: () => {
        if (!failStaging) return;
        stagingAllocations += 1;
        if (stagingAllocations === 9) throw new Error("staged replacement allocation failed");
      },
    });
    const original = resultTrianglePart(1, 1);
    const retained = resultTrianglePart(2, 2);
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: explicitScene(
        [original, retained],
        [
          { kind: "part", placementId: "first", partId: 1, transform: translationMatrix(0, 0, 0) },
          {
            kind: "part",
            placementId: "retained",
            partId: 2,
            transform: translationMatrix(3, 0, 0),
          },
        ],
      ),
      device: gpu.device,
      results: revisionResultRoles(),
    });
    viewport.render();
    const draw = rendererDraw(viewport);
    const originalStorage = draw.storages.get(1);
    const retainedStorage = draw.storages.get(2);
    const originalGeometry = draw.primitiveParts.get(1)?.get("triangles");
    const retainedGeometry = draw.primitiveParts.get(2)?.get("triangles");
    const originalColor = draw.resultColors.get(1)?.buffer;
    const originalDeformation = draw.deformations.get(1)?.buffer;
    const originalGlyph = draw.orientationGlyphs.parts.get(1)?.groups.get(1)?.recordBuffer;
    expect(originalColor).toBeDefined();
    expect(originalDeformation).toBeDefined();
    expect(originalGlyph).toBeDefined();
    failStaging = true;

    expect(() => {
      viewport.updateScene((update) => {
        update.replacePart(resultTrianglePart(1, 2));
      });
    }).toThrow("staged replacement allocation failed");
    expect(viewport.scene.parts.get(1)).toBe(original);
    expect(draw.storages.get(1)).toBe(originalStorage);
    expect(draw.storages.get(2)).toBe(retainedStorage);
    expect(draw.primitiveParts.get(1)?.get("triangles")).toBe(originalGeometry);
    expect(draw.primitiveParts.get(2)?.get("triangles")).toBe(retainedGeometry);
    expect(draw.resultColors.get(1)?.buffer).toBe(originalColor);
    expect(draw.deformations.get(1)?.buffer).toBe(originalDeformation);
    expect(draw.orientationGlyphs.parts.get(1)?.groups.get(1)?.recordBuffer).toBe(originalGlyph);
    for (const buffer of [originalColor, originalDeformation, originalGlyph]) {
      expect(gpu.buffers.find((entry) => entry.resource === buffer)?.destroyCount).toBe(0);
    }
    expect(() => {
      viewport.render();
    }).not.toThrow();
    viewport.destroy();
  });

  it("retains unrelated result tables and glyph records across a compatible revision", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const first = resultTrianglePart(1, 1);
    const retained = resultTrianglePart(2, 2);
    const scalar = createResultField({
      id: "revision-scalar",
      name: "revision scalar",
      location: "nodal",
      shape: "scalar",
      count: 3,
      unit: "source",
      values: new Float32Array([1, 2, 3]),
    });
    const deformation = createResultField({
      id: "revision-deformation",
      name: "revision deformation",
      location: "nodal",
      shape: "vector",
      count: 3,
      unit: "source",
      values: new Float32Array(9),
    });
    const orientation = createResultField({
      id: "revision-orientation",
      name: "revision orientation",
      location: "elemental",
      shape: "vector",
      count: 1,
      unit: "source",
      values: new Float32Array([1, 0, 0]),
    });
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: explicitScene(
        [first, retained],
        [
          { kind: "part", placementId: "first", partId: 1, transform: translationMatrix(0, 0, 0) },
          {
            kind: "part",
            placementId: "retained",
            partId: 2,
            transform: translationMatrix(3, 0, 0),
          },
        ],
      ),
      device: gpu.device,
      results: {
        scalar: { field: scalar },
        deformation: { field: deformation },
        orientation: { field: orientation, glyph: "arrow", transform: "direction" },
      },
    });
    viewport.render();
    const before = viewport.results.state;
    if (before === undefined) throw new Error("result state is missing");
    const beforeColors = viewportResultColors(before)?.get(2);
    const beforeDeformation = before.deformation?.displacements.get(2);
    const beforeRecords = viewportOrientationRecords(before)?.get(2);
    const draw = rendererDraw(viewport);
    const retainedColorBuffer = draw.resultColors.get(2)?.buffer;
    const retainedDeformationBuffer = draw.deformations.get(2)?.buffer;
    const retainedGlyphBuffer = draw.orientationGlyphs.parts.get(2)?.groups.get(2)?.recordBuffer;
    expect(retainedGlyphBuffer).toBeDefined();
    const writeStart = gpu.writes.length;

    const outcome = viewport.updateScene((update) => {
      update.replacePart(resultTrianglePart(1, 4));
    });
    const after = viewport.results.state;
    if (after === undefined) throw new Error("result state was unexpectedly cleared");

    expect(outcome).toEqual({ results: "preserved" });
    expect(viewportResultColors(after)?.get(2)).toBe(beforeColors);
    expect(after.deformation?.displacements.get(2)).toBe(beforeDeformation);
    expect(viewportOrientationRecords(after)?.get(2)).toBe(beforeRecords);
    expect(draw.resultColors.get(2)?.buffer).toBe(retainedColorBuffer);
    expect(draw.deformations.get(2)?.buffer).toBe(retainedDeformationBuffer);
    expect(draw.orientationGlyphs.parts.get(2)?.groups.get(2)?.recordBuffer).toBe(
      retainedGlyphBuffer,
    );
    expect(
      gpu.writes
        .slice(writeStart)
        .some(
          (write) =>
            write.buffer === retainedColorBuffer ||
            write.buffer === retainedDeformationBuffer ||
            write.buffer === retainedGlyphBuffer,
        ),
    ).toBe(false);
    viewport.destroy();
  });

  it("clears retained deformation when a revision loses nodal field coverage", async () => {
    installTestGpuGlobals();
    installNavigator();
    const field = createResultField({
      id: "short-deformation",
      name: "short deformation",
      location: "nodal",
      shape: "vector",
      count: 3,
      unit: "source",
      values: new Float32Array(9),
    });
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: explicitScene(
        [resultTrianglePart(1, 1)],
        [{ kind: "part", placementId: "first", partId: 1, transform: translationMatrix(0, 0, 0) }],
      ),
      device: fakeGpuDevice().device,
      results: { deformation: { field } },
    });

    const outcome = viewport.updateScene((update) => {
      update.replacePart(resultTrianglePart(1, 2, 4));
    });

    expect(outcome.results).toBe("cleared");
    if (outcome.results !== "cleared") throw new Error("Expected retained results to clear");
    expect(outcome.reason).toMatch(/no value/);
    expect(viewport.results.state).toBeUndefined();
    viewport.destroy();
  });
});

function trianglePart(id: number, extent: number): Part {
  return createPart(id, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0, extent, 0, 0, 0, extent, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
      },
    ],
  });
}

function resultTrianglePart(id: number, extent: number, nodeCount = 3): Part {
  const geometry = trianglePart(id, extent).geometries[0];
  if (geometry === undefined) throw new Error("result geometry is missing");
  const nodePickIds = new Uint32Array(nodeCount === 3 ? [1, 2, 3] : [1, 2, nodeCount]);
  const nodePositions = new Float32Array(nodeCount * 3);
  nodePositions.set(geometry.positions);
  return createPart(id, {
    nodePositions,
    elements: [
      {
        id: 0,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
    ],
    geometries: [
      {
        primitive: "triangles",
        positions: geometry.positions,
        indices: geometry.indices,
        nodePickIds,
        faces: [
          {
            elementId: 0,
            faceIndex: 0,
            primitiveStart: 0,
            primitiveCount: 1,
            key: "0/1/2",
            nodeIds: [0, 1, 2],
          },
        ],
      },
    ],
  });
}

function revisionResultRoles() {
  return {
    scalar: {
      field: createResultField({
        id: "staging-scalar",
        name: "staging scalar",
        location: "nodal",
        shape: "scalar",
        count: 3,
        unit: "source",
        values: new Float32Array([1, 2, 3]),
      }),
    },
    deformation: {
      field: createResultField({
        id: "staging-deformation",
        name: "staging deformation",
        location: "nodal",
        shape: "vector",
        count: 3,
        unit: "source",
        values: new Float32Array(9),
      }),
    },
    orientation: {
      field: createResultField({
        id: "staging-orientation",
        name: "staging orientation",
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

function rendererDraw(viewport: Awaited<ReturnType<typeof createViewport>>) {
  const owner = viewport as unknown as {
    readonly renderer: { readonly lifecycle: { readonly bundle: { readonly draw: unknown } } };
  };
  return owner.renderer.lifecycle.bundle.draw as {
    readonly storages: ReadonlyMap<
      number,
      { readonly buffer: GPUBuffer; readonly orderBuffer: GPUBuffer }
    >;
    readonly primitiveParts: ReadonlyMap<number, ReadonlyMap<"triangles", unknown>>;
    readonly resultColors: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
    readonly deformations: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
    readonly orientationGlyphs: {
      readonly parts: ReadonlyMap<
        number,
        { readonly groups: ReadonlyMap<number, { readonly recordBuffer: GPUBuffer }> }
      >;
    };
  };
}
