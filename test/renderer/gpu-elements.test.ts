import { describe, expect, it } from "vitest";
import { computeBounds, type Geometry, type Part } from "../../src/geometry/part";
import {
  createInteractionState,
  setElementOverride,
  setElementSelected,
  setHoveredElement,
} from "../../src/interaction/interaction";
import { translation } from "../../src/math/mat4";
import { createSceneRuntime, type SceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene, type Scene } from "../../src/scene/scene";
import {
  buildElementTrianglePickIds,
  collectElementHighlightUpdates,
  createHighlightStorage,
  ELEMENT_RECORD_STRIDE,
  encodeElementHighlight,
  HIGHLIGHT_HEADER,
  MAX_ELEMENT_HIGHLIGHTS,
  syncElementHighlights,
  writeElementHighlights,
  type ElementHighlightUpdate,
} from "../../src/renderer/gpu-elements";
import {
  createDrawResources,
  encodeInstanceRecord,
  patchInstances,
} from "../../src/renderer/gpu-draw";
import { defaultStyle } from "../../src/renderer/gpu-support";
import type { InstanceStorage } from "../../src/renderer/gpu-draw";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

const style = { color: { r: 0.23, g: 0.51, b: 0.96, a: 1 }, emissive: 0.5, opacity: 1 };

describe("buildElementTrianglePickIds", () => {
  it("maps each triangle to its element pick id (element id + 1)", () => {
    const geometry: Geometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      elements: [
        { id: 0, triangleStart: 0, triangleCount: 2 },
        { id: 3, triangleStart: 2, triangleCount: 1 },
      ],
    };
    expect(Array.from(buildElementTrianglePickIds(geometry))).toEqual([1, 1, 4]);
  });

  it("produces all-zero ids when the geometry has no elements", () => {
    expect(
      Array.from(
        buildElementTrianglePickIds({
          positions: new Float32Array(9),
          indices: new Uint32Array(3),
        }),
      ),
    ).toEqual([0]);
  });
});

describe("encodeElementHighlight", () => {
  it("encodes the record fields at the documented byte offsets", () => {
    const data = encodeElementHighlight(2, 3, style);
    const ids = new Uint32Array(data);
    const floats = new Float32Array(data);
    expect(data.byteLength).toBe(ELEMENT_RECORD_STRIDE);
    expect(ids[0]).toBe(2);
    expect(ids[1]).toBe(4);
    expect(floats[4]).toBeCloseTo(style.color.r);
    expect(floats[7]).toBeCloseTo(style.color.a * style.opacity);
    expect(floats[8]).toBeCloseTo(style.emissive);
  });
});

describe("createHighlightStorage", () => {
  it("allocates a fixed-capacity buffer matching the shader struct", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = createHighlightStorage(gpu.device);
      const expected = HIGHLIGHT_HEADER + MAX_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE;
      expect(storage.data.byteLength).toBe(expected);
      expect(gpu.buffers[0]?.size).toBe(expected);
    } finally {
      restore();
    }
  });
});

describe("writeElementHighlights", () => {
  it("writes only the changed subranges across selection deltas", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = {
        highlight: createHighlightStorage(gpu.device),
      } as unknown as InstanceStorage;
      const update = (elementId: number): ElementHighlightUpdate => ({ slot: 1, elementId, style });
      writeElementHighlights(gpu.device, storage, [update(0)]);
      const afterFirst = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, [update(0)]);
      expect(gpu.writes.length).toBe(afterFirst);
      writeElementHighlights(gpu.device, storage, [update(7)]);
      expect(
        gpu.writes.slice(afterFirst).map((write) => [write.offset, write.bytes.byteLength]),
      ).toEqual([[20, 4]]);
    } finally {
      restore();
    }
  });

  it("clears all highlight records when the emphasis list empties", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = {
        highlight: createHighlightStorage(gpu.device),
      } as unknown as InstanceStorage;
      writeElementHighlights(gpu.device, storage, [{ slot: 0, elementId: 0, style }]);
      const afterFirst = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, []);
      const tail = gpu.writes.slice(afterFirst);
      expect(tail).not.toHaveLength(0);
      const countBytes = new Uint32Array(tail[0]?.bytes.buffer ?? new ArrayBuffer(0))[0];
      expect(countBytes).toBe(0);
    } finally {
      restore();
    }
  });

  it("drops records beyond the fixed per-part capacity", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = {
        highlight: createHighlightStorage(gpu.device),
      } as unknown as InstanceStorage;
      const updates = Array.from({ length: MAX_ELEMENT_HIGHLIGHTS + 10 }, (_, index) => ({
        slot: index,
        elementId: 0,
        style,
      }));
      writeElementHighlights(gpu.device, storage, updates);
      const view = new Uint32Array(storage.highlight.data.buffer);
      expect(view[0]).toBe(MAX_ELEMENT_HIGHLIGHTS);
    } finally {
      restore();
    }
  });
});

