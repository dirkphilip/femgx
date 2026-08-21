import { describe, expect, it } from "vitest";
import {
  installNavigator,
  createTestScene,
  elementalScalar,
  elementalVector,
  nodalDisplacement,
  createPart,
  identityMatrix,
  scalingMatrix,
  createSceneBuilder,
  createViewport,
  type ViewportResultsConfig,
  resolveViewportResults,
  viewportOrientationRecords,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
} from "./support";
import { createElementFrameField, createNodalLoadField } from "@/results/fields";
import type { ViewportElementVectorConfig } from "@/viewport/results";

describe("viewport results workflow", () => {
  it("accepts every non-empty combination of independent result roles", () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const scalar = { field: elementalScalar() };
    const deformation = { field: nodalDisplacement() };
    const orientation = {
      field: elementalVector(),
      glyph: "arrow" as const,
      transform: "direction" as const,
    };
    const combinations = [
      { scalar },
      { deformation },
      { orientation },
      { scalar, deformation },
      { scalar, orientation },
      { deformation, orientation },
      { scalar, deformation, orientation },
    ];

    for (const config of combinations) {
      const result = resolveViewportResults(config, scene, runtime);
      expect(result.scalar !== undefined).toBe(config.scalar !== undefined);
      expect(result.deformation !== undefined).toBe(config.deformation !== undefined);
      expect(result.orientation !== undefined).toBe(config.orientation !== undefined);
    }
  });

  it("composes a part-owned nodal load with scalar and orientation records", () => {
    const scene = createTestScene();
    const runtime = { instanceCount: 1, getPartId: () => 1, getInstanceId: () => "1/0" } as never;
    const load = createNodalLoadField({
      partId: 1,
      id: "load",
      name: "Load",
      count: 3,
      forceUnit: "N",
      momentUnit: "N·m",
      values: new Float32Array([
        1,
        0,
        0,
        NaN,
        NaN,
        NaN,
        0,
        0,
        1,
        0,
        1,
        0,
        NaN,
        NaN,
        NaN,
        NaN,
        NaN,
        NaN,
      ]),
    });
    const result = resolveViewportResults(
      { scalar: { field: elementalScalar() }, loads: { field: load } },
      scene,
      runtime,
    );
    expect(result.loads?.field).toBe(load);
    expect(viewportOrientationRecords(result)?.get(1)?.elementIds.length).toBe(8);
  });

  it("installs load-only and load-plus-normal snapshots", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const scene = createTestScene();
    const load = createNodalLoadField({
      partId: 1,
      id: "load-only",
      name: "Load only",
      count: 3,
      forceUnit: "N",
      momentUnit: "N·m",
      values: new Float32Array([1, 0, 0, NaN, NaN, NaN, ...missingValues(12)]),
    });
    const vector = elementalVector();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: gpu.device,
      results: { loads: { field: load } },
    });
    expect(viewport.results.state?.loads?.field).toBe(load);
    viewport.results.set({
      loads: { field: load },
      orientation: { field: vector, glyph: "arrow", transform: "normal" },
    });
    expect(viewport.results.state?.loads?.field).toBe(load);
    expect(viewport.results.state?.orientation?.transform).toBe("normal");
    viewport.destroy();
  });

  it("keeps vector-only state independent and reuses records across presentation updates", () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const field = elementalVector();
    const first = resolveViewportResults(
      { orientation: { field, glyph: "arrow", transform: "direction" } },
      scene,
      runtime,
    );
    const second = resolveViewportResults(
      { orientation: { field, glyph: "axis", transform: "direction", lengthScale: 2 } },
      scene,
      runtime,
      first,
    );

    expect(first.scalar).toBeUndefined();
    expect(first.orientation?.field).toBe(field);
    expect(first.orientation?.widthPixels).toBe(2);
    expect(second.orientation?.lengthScale).toBe(2);
    expect(viewportOrientationRecords(second)?.get(1)?.directions).toBe(
      viewportOrientationRecords(first)?.get(1)?.directions,
    );
  });

  it("resolves complete authored element frames as three RGB triad records", () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const field = createElementFrameField({
      partId: 1,
      id: "frame",
      name: "Frame",
      count: 1,
      unit: "unitless",
      values: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    });
    const result = resolveViewportResults(
      { orientation: { field, glyph: "triad" } },
      scene,
      runtime,
    );
    expect(result.orientation?.glyph).toBe("triad");
    const records = viewportOrientationRecords(result)?.get(1);
    expect(records?.elementIds).toEqual(new Uint32Array([0, 0, 0]));
    expect(records?.axisIndices).toEqual(new Uint32Array([0, 1, 2]));
    expect(records?.directions).toEqual(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
  });

  it("accepts bounded fractional vector widths and rejects invalid replacements atomically", async () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const field = elementalVector();
    for (const widthPixels of [1, 1.5, 2, 8]) {
      const result = resolveViewportResults(
        { orientation: { field, glyph: "arrow", transform: "direction", widthPixels } },
        scene,
        runtime,
      );
      expect(result.orientation?.widthPixels).toBe(widthPixels);
    }
    for (const widthPixels of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 8.1]) {
      expect(() =>
        resolveViewportResults(
          { orientation: { field, glyph: "arrow", transform: "direction", widthPixels } },
          scene,
          runtime,
        ),
      ).toThrow("widthPixels");
    }

    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: gpu.device,
      results: { orientation: { field, glyph: "arrow", transform: "direction", widthPixels: 2 } },
    });
    const previous = viewport.results.state;
    expect(() => {
      viewport.results.set({
        orientation: { field, glyph: "axis", transform: "direction", widthPixels: 9 },
      });
    }).toThrow("widthPixels");
    expect(viewport.results.state).toBe(previous);
    viewport.destroy();
  });

  it("rejects empty roles and preserves the installed state after a failed replacement", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const scene = createTestScene(scalingMatrix(1, 0, 1));
    const vector = elementalVector();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: gpu.device,
      results: { orientation: { field: vector, glyph: "arrow", transform: "direction" } },
    });
    const previous = viewport.results.state;

    const emptyConfig = {} as ViewportResultsConfig;
    expect(() => {
      viewport.results.set(emptyConfig);
    }).toThrow("must include");
    expect(viewport.results.state).toBe(previous);
    expect(() => {
      viewport.results.set({
        orientation: {
          field: vector,
          glyph: "axis",
          transform: "normal",
        } as unknown as ViewportElementVectorConfig,
      });
    }).toThrow("normal transform");
    expect(viewport.results.state).toBe(previous);

    viewport.results.clear();
    expect(viewport.results.state).toBeUndefined();
    viewport.destroy();
  });

  it("validates deformation only for parts placed in the compiled runtime", () => {
    const scene = createSceneBuilder()
      .addPart(
        createPart(1, {
          geometries: [
            {
              positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
              indices: new Uint32Array([0, 1, 2]),
              primitive: "triangles" as const,
              nodePickIds: new Uint32Array([1, 2, 3]),
            },
          ],
          elements: [
            {
              id: 0,
              primitiveRanges: [
                { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
              ],
            },
          ],
        }),
      )
      .addPart(
        createPart(2, {
          geometries: [
            {
              positions: new Float32Array([5, 5, 5]),
              indices: new Uint32Array([0]),
              primitive: "points",
            },
          ],
        }),
      )
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          {
            kind: "part",
            placementId: "0",
            partId: 1,
            transform: identityMatrix(),
          },
        ],
      })
      .setRootAssembly(1)
      .build();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;

    expect(() =>
      resolveViewportResults(
        {
          scalar: { field: elementalScalar() },
          deformation: { field: nodalDisplacement() },
        },
        scene,
        runtime,
      ),
    ).not.toThrow();
  });
});

function missingValues(count: number): number[] {
  return Array.from({ length: count }, () => Number.NaN);
}
