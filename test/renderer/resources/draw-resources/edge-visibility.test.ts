import { describe, expect, it } from "vitest";
import {
  beginColorPass,
  createDrawResources,
  destroyDrawResources,
  drawBatches,
  drawContext,
  ensureEdgePickResources,
  ensureEdgeResources,
  fakeGpuDevice,
  installGpuGlobals,
  patchInstances,
  record,
  type DrawPipelines,
  uploadPart,
  writeEdgeOrder,
} from "./support";
import { createInteractionState } from "@/interaction/interaction";
import { setElementVisible } from "@/interaction/elements";
import { identityMatrix } from "@/math/mat4";
import {
  createElement,
  createElementModel,
  ElementShape,
  createPartFromElementModel,
} from "@/entries/model";
import { RendererAttachment } from "@/renderer/attachment";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";

describe("visibility-exposed authored edges", () => {
  it("retains interface edges in display and edge-pick resources", () => {
    const restore = installGpuGlobals();
    let draw: ReturnType<typeof createDrawResources> | undefined;
    try {
      const part = interiorEdgePart();
      const geometry = part.geometries.find((candidate) => candidate.primitive === "triangles");
      if (geometry?.primitive !== "triangles")
        throw new Error("Tet4 fixture lacks triangle geometry");
      const gpu = fakeGpuDevice();
      draw = createDrawResources(gpu.device);
      const resource = uploadPart(draw, part);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      writeEdgeOrder(draw, part.id, new Uint32Array([0]));

      const compactEdge = ensureEdgeResources(draw, part, geometry, resource);
      const compactEdgePick = ensureEdgePickResources(draw, part, geometry, resource);
      expect(compactEdge?.edgeKeys).not.toContain("1,2");
      expect(compactEdgePick?.edgeKeys).not.toContain("1,2");

      const edge = ensureEdgeResources(draw, part, geometry, resource, true);
      const edgePick = ensureEdgePickResources(draw, part, geometry, resource, true);
      expect(edge?.edgeKeys).toContain("1,2");
      expect(edgePick?.edgeKeys).toContain("1,2");
      expect(resource.edge).toBe(edge);
      expect(resource.edgePick).toBe(edgePick);
      expect(resource.edgeTopologyFull).toBe(true);
      expect(resource.edgePickTopologyFull).toBe(true);

      const pipeline = { name: "full-authored-edge" } as unknown as GPURenderPipeline;
      drawEdgeBatch(gpu, draw, part, pipeline, true);
      expect(gpu.drawCalls.at(-1)?.indexCount).toBe(edge?.edgeIndexCount);

      const restoredEdge = ensureEdgeResources(draw, part, geometry, resource);
      const restoredEdgePick = ensureEdgePickResources(draw, part, geometry, resource);
      expect(restoredEdge?.edgeKeys).not.toContain("1,2");
      expect(restoredEdgePick?.edgeKeys).not.toContain("1,2");
      expect(resource.edgeTopologyFull).toBe(false);
      expect(resource.edgePickTopologyFull).toBe(false);
      drawEdgeBatch(gpu, draw, part, pipeline, false);
      expect(gpu.drawCalls.at(-1)?.indexCount).toBe(restoredEdge?.edgeIndexCount);
    } finally {
      if (draw !== undefined) destroyDrawResources(draw);
      restore();
    }
  });

  it("keeps active display and pick resources aligned across distinct occurrence cuts", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const part = interiorEdgePart();
      const scene = createSceneBuilder()
        .addPart(part)
        .addAssembly({
          id: 1,
          name: "distinct-cuts",
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
      const runtime = createPackedSceneRuntime(scene);
      const attachment = new RendererAttachment();
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);
      attachment.setOverlayVisibility(true, false, bundle);
      uploadPart(bundle.draw, part);
      const styled = createInteractionState();
      attachment.updateInstances(runtime, styled, [0, 1], bundle);
      let interaction = setElementVisible(
        styled,
        { partOccurrenceId: "1/left", elementId: 7 },
        false,
      );
      interaction = setElementVisible(
        interaction,
        { partOccurrenceId: "1/right", elementId: 8 },
        false,
      );
      attachment.updateElements(runtime, interaction, bundle, scene.parts);
      expect(attachment.calls).toHaveLength(2);
      expect(attachment.edgeCalls).toEqual([
        { partId: part.id, instanceCount: 2, fullEdgeTopology: true },
      ]);

      const geometry = triangleGeometry(part);
      const resource = bundle.draw.primitiveParts.get(part.id)?.get("triangles");
      if (resource === undefined) throw new Error("edge resource owner is missing");
      const fullEdge = ensureEdgeResources(bundle.draw, part, geometry, resource, true);
      const fullPick = ensureEdgePickResources(bundle.draw, part, geometry, resource, true);
      if (fullEdge === undefined || fullPick === undefined)
        throw new Error("full edge resources missing");
      expect(fullEdge.edgeKeys).toContain("1,2");
      expect(fullPick.edgeKeys).toContain("1,2");
      const replacedBuffers = edgeBuffers(fullEdge, fullPick);

      interaction = setElementVisible(
        setElementVisible(interaction, { partOccurrenceId: "1/left", elementId: 7 }, true),
        { partOccurrenceId: "1/right", elementId: 8 },
        true,
      );
      attachment.updateElements(runtime, interaction, bundle, scene.parts);
      const compactEdge = ensureEdgeResources(bundle.draw, part, geometry, resource);
      const compactPick = ensureEdgePickResources(bundle.draw, part, geometry, resource);
      expect(attachment.edgeCalls).toEqual([{ partId: part.id, instanceCount: 2 }]);
      expect(compactEdge?.edgeKeys).not.toContain("1,2");
      expect(compactPick?.edgeKeys).not.toContain("1,2");
      expect(replacedBuffers.every((buffer) => isDestroyed(gpu, buffer))).toBe(true);
      attachment.clear(bundle);
    } finally {
      destroyGpuBundle(bundle);
      expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
      restore();
    }
  });
});