function elementScene(): { readonly scene: Scene; readonly runtime: SceneRuntime } {
  const geometry: Geometry = {
    positions: new Float32Array(18),
    indices: new Uint32Array(18),
    elements: [{ id: 0, triangleStart: 0, triangleCount: 6 }],
  };
  const part: Part = { id: 1, geometry, bounds: computeBounds(geometry) };
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        { kind: "part", partId: 1, transform: translation(0, 0, 0) },
        { kind: "part", partId: 1, transform: translation(2, 0, 0) },
      ],
    })
    .withRoot(1)
    .build();
  return { scene, runtime: createSceneRuntime(scene) };
}

describe("collectElementHighlightUpdates", () => {
  it("maps emphasized element occurrences to per-part records", () => {
    const { runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([
      ["1/0", 0],
      ["1/1", 1],
    ]);
    let interaction = createInteractionState();
    interaction = setElementSelected(interaction, { instanceId: "1/1", elementId: 0 }, true);
    const updates = collectElementHighlightUpdates(runtime, layout, slotByInstanceId, interaction);
    expect(Array.from(updates.keys())).toEqual([1]);
    const list = updates.get(1) ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slot: 1, elementId: 0 });
  });

  it("combines hover, selection, and overrides in deterministic order", () => {
    const { runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([
      ["1/0", 0],
      ["1/1", 1],
    ]);
    let interaction = createInteractionState();
    interaction = setElementSelected(interaction, { instanceId: "1/0", elementId: 0 }, true);
    interaction = setElementOverride(
      interaction,
      { instanceId: "1/1", elementId: 0 },
      {
        emissive: 0.9,
      },
    );
    interaction = setHoveredElement(interaction, { instanceId: "1/0", elementId: 0 });
    const updates = collectElementHighlightUpdates(runtime, layout, slotByInstanceId, interaction);
    expect((updates.get(1) ?? []).map((update) => update.slot)).toEqual([0, 1]);
  });

  it("drops refs whose instance is unknown or hidden from the layout", () => {
    const { runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([["1/0", 0]]);
    let interaction = createInteractionState();
    interaction = setElementSelected(interaction, { instanceId: "1/0", elementId: 0 }, true);
    interaction = setElementSelected(interaction, { instanceId: "stale", elementId: 0 }, true);
    const updates = collectElementHighlightUpdates(runtime, layout, slotByInstanceId, interaction);
    expect((updates.get(1) ?? []).map((update) => update.slot)).toEqual([0]);
  });
});

describe("syncElementHighlights", () => {
  it("clears a part's highlight records when its emphasis empties", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, 1, [
        { slot: 0, data: encodeInstanceRecord(translation(0, 0, 0), defaultStyle, 1) },
      ]);
      const { runtime } = elementScene();
      const layout = buildInstanceLayout(runtime);
      const slotByInstanceId = new Map([
        ["1/0", 0],
        ["1/1", 1],
      ]);
      const sync = { device: gpu.device, draw, runtime, layout, slotByInstanceId };
      let interaction = createInteractionState();
      interaction = setElementSelected(interaction, { instanceId: "1/0", elementId: 0 }, true);
      syncElementHighlights(sync, interaction);
      const afterSelect = gpu.writes.length;
      syncElementHighlights(sync, interaction);
      expect(gpu.writes.length).toBe(afterSelect);
      syncElementHighlights(sync, createInteractionState());
      const tail = gpu.writes.slice(afterSelect);
      const count = new Uint32Array(tail[0]?.bytes.buffer ?? new ArrayBuffer(0))[0];
      expect(count, "clearing the last emphasis writes a zero record count").toBe(0);
    } finally {
      restore();
    }
  });
});
