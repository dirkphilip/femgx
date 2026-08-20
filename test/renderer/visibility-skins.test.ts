import { describe, expect, it } from "vitest";
import { createInteractionState } from "../../src/interaction/interaction";
import { setElementVisible } from "../../src/interaction/elements";
import { setBodyVisible } from "../../src/interaction/bodies";
import { createGpuBundle, destroyGpuBundle } from "../../src/renderer/recovery";
import { RendererAttachment } from "../../src/renderer/attachment";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createPart } from "../../src/geometry/part";
import { createSceneBuilder } from "../../src/scene/scene";
import { identityMatrix } from "../../src/math/mat4";
import { fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";

function buildPart() {
  return createPart(1, {
    geometries: [
      {
        primitive: "triangles" as const,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]),
        indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
        faces: [
          {
            elementId: 101,
            faceIndex: 0,
            primitiveStart: 0,
            primitiveCount: 1,
            key: "101:0",
            nodeIds: [0, 1, 2],
          },
          {
            elementId: 102,
            faceIndex: 0,
            primitiveStart: 1,
            primitiveCount: 1,
            key: "102:0",
            nodeIds: [3, 4, 5],
          },
        ],
        faceSubset: { faceIds: [{ elementId: 101, faceIndex: 0 }] },
      },
    ],
    elements: [
      {
        id: 101,
        primitiveRanges: [
          { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
        ],
      },
      {
        id: 102,
        primitiveRanges: [
          { primitive: "triangles" as const, primitiveStart: 1, primitiveCount: 1 },
        ],
      },
    ],
  });
}

function buildScene() {
  const part = buildPart();
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        {
          kind: "part" as const,
          placementId: "left",
          partId: part.id,
          transform: identityMatrix(),
        },
        {
          kind: "part" as const,
          placementId: "right",
          partId: part.id,
          transform: identityMatrix(),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
  return { part, scene, runtime: createPackedSceneRuntime(scene) };
}

function buildBudgetScene() {
  const faceCount = 5_000;
  const part = createPart(1, {
    geometries: [
      {
        primitive: "triangles" as const,
        positions: new Float32Array(faceCount * 9),
        indices: Uint32Array.from({ length: faceCount * 3 }, (_, index) => index),
        faces: Array.from({ length: faceCount }, (_, index) => ({
          elementId: index + 101,
          faceIndex: 0,
          primitiveStart: index,
          primitiveCount: 1,
          key: `${index}:0`,
          nodeIds: [0, 1, 2],
        })),
        faceSubset: { faceIds: [{ elementId: 101, faceIndex: 0 }] },
      },
    ],
    elements: Array.from({ length: faceCount }, (_, index) => ({
      id: index + 101,
      primitiveRanges: [
        { primitive: "triangles" as const, primitiveStart: index, primitiveCount: 1 },
      ],
    })),
  });
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "budget",
      placements: [
        { kind: "part" as const, placementId: "a", partId: part.id, transform: identityMatrix() },
        { kind: "part" as const, placementId: "b", partId: part.id, transform: identityMatrix() },
        { kind: "part" as const, placementId: "c", partId: part.id, transform: identityMatrix() },
      ],
    })
    .setRootAssembly(1)
    .build();
  return { part, scene, runtime: createPackedSceneRuntime(scene) };
}

function buildOversizeScene() {
  const primitiveCount = Math.floor((16 * 1024 * 1024) / 12) + 1;
  const part = createPart(88, {
    geometries: [
      {
        primitive: "triangles" as const,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array((primitiveCount + 1) * 3),
        faces: [
          {
            elementId: 1,
            faceIndex: 0,
            primitiveStart: 0,
            primitiveCount,
            key: "1:0",
            nodeIds: [0, 1, 2],
            neighborElementId: 2,
          },
          {
            elementId: 2,
            faceIndex: 0,
            primitiveStart: primitiveCount,
            primitiveCount: 1,
            key: "2:0",
            nodeIds: [0, 1, 2],
          },
        ],
        faceSubset: { faceIds: [{ elementId: 2, faceIndex: 0 }] },
      },
    ],
    elements: [
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount }],
      },
      {
        id: 2,
        primitiveRanges: [
          { primitive: "triangles", primitiveStart: primitiveCount, primitiveCount: 1 },
        ],
      },
    ],
  });
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "oversize",
      placements: [
        { kind: "part", placementId: "only", partId: part.id, transform: identityMatrix() },
      ],
    })
    .setRootAssembly(1)
    .build();
  return { part, scene, runtime: createPackedSceneRuntime(scene) };
}

function buildMixedPrimitiveScene() {
  const part = createPart(89, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        faces: [
          {
            elementId: 1,
            faceIndex: 0,
            primitiveStart: 0,
            primitiveCount: 1,
            key: "1:0",
            nodeIds: [0, 1, 2],
            bodyId: 1,
          },
        ],
        faceSubset: { faceIds: [{ elementId: 1, faceIndex: 0 }] },
      },
      {
        primitive: "points",
        positions: new Float32Array([0, 0, 0]),
        indices: new Uint32Array([0]),
      },
    ],
    elements: [
      {
        id: 1,
        bodyId: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
      {
        id: 2,
        bodyId: 2,
        primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }],
      },
    ],
    bodies: [
      { id: 1, elementIds: [1] },
      { id: 2, elementIds: [2] },
    ],
  });
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "mixed",
      placements: [
        { kind: "part", placementId: "only", partId: part.id, transform: identityMatrix() },
      ],
    })
    .setRootAssembly(1)
    .build();
  return { part, scene, runtime: createPackedSceneRuntime(scene) };
}

