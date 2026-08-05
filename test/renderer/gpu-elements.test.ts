import { describe, expect, it } from "vitest";
import { computeBounds, type Geometry, type Part } from "../../src/geometry/part";
import {
  createInteractionState,
  setElementOverride,
  setElementSelected,
  setHoveredElement,
} from "../../src/interaction/interaction";
import { setFaceSelected } from "../../src/interaction/faces";
import { setNodeSelected } from "../../src/interaction/nodes";
import { translation } from "../../src/math/mat4";
import { createSceneRuntime, type SceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene, type Scene } from "../../src/scene/scene";
import {
  collectEmphasisUpdates,
  createHighlightStorage,
  ELEMENT_RECORD_STRIDE,
  encodeElementHighlight,
  encodeEmphasisRecord,
  encodeFaceHighlight,
  encodeNodeHighlight,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
  syncElementHighlights,
  writeElementHighlights,
  type EmphasisUpdate,
} from "../../src/renderer/gpu-elements";
import {
  buildElementTrianglePickIds,
  buildFaceTrianglePickIds,
  buildVertexNodePickIds,
} from "../../src/renderer/gpu-pick-ids";
import {
  createDrawResources,
  encodeInstanceRecord,
  patchInstances,
} from "../../src/renderer/gpu-draw";
import { defaultStyle } from "../../src/renderer/gpu-support";
import type { InstanceStorage } from "../../src/renderer/gpu-draw";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

const style = {
  color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
  emissive: 0.5,
  opacity: 1,
  edge: false,
};

function elementUpdate(slot: number, elementId: number): EmphasisUpdate {
  return { slot, elementPickId: elementId + 1, facePickId: 0, nodePickId: 0, style };
}

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

describe("buildFaceTrianglePickIds", () => {
  it("copies the per-triangle face pick ids when present", () => {
    const geometry: Geometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      facePickIds: new Uint32Array([5, 0, 5]),
    };
    expect(Array.from(buildFaceTrianglePickIds(geometry))).toEqual([5, 0, 5]);
  });

  it("produces all-zero ids when the geometry has no faces", () => {
    const geometry: Geometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(3),
    };
    expect(Array.from(buildFaceTrianglePickIds(geometry))).toEqual([0]);
  });
});

describe("buildVertexNodePickIds", () => {
  it("returns the per-vertex node pick ids when present", () => {
    const geometry: Geometry = {
      positions: new Float32Array(12),
      indices: new Uint32Array(12),
      nodePickIds: new Uint32Array([1, 2, 3, 0]),
    };
    expect(Array.from(buildVertexNodePickIds(geometry))).toEqual([1, 2, 3, 0]);
  });

  it("produces all-zero ids when the geometry has no node data", () => {
    const geometry: Geometry = {
      positions: new Float32Array(12),
      indices: new Uint32Array(12),
    };
    expect(Array.from(buildVertexNodePickIds(geometry))).toEqual([0, 0, 0, 0]);
  });
});

describe("encodeEmphasisRecord", () => {
  it("encodes element, face, and node pick ids at the documented offsets", () => {
    const data = encodeEmphasisRecord({
      slot: 2,
      elementPickId: 0,
      facePickId: 6,
      nodePickId: 9,
      style,
    });
    const ids = new Uint32Array(data);
    const floats = new Float32Array(data);
    expect(data.byteLength).toBe(ELEMENT_RECORD_STRIDE);
    expect(ids[0]).toBe(2);
    expect(ids[1]).toBe(0);
    expect(ids[2]).toBe(6);
    expect(ids[3]).toBe(9);
    expect(floats[4]).toBeCloseTo(style.color.r);
    expect(floats[7]).toBeCloseTo(style.color.a * style.opacity);
    expect(floats[8]).toBeCloseTo(style.emissive);
  });

  it("encodes a 1-based element pick id", () => {
    const ids = new Uint32Array(encodeElementHighlight(2, 3, style));
    expect(ids[1]).toBe(4);
    expect(ids[2]).toBe(0);
    expect(ids[3]).toBe(0);
  });

  it("encodes a 1-based face pick id", () => {
    const ids = new Uint32Array(encodeFaceHighlight(2, 3, style));
    expect(ids[1]).toBe(0);
    expect(ids[2]).toBe(4);
    expect(ids[3]).toBe(0);
  });

  it("encodes a 1-based node pick id", () => {
    const ids = new Uint32Array(encodeNodeHighlight(2, 3, style));
    expect(ids[1]).toBe(0);
    expect(ids[2]).toBe(0);
    expect(ids[3]).toBe(4);
  });
});

describe("createHighlightStorage", () => {
  it("allocates a buffer matching the header plus the requested record capacity", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = createHighlightStorage(gpu.device, 4);
      const expected = HIGHLIGHT_HEADER + 4 * ELEMENT_RECORD_STRIDE;
      expect(storage.data.byteLength).toBe(expected);
      expect(gpu.buffers[0]?.size).toBe(expected);
    } finally {
      restore();
    }
  });

  it("defaults to the initial capacity so small selections never grow the buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = createHighlightStorage(gpu.device);
      const expected = HIGHLIGHT_HEADER + INITIAL_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE;
      expect(storage.data.byteLength).toBe(expected);
      expect(gpu.buffers[0]?.size).toBe(expected);
    } finally {
      restore();
    }
  });
});

