import { describe, expect, it } from "vitest";
import {
  installNavigator,
  createTestScene,
  elementalScalar,
  elementalVector,
  nodalDisplacement,
  createPart,
  identity,
  scale,
  createScene,
  createViewport,
  type ViewportResultsConfig,
  resolveViewportResults,
  viewportOrientationRecords,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
} from "./support";
import { createElementFrameField } from "../../../src/results/fields";

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
    const vectors = {
      field: elementalVector(),
      glyph: "arrow" as const,
      transform: "direction" as const,
    };
    const combinations = [
      { scalar },
      { deformation },
      { vectors },
      { scalar, deformation },
      { scalar, vectors },
      { deformation, vectors },
      { scalar, deformation, vectors },
    ];

    for (const config of combinations) {
      const result = resolveViewportResults(config, scene, runtime);
      expect(result.scalar !== undefined).toBe(config.scalar !== undefined);
      expect(result.deformation !== undefined).toBe(config.deformation !== undefined);
      expect(result.vectors !== undefined).toBe(config.vectors !== undefined);
    }
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
      { vectors: { field, glyph: "arrow", transform: "direction" } },
      scene,
      runtime,
    );
    const second = resolveViewportResults(
      { vectors: { field, glyph: "axis", transform: "direction", lengthScale: 2 } },
      scene,
      runtime,
      first,
    );

    expect(first.scalar).toBeUndefined();
    expect(first.vectors?.field).toBe(field);
    expect(first.vectors?.widthPixels).toBe(2);
    expect(second.vectors?.lengthScale).toBe(2);
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
    const result = resolveViewportResults({ vectors: { field, glyph: "triad" } }, scene, runtime);
    expect(result.vectors?.glyph).toBe("triad");
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
        { vectors: { field, glyph: "arrow", transform: "direction", widthPixels } },
        scene,
        runtime,
      );
      expect(result.vectors?.widthPixels).toBe(widthPixels);
    }
    for (const widthPixels of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 8.1]) {
      expect(() =>
        resolveViewportResults(
          { vectors: { field, glyph: "arrow", transform: "direction", widthPixels } },
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
      results: { vectors: { field, glyph: "arrow", transform: "direction", widthPixels: 2 } },
    });
    const previous = viewport.results.state;
    expect(() => {
      viewport.results.set({
        vectors: { field, glyph: "axis", transform: "direction", widthPixels: 9 },
      });
    }).toThrow("widthPixels");
    expect(viewport.results.state).toBe(previous);
    viewport.destroy();
  });

  it("rejects empty roles and preserves the installed state after a failed replacement", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const scene = createTestScene(scale(1, 0, 1));
    const vector = elementalVector();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: gpu.device,
      results: { vectors: { field: vector, glyph: "arrow", transform: "direction" } },
    });
    const previous = viewport.results.state;

    const emptyConfig = {} as ViewportResultsConfig;
    expect(() => {
      viewport.results.set(emptyConfig);
    }).toThrow("must include");
    expect(viewport.results.state).toBe(previous);
    expect(() => {
      viewport.results.set({ vectors: { field: vector, glyph: "axis", transform: "normal" } });
    }).toThrow("normal transform");
    expect(viewport.results.state).toBe(previous);

    viewport.results.clear();
    expect(viewport.results.state).toBeUndefined();
    viewport.destroy();
  });

  it("validates deformation only for parts placed in the compiled runtime", () => {
    const scene = createScene()
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
        placements: [{ kind: "part", partId: 1, transform: identity() }],
      })
      .withRoot(1)
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