function interiorEdgePart() {
  return createPartFromElementModel(
    8,
    createElementModel(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1],
      [
        createElement(7, ElementShape.Tet4, [0, 1, 2, 3]),
        createElement(8, ElementShape.Tet4, [0, 2, 1, 4]),
      ],
    ),
    {
      faceSubset: [
        { elementId: 7, faceIndex: 0 },
        { elementId: 8, faceIndex: 0 },
      ],
    },
  );
}

function triangleGeometry(part: ReturnType<typeof interiorEdgePart>) {
  const geometry = part.geometries.find((candidate) => candidate.primitive === "triangles");
  if (geometry?.primitive !== "triangles") throw new Error("Tet4 fixture lacks triangle geometry");
  return geometry;
}

function edgeBuffers(
  edge: NonNullable<ReturnType<typeof ensureEdgeResources>>,
  pick: NonNullable<ReturnType<typeof ensureEdgePickResources>>,
): readonly GPUBuffer[] {
  return [
    edge.edgeVertexBuffer,
    edge.edgeIndexBuffer,
    edge.edgeNodePickIdsBuffer,
    edge.edgeTopologyBuffer,
    pick.vertexBuffer,
    pick.indexBuffer,
    pick.nodePickIdsBuffer,
    pick.topologyBuffer,
  ];
}

function isDestroyed(gpu: ReturnType<typeof fakeGpuDevice>, buffer: GPUBuffer): boolean {
  return gpu.buffers.find((record) => record.resource === buffer)?.destroyed === true;
}

function drawEdgeBatch(
  gpu: ReturnType<typeof fakeGpuDevice>,
  draw: ReturnType<typeof createDrawResources>,
  part: ReturnType<typeof createPartFromElementModel>,
  pipeline: GPURenderPipeline,
  fullEdgeTopology: boolean,
): void {
  const encoder = gpu.device.createCommandEncoder();
  const pass = beginColorPass(
    encoder,
    {} as GPUTextureView,
    {} as GPUTextureView,
    {} as GPUTextureView,
  );
  drawBatches(
    pass,
    draw,
    {
      ...drawContext(),
      parts: new Map([[part.id, part]]),
      pipelines: { edge: pipeline } as unknown as DrawPipelines,
    },
    [
      {
        partId: part.id,
        instanceCount: 1,
        ...(fullEdgeTopology ? { fullEdgeTopology: true } : {}),
      },
    ],
    { kind: "edge", pipeline },
  );
  pass.end();
}
