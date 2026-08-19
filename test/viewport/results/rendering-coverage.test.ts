import { describe, expect, it, vi } from "vitest";
import {
  installNavigator,
  createTestScene,
  createHex20ViewportScene,
  readInteractionState,
  GpuRenderer,
  createResultField,
  createViewport,
  resolveViewportResults,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
} from "./support";

describe("viewport results workflow", () => {
  it("keeps preserved elemental result colors out of host interaction", async () => {
    installTestGpuGlobals();
    installNavigator();
    const setResultColors = vi.spyOn(GpuRenderer.prototype, "setResultColors");
    const fieldA = createResultField({
      id: "stress-a",
      name: "Stress A",
      location: "elemental",
      shape: "scalar",
      count: 1,
      unit: "MPa",
      values: new Float32Array([2]),
    });
    const fieldB = createResultField({
      id: "stress-b",
      name: "Stress B",
      location: "elemental",
      shape: "scalar",
      count: 1,
      unit: "MPa",
      values: new Float32Array([8]),
    });
    const config = (field: typeof fieldA) => ({
      scalar: { field, range: { min: 0, max: 10 } },
    });
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: createTestScene(),
      device: fakeGpuDevice().device,
      results: config(fieldA),
    });
    const hostInteraction = viewport.interaction.state;
    const resultColors = () => setResultColors.mock.calls.at(-1)?.[0];
    const colorA = resultColors()?.get(1)?.values.slice(4, 8);

    expect(viewport.updateScene(() => undefined)).toEqual({ results: "preserved" });
    expect(viewport.interaction.state).toBe(hostInteraction);
    expect(readInteractionState(viewport.interaction.state).elementOverrides.size).toBe(0);

    viewport.results.set(config(fieldB));
    expect(viewport.interaction.state).toBe(hostInteraction);
    const colorB = resultColors()?.get(1)?.values.slice(4, 8);
    expect(colorB).not.toEqual(colorA);

    viewport.results.clear();
    expect(viewport.interaction.state).toBe(hostInteraction);
    expect(resultColors()).toBeUndefined();
    viewport.destroy();
  });

  it("drives actual Hex20 tessellation through viewport deformation", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const { model, scene, part } = createHex20ViewportScene();
    const field = createResultField({
      id: "hex20-viewport-displacement",
      name: "Hex20 viewport displacement",
      location: "nodal",
      shape: "vector",
      count: model.nodes.length / 3,
      unit: "mm",
      values: new Float32Array(model.nodes.length).fill(0.1),
    });
    const stress = createResultField({
      id: "hex20-viewport-stress",
      name: "Hex20 viewport stress",
      location: "elemental",
      shape: "scalar",
      count: 2,
      unit: "MPa",
      values: new Float32Array([0, 1]),
    });
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: gpu.device,
      results: { scalar: { field: stress }, deformation: { field } },
    });

    expect(part.geometries[0]?.indices.length).toBe(6 * 6 * 3);
    expect(part.geometries[0]?.nodePickIds).not.toContain(0);
    expect(viewport.results.state?.deformation?.displacements.get(7)).toHaveLength(
      model.nodes.length,
    );
    expect(gpu.writes.some((write) => write.bytes.byteLength === model.nodes.length * 4)).toBe(
      true,
    );
    viewport.destroy();
  });

  it("reports an elemental field/geometry mismatch", () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const field = createResultField({
      id: "short",
      name: "Short",
      location: "elemental",
      shape: "scalar",
      count: 0,
      unit: "MPa",
      values: new Float32Array(),
    });

    expect(() =>
      resolveViewportResults({ scalar: { field, range: { min: 0, max: 1 } } }, scene, runtime),
    ).toThrow("has no value for element 0 in part 1");
  });
});
