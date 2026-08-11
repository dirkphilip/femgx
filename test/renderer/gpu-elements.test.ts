import { describe, expect, it } from "vitest";
import { createPart, type Geometry, type Part } from "../../src/geometry/part";
import {
  createInteractionState,
  setElementOverride,
  setElementSelected,
  setHoveredElement,
} from "../../src/interaction/interaction";
import { setBodyOverride, setBodyVisible } from "../../src/interaction/bodies";
import { setFaceSelected } from "../../src/interaction/faces";
import { setNodeSelected } from "../../src/interaction/nodes";
import { translation } from "../../src/math/mat4";
import {
  createPackedSceneRuntime,
  type PackedSceneRuntime as SceneRuntime,
} from "../../src/scene-runtime/runtime";
import { createScene, type Scene } from "../../src/scene/scene";
import {
  collectEmphasisUpdates,
  createHighlightStorage,
  ELEMENT_RECORD_STRIDE,
  encodeBodyHighlight,
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
  buildBodyPrimitivePickIds,
  buildElementPrimitivePickIds,
  buildFacePrimitivePickIds,
  buildNodeBodyPickData,
  buildNodeBodyOwnerData,
  buildNodeSpritePickIds,
  buildPrimitiveFaceBodyPickData,
  buildVertexNodePickIds,
} from "../../src/renderer/gpu-pick-ids";
import { HIGHLIGHT_BUCKET_SIZE } from "../../src/renderer/gpu-highlight-table";
import {
  createDrawResources,
  encodeInstanceRecord,
  patchInstances,
} from "../../src/renderer/gpu-draw";
import { defaultStyle } from "../../src/renderer/gpu-support";
import type { InstanceStorage } from "../../src/renderer/gpu-draw";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";
import { createBoltedPlateFixture } from "../../demo/fixture/bolted-plate";

const style = {
  color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
  emissive: 0.5,
  opacity: 1,
  edge: false,
};

function elementUpdate(slot: number, elementId: number): EmphasisUpdate {
  return { slot, elementPickId: elementId + 1, facePickId: 0, nodePickId: 0, style };
}

function bodyUpdate(slot: number, bodyId: number): EmphasisUpdate {
  return {
    slot,
    elementPickId: 0,
    facePickId: 0,
    nodePickId: 0,
    bodyPickId: bodyId + 1,
    style,
  };
}

describe("buildElementPrimitivePickIds", () => {
  it("maps each triangle to its element pick id (element id + 1)", () => {
    const geometry: Geometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      elements: [
        { id: 0, primitiveStart: 0, primitiveCount: 2 },
        { id: 3, primitiveStart: 2, primitiveCount: 1 },
      ],
    };
    expect(Array.from(buildElementPrimitivePickIds(geometry))).toEqual([1, 1, 4]);
  });

  it("produces all-zero ids when the geometry has no elements", () => {
    expect(
      Array.from(
        buildElementPrimitivePickIds({
          positions: new Float32Array(9),
          indices: new Uint32Array(3),
          primitive: "triangles" as const,
        }),
      ),
    ).toEqual([0]);
  });

  it("maps authored line segments and point sprites to their element ids", () => {
    expect(
      Array.from(
        buildElementPrimitivePickIds({
          positions: new Float32Array(6),
          indices: new Uint32Array([0, 1]),
          primitive: "lines",
          elements: [{ id: 4, primitiveStart: 0, primitiveCount: 1 }],
        }),
      ),
    ).toEqual([5]);
    expect(
      Array.from(
        buildElementPrimitivePickIds({
          positions: new Float32Array(6),
          indices: new Uint32Array([0]),
          primitive: "points",
          elements: [{ id: 8, primitiveStart: 0, primitiveCount: 1 }],
        }),
      ),
    ).toEqual([9]);
  });
});

describe("buildBodyPrimitivePickIds", () => {
  it("maps triangles to their reusable body pick ids", () => {
    const geometry: Geometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      elements: [{ id: 4, primitiveStart: 0, primitiveCount: 2, bodyId: 7 }],
      bodies: [{ id: 7, elementIds: [4] }],
    };
    expect(Array.from(buildBodyPrimitivePickIds(geometry))).toEqual([8, 8]);
  });
});

