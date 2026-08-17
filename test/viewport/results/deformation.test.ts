import { describe, expect, it } from "vitest";
import {
  installNavigator,
  createTestScene,
  elementalScalar,
  nodalDisplacement,
  nodalScalar,
  createInteractionState,
  setPartOverride,
  createResultField,
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
} from "./support";

describe("viewport results workflow", () => {
  it("drives the renderer and restores base interaction when cleared", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const base = createInteractionState();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: createTestScene(),
      device: gpu.device,
      interaction: base,
      results: {
        scalar: { field: elementalScalar() },
        deformation: { field: nodalDisplacement(), scale: 2 },
      },
    });

    expect(viewport.results?.scalar?.field.name).toBe("Authored stress");
    expect(viewport.interaction).toBe(base);
    expect(
      gpu.writes.some((write) => write.bytes.byteLength === nodalDisplacement().values.byteLength),
    ).toBe(true);

    viewport.clearResults();
    expect(viewport.results).toBeUndefined();
    expect(viewport.interaction).toBe(base);
    viewport.destroy();
  });

  it("keeps load-step resources bounded and makes scale-only updates uniform-only", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const scene = createTestScene();
    const scalarA = nodalScalar();
    const scalarB = createResultField({
      id: "temperature-b",
      name: "Temperature B",
      location: "nodal",
      shape: "scalar",
      count: 3,
      unit: "C",
      values: new Float32Array([10, 5, 0]),
    });
    const displacementA = nodalDisplacement();
    const displacementB = createResultField({
      id: "displacement-b",
      name: "Displacement B",
      location: "nodal",
      shape: "vector",
      count: 3,
      unit: "mm",
      values: new Float32Array([0.2, 0, 0, 0, 0.1, 0, 0, 0, 0.4]),
    });
    const elementalA = elementalScalar();
    const elementalB = createResultField({
      id: "stress-b",
      name: "Authored stress B",
      location: "elemental",
      shape: "scalar",
      count: 1,
      unit: "MPa",
      values: new Float32Array([6]),
    });
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: gpu.device,
      results: { scalar: { field: scalarA }, deformation: { field: displacementA } },
    });
    const runtime = viewport.runtime;
    const displacementBuffer = gpu.buffers.find(
      (buffer) => buffer.size === displacementA.values.byteLength && (buffer.usage & 16) !== 0,
    );
    const displacementWrites = (): number =>
      gpu.writes.filter((write) => write.buffer === displacementBuffer?.resource).length;
    const uniformBuffer = gpu.buffers.find(
      (buffer) => buffer.size === 16 && (buffer.usage & 1) !== 0,
    );
    const uniformWrites = (): number =>
      gpu.writes.filter((write) => write.buffer === uniformBuffer?.resource).length;
    const beforeScale = displacementWrites();
    const beforeUniform = uniformWrites();

    viewport.setResults({
      scalar: { field: scalarA },
      deformation: { field: displacementA, scale: 2 },
    });

    expect(displacementWrites()).toBe(beforeScale);
    expect(uniformWrites()).toBeGreaterThan(beforeUniform);
    viewport.setResults({ scalar: { field: elementalA }, deformation: { field: displacementA } });
    viewport.setResults({ scalar: { field: elementalB }, deformation: { field: displacementB } });
    const bufferCount = gpu.buffers.length;
    for (let step = 0; step < 100; step += 1) {
      const alternate = step % 2 === 1;
      viewport.setResults({
        scalar: { field: alternate ? scalarB : scalarA },
        deformation: {
          field: alternate ? displacementB : displacementA,
          scale: 1 + (step % 3) * 0.5,
        },
      });
    }

    expect(gpu.buffers.length).toBe(bufferCount);
    expect(displacementBuffer?.destroyed).toBe(false);
    expect(viewport.scene).toBe(scene);
    expect(viewport.runtime).toBe(runtime);
    viewport.destroy();
  });

  it("keeps the host interaction stable while result rendering is active", async () => {
    installTestGpuGlobals();
    installNavigator();
    const base = setPartOverride(createInteractionState(), 1, {
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: createTestScene(),
      device: fakeGpuDevice().device,
      interaction: base,
      results: { scalar: { field: elementalScalar() } },
    });

    expect(viewport.interaction).toBe(base);
    expect(viewport.results).not.toHaveProperty("interaction");
    const next = setPartOverride(base, 1, { emissive: 0.4 });
    viewport.setInteraction(next);
    expect(viewport.interaction).toBe(next);
    expect(viewport.results).not.toHaveProperty("interaction");

    viewport.clearResults();
    expect(viewport.interaction).toBe(next);
    viewport.destroy();
  });
});