describe("writeElementHighlights", () => {
  function makeStorage(gpu: ReturnType<typeof fakeGpuDevice>): InstanceStorage {
    return {
      highlight: createHighlightStorage(gpu.device),
      bindGroup: undefined,
    } as unknown as InstanceStorage;
  }

  it("writes only the changed subranges across selection deltas", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      writeElementHighlights(gpu.device, storage, [elementUpdate(1, 0)]);
      const afterFirst = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, [elementUpdate(1, 0)]);
      expect(gpu.writes.length).toBe(afterFirst);
      writeElementHighlights(gpu.device, storage, [elementUpdate(1, 7)]);
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
      const storage = makeStorage(gpu);
      writeElementHighlights(gpu.device, storage, [elementUpdate(0, 0)]);
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

  it("grows the buffer and keeps every record beyond the initial capacity", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) => ({
        slot: index,
        elementId: index,
        style,
      }));
      writeElementHighlights(gpu.device, storage, updates);
      const u32 = new Uint32Array(storage.highlight.data.buffer);
      expect(u32[0]).toBe(updates.length);
      for (let index = 0; index < updates.length; index += 1) {
        const base = HIGHLIGHT_HEADER / 4 + index * (ELEMENT_RECORD_STRIDE / 4);
        expect(u32[base]).toBe(index);
        expect(u32[base + 1]).toBe(index + 1);
      }
      expect(gpu.buffers[0]?.destroyed).toBe(true);
      expect(gpu.buffers[1]?.size).toBeGreaterThan(
        HIGHLIGHT_HEADER + INITIAL_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE,
      );
    } finally {
      restore();
    }
  });

  it("invalidates the cached bind group when the buffer grows", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      storage.bindGroup = {} as GPUBindGroup;
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) => ({
        slot: index,
        elementId: index,
        style,
      }));
      writeElementHighlights(gpu.device, storage, updates);
      expect(storage.bindGroup).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("keeps diffing only changed subranges after the buffer grows", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) => ({
        slot: index,
        elementId: index,
        style,
      }));
      writeElementHighlights(gpu.device, storage, updates);
      const afterGrowth = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, updates);
      expect(gpu.writes.length).toBe(afterGrowth);
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
    nodePickIds: new Uint32Array([1, 2, 3, 1, 2, 3]),
    nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    facePickIds: new Uint32Array([1, 1, 2, 2, 3, 3]),
    faces: [
      {
        id: 0,
        elementId: 0,
        faceIndex: 0,
        key: "0,1,2",
        nodeIds: [0, 1, 2],
        neighborElementIds: [],
      },
      {
        id: 1,
        elementId: 0,
        faceIndex: 1,
        key: "0,1,3",
        nodeIds: [0, 1, 3],
        neighborElementIds: [],
      },
      {
        id: 2,
        elementId: 0,
        faceIndex: 2,
        key: "0,2,3",
        nodeIds: [0, 2, 3],
        neighborElementIds: [],
      },
    ],
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

function partsMap(scene: Scene): Map<number, Part> {
  return new Map(scene.parts);
}

describe("collectEmphasisUpdates", () => {
  it("maps emphasized element occurrences to per-part records", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([
      ["1/0", 0],
      ["1/1", 1],
    ]);
    let interaction = createInteractionState();
    interaction = setElementSelected(interaction, { instanceId: "1/1", elementId: 0 }, true);
    const updates = collectEmphasisUpdates(
      runtime,
      layout,
      slotByInstanceId,
      partsMap(scene),
      interaction,
    );
    expect(Array.from(updates.keys())).toEqual([1]);
    const list = updates.get(1) ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slot: 1, elementPickId: 1 });
  });

  it("maps emphasized face and node occurrences to face and node records", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([
      ["1/0", 0],
      ["1/1", 1],
    ]);
    let interaction = createInteractionState();
    interaction = setFaceSelected(
      interaction,
      { instanceId: "1/0", elementId: 0, faceKey: "0,1,3" },
      true,
    );
    interaction = setNodeSelected(interaction, { instanceId: "1/1", nodeId: 2 }, true);
    const updates = collectEmphasisUpdates(
      runtime,
      layout,
      slotByInstanceId,
      partsMap(scene),
      interaction,
    );
    const list = updates.get(1) ?? [];
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ slot: 0, facePickId: 2 });
    expect(list[1]).toMatchObject({ slot: 1, nodePickId: 3 });
  });

  it("drops face refs whose face is absent from the part geometry", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([["1/0", 0]]);
    let interaction = createInteractionState();
    interaction = setFaceSelected(
      interaction,
      { instanceId: "1/0", elementId: 0, faceKey: "9,9,9" },
      true,
    );
    const updates = collectEmphasisUpdates(
      runtime,
      layout,
      slotByInstanceId,
      partsMap(scene),
      interaction,
    );
    expect(updates.get(1) ?? []).toEqual([]);
  });

  it("combines hover, selection, and overrides in deterministic order", () => {
    const { scene, runtime } = elementScene();
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
    const updates = collectEmphasisUpdates(
      runtime,
      layout,
      slotByInstanceId,
      partsMap(scene),
      interaction,
    );
    expect((updates.get(1) ?? []).map((update) => update.slot)).toEqual([0, 1]);
  });

  it("drops refs whose instance is unknown or hidden from the layout", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([["1/0", 0]]);
    let interaction = createInteractionState();
    interaction = setElementSelected(interaction, { instanceId: "1/0", elementId: 0 }, true);
    interaction = setElementSelected(interaction, { instanceId: "stale", elementId: 0 }, true);
    const updates = collectEmphasisUpdates(
      runtime,
      layout,
      slotByInstanceId,
      partsMap(scene),
      interaction,
    );
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
      const { scene, runtime } = elementScene();
      const layout = buildInstanceLayout(runtime);
      const slotByInstanceId = new Map([
        ["1/0", 0],
        ["1/1", 1],
      ]);
      const sync = {
        device: gpu.device,
        draw,
        runtime,
        layout,
        slotByInstanceId,
        parts: partsMap(scene),
      };
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