describe("bounded visibility skins", () => {
  it("shares a compact order and preserves the exterior subset for unaffected occurrences", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
      const { part, scene, runtime } = buildScene();
      const attachment = new RendererAttachment();
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);

      let interaction = setElementVisible(
        createInteractionState(),
        { partOccurrenceId: "1/left", elementId: 101 },
        false,
      );
      attachment.updateElements(runtime, interaction, bundle, scene.parts);

      const firstSkin = attachment.calls.find((call) => call.visibilitySkin)?.visibilitySkin;
      expect(firstSkin?.indexCount).toBe(3);
      expect(attachment.calls[0]?.visibilitySkin).toBe(firstSkin);
      expect(attachment.calls[1]).toMatchObject({
        partId: part.id,
        instanceCount: 1,
        surfaceSubset: true,
      });

      interaction = setElementVisible(
        interaction,
        { partOccurrenceId: "1/right", elementId: 101 },
        false,
      );
      attachment.updateElements(runtime, interaction, bundle, scene.parts);
      expect(attachment.calls).toHaveLength(1);
      expect(attachment.calls[0]?.visibilitySkin).toBe(firstSkin);
      expect(attachment.calls[0]?.instanceCount).toBe(2);

      interaction = setElementVisible(
        setElementVisible(interaction, { partOccurrenceId: "1/left", elementId: 101 }, true),
        { partOccurrenceId: "1/right", elementId: 101 },
        true,
      );
      attachment.updateElements(runtime, interaction, bundle, scene.parts);
      expect(attachment.calls).toEqual([{ partId: part.id, instanceCount: 2 }]);
      expect(bundle.draw.visibilitySkins.get(part.id)?.residentBytes).toBe(0);
      interaction = setElementVisible(
        interaction,
        { partOccurrenceId: "1/left", elementId: 101 },
        false,
      );
      attachment.updateElements(runtime, interaction, bundle, scene.parts);
      expect(attachment.calls[0]?.visibilitySkin).not.toBe(firstSkin);
      attachment.clear(bundle);
      expect(bundle.draw.visibilitySkins.size).toBe(0);
      destroyGpuBundle(bundle);
    } finally {
      restore();
    }
  });

  it("retains every required active skin when their total exceeds the part budget", async () => {
    const restore = installGpuGlobals();
    try {
      const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
      const { part, scene, runtime } = buildBudgetScene();
      const attachment = new RendererAttachment();
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);

      let interaction = createInteractionState();
      for (const [partOccurrenceId, elementId] of [
        ["1/a", 101],
        ["1/b", 102],
        ["1/c", 103],
      ] as const) {
        interaction = setElementVisible(interaction, { partOccurrenceId, elementId }, false);
      }
      attachment.updateElements(runtime, interaction, bundle, scene.parts);

      const cache = bundle.draw.visibilitySkins.get(part.id);
      expect(cache).toBeDefined();
      expect(cache?.residentBytes).toBeGreaterThan(cache?.budgetBytes ?? Infinity);
      expect(attachment.calls.filter((call) => call.visibilitySkin !== undefined)).toHaveLength(3);
      destroyGpuBundle(bundle);
    } finally {
      restore();
    }
  });

  it("admits one required hidden skin larger than the normal 16 MiB cache budget", async () => {
    const restore = installGpuGlobals();
    try {
      const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
      const { scene, runtime } = buildOversizeScene();
      const attachment = new RendererAttachment();
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);
      const hidden = setElementVisible(
        createInteractionState(),
        { partOccurrenceId: "1/only", elementId: 2 },
        false,
      );
      attachment.updateElements(runtime, hidden, bundle, scene.parts);

      expect(attachment.calls[0]?.visibilitySkin?.byteLength).toBeGreaterThan(16 * 1024 * 1024);
      destroyGpuBundle(bundle);
    } finally {
      restore();
    }
  });

  it("does not build a triangle skin for a point-only hidden element", async () => {
    const restore = installGpuGlobals();
    try {
      const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
      const { part, scene, runtime } = buildMixedPrimitiveScene();
      const attachment = new RendererAttachment();
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);
      const hidden = setElementVisible(
        createInteractionState(),
        { partOccurrenceId: "1/only", elementId: 2 },
        false,
      );
      attachment.updateElements(runtime, hidden, bundle, scene.parts);

      expect(attachment.calls).toEqual([{ partId: part.id, instanceCount: 1 }]);
      expect(bundle.draw.visibilitySkins.get(part.id)?.residentBytes).toBe(0);
      const hiddenBody = setBodyVisible(
        createInteractionState(),
        { partOccurrenceId: "1/only", bodyId: 2 },
        false,
      );
      attachment.updateElements(runtime, hiddenBody, bundle, scene.parts);
      expect(attachment.calls).toEqual([{ partId: part.id, instanceCount: 1 }]);
      expect(bundle.draw.visibilitySkins.get(part.id)?.residentBytes).toBe(0);
      destroyGpuBundle(bundle);
    } finally {
      restore();
    }
  });
});