describe("buildFacePrimitivePickIds", () => {
  it("copies the per-triangle face pick ids when present", () => {
    const geometry: Geometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      facePickIds: new Uint32Array([5, 0, 5]),
    };
    expect(Array.from(buildFacePrimitivePickIds(geometry))).toEqual([5, 0, 5]);
  });

  it("produces all-zero ids when the geometry has no faces", () => {
    const geometry: Geometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(3),
      primitive: "triangles" as const,
    };
    expect(Array.from(buildFacePrimitivePickIds(geometry))).toEqual([0]);
  });
});

describe("buildPrimitiveFaceBodyPickData", () => {
  it("packs face and body ids into the shared triangle buffer", () => {
    const geometry: Geometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      facePickIds: new Uint32Array([5, 0]),
      elements: [{ id: 4, primitiveStart: 0, primitiveCount: 2, bodyId: 7 }],
      bodies: [{ id: 7, elementIds: [4] }],
    };
    expect(Array.from(buildPrimitiveFaceBodyPickData(geometry))).toEqual([5, 8, 0, 8]);
  });
});

describe("buildNodeBodyPickData", () => {
  it("keeps an empty node binding large enough for one vec2 storage element", () => {
    expect(
      Array.from(
        buildNodeBodyPickData({
          positions: new Float32Array(),
          indices: new Uint32Array(),
          primitive: "triangles" as const,
        }),
      ),
    ).toEqual([0, 0]);
  });

  it("assigns a body to nodes that belong to exactly one body", () => {
    const geometry: Geometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3, 1, 2, 3]),
      nodePositions: new Float32Array(9),
      elements: [{ id: 4, primitiveStart: 0, primitiveCount: 2, bodyId: 7 }],
      bodies: [{ id: 7, elementIds: [4] }],
    };
    expect(Array.from(buildNodeBodyPickData(geometry))).toEqual([0, 8, 0, 8, 0, 8]);
  });

  it("maps filtered sprite ids to their original body slots", () => {
    const geometry: Geometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([2, 2, 4, 4, 0, 0]),
      nodePositions: new Float32Array(12),
      elements: [{ id: 4, primitiveStart: 0, primitiveCount: 2, bodyId: 7 }],
      bodies: [{ id: 7, elementIds: [4] }],
    };
    expect(Array.from(buildNodeBodyPickData(geometry, new Uint32Array([2, 4])))).toEqual([
      0, 8, 0, 8,
    ]);
  });

  it("keeps every owner for shared nodes so all-hidden topology can disappear", () => {
    const geometry: Geometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3, 1, 2, 3]),
      nodePositions: new Float32Array(9),
      elements: [
        { id: 4, primitiveStart: 0, primitiveCount: 1, bodyId: 7 },
        { id: 5, primitiveStart: 1, primitiveCount: 1, bodyId: 8 },
      ],
      bodies: [
        { id: 7, elementIds: [4] },
        { id: 8, elementIds: [5] },
      ],
    };
    expect(buildNodeBodyOwnerData(geometry, new Uint32Array([1, 2, 3]))).toEqual({
      bodyRanges: new Uint32Array([0, 2, 2, 2, 4, 2]),
      bodyIds: new Uint32Array([8, 9, 8, 9, 8, 9]),
    });
    expect(Array.from(buildNodeBodyPickData(geometry))).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("buildNodeSpritePickIds", () => {
  it("returns unique ascending original ids and skips interpolated vertices", () => {
    const geometry: Geometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([4, 2, 4, 0, 2, 0]),
      nodePositions: new Float32Array(12),
    };
    expect(Array.from(buildNodeSpritePickIds(geometry))).toEqual([2, 4]);
  });
});

describe("buildVertexNodePickIds", () => {
  it("returns the per-vertex node pick ids when present", () => {
    const geometry: Geometry = {
      positions: new Float32Array(12),
      indices: new Uint32Array(12),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3, 0]),
    };
    expect(Array.from(buildVertexNodePickIds(geometry))).toEqual([1, 2, 3, 0]);
  });

  it("produces all-zero ids when the geometry has no node data", () => {
    const geometry: Geometry = {
      positions: new Float32Array(12),
      indices: new Uint32Array(12),
      primitive: "triangles" as const,
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

  it("encodes a body key with a distinct marker and hidden flag", () => {
    const ids = new Uint32Array(encodeBodyHighlight(2, 3, style, true));
    expect(ids[0]).toBe(2);
    expect(ids[1]).toBe(4);
    expect(ids[2]).toBe(0xffffffff);
    expect(ids[9]).toBe(1);
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

  it("skips unchanged body records and writes only the changed body range", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      writeElementHighlights(gpu.device, storage, [bodyUpdate(1, 2)]);
      const afterFirst = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, [bodyUpdate(1, 2)]);
      expect(gpu.writes.length).toBe(afterFirst);
      writeElementHighlights(gpu.device, storage, [bodyUpdate(1, 7)]);
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
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) =>
        elementUpdate(index, index),
      );
      writeElementHighlights(gpu.device, storage, updates);
      const u32 = new Uint32Array(storage.highlight.data.buffer);
      expect(u32[0]).toBe(updates.length);
      const bucketCount = u32[1] ?? 0;
      expect(bucketCount).toBeGreaterThan(0);
      for (const update of updates) {
        let found = false;
        for (let index = 0; index < bucketCount * HIGHLIGHT_BUCKET_SIZE; index += 1) {
          const base = HIGHLIGHT_HEADER / 4 + index * (ELEMENT_RECORD_STRIDE / 4);
          if (u32[base] === update.slot && u32[base + 1] === update.elementPickId) {
            found = true;
            break;
          }
        }
        expect(found).toBe(true);
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
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) =>
        elementUpdate(index, index),
      );
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
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) =>
        elementUpdate(index, index),
      );
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
    primitive: "triangles" as const,
    elements: [{ id: 0, primitiveStart: 0, primitiveCount: 6, bodyId: 3 }],
    bodies: [{ id: 3, name: "body", elementIds: [0] }],
    nodePickIds: new Uint32Array([1, 2, 3, 1, 2, 3]),
    nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    facePickIds: new Uint32Array([1, 1, 2, 2, 3, 3]),
    faces: [
      {
        id: 0,
        elementId: 0,
        faceIndex: 0,
        key: "0,1,2",
        nodeIds: [0, 1, 2],
        neighborElementIds: [],
        bodyId: 3,
      },
      {
        id: 1,
        elementId: 0,
        faceIndex: 1,
        key: "0,1,3",
        nodeIds: [0, 1, 3],
        neighborElementIds: [],
        bodyId: 3,
      },
      {
        id: 2,
        elementId: 0,
        faceIndex: 2,
        key: "0,2,3",
        nodeIds: [0, 2, 3],
        neighborElementIds: [],
        bodyId: 3,
      },
    ],
  };
  const part: Part = createPart(1, geometry);
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
  return { scene, runtime: createPackedSceneRuntime(scene) };
}

function partsMap(scene: Scene): Map<number, Part> {
  return new Map(scene.parts);
}

describe("collectEmphasisUpdates", () => {
  it("maps authored fixture bodies to reusable part-local records", () => {
    const fixture = createBoltedPlateFixture();
    const runtime = createPackedSceneRuntime(fixture.scene);
    const layout = buildInstanceLayout(runtime);
    const instanceId = runtime.getInstanceId(0);
    if (instanceId === undefined) throw new Error("expected the first fixture instance");
    let interaction = createInteractionState();
    interaction = setBodyVisible(interaction, { instanceId, bodyId: 2 }, false);
    const updates = collectEmphasisUpdates(
      runtime,
      layout,
      new Map([[instanceId, 0]]),
      new Map(fixture.scene.parts),
      interaction,
    );
    expect(updates.get(fixture.partIds.plate.partId)).toMatchObject([
      { slot: 0, bodyPickId: 3, hidden: true },
    ]);
  });

  it("maps body style and visibility to one reusable body record", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([["1/0", 0]]);
    let interaction = createInteractionState();
    interaction = setBodyOverride(interaction, { instanceId: "1/0", bodyId: 3 }, { emissive: 0.8 });
    interaction = setBodyVisible(interaction, { instanceId: "1/0", bodyId: 3 }, false);
    const updates = collectEmphasisUpdates(
      runtime,
      layout,
      slotByInstanceId,
      partsMap(scene),
      interaction,
    );
    expect(updates.get(1)).toMatchObject([
      { slot: 0, bodyPickId: 4, hidden: true, style: { emissive: 0.8 } },
    ]);
  });

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
