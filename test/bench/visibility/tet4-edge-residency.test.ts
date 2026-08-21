import { describe, expect, it } from "vitest";
import { createPackedTet4Part } from "../../../demo/benchmark/packed-tet4";
import { buildDenseTet4Payload } from "../../../demo/benchmark/tet4-transfer";
import { partSemanticGraph } from "@/geometry/semantic/part-semantic-graph";
import { setElementVisible } from "@/interaction/elements";
import { setPartOverride } from "@/interaction/interaction";
import type { createInteractionState } from "@/interaction/interaction";
import { destroyGpuBundle } from "@/renderer/recovery";
import {
  beginColorPass,
  drawBatches,
  drawContext,
  ensureEdgePickResources,
  ensureEdgeResources,
  uploadPart,
  type DrawPipelines,
} from "../../renderer/resources/draw-resources/support";
import { installGpuGlobals } from "../../renderer/fake-gpu";
import { report } from "../budget/types";
import { measureMs } from "../measure";
import { type VisibilityFixture, visibilityFixture } from "./tet4-visibility-fixture";

describe("local Tet4 authored-edge residency benchmark", () => {
  it("measures active edge residency across 132k Tet4 visibility states", async () => {
    const restore = installGpuGlobals();
    const { payload } = buildDenseTet4Payload(28);
    const part = createPackedTet4Part(1, payload);
    const graph = partSemanticGraph(part);
    if (graph === undefined) throw new Error("Tet4 benchmark lost semantic graph");
    const fixture = await visibilityFixture(part, graph.elementIds);
    let coldOff: VisibilityFixture | undefined;
    try {
      coldOff = await visibilityFixture(part, graph.elementIds);
      const geometry = triangleGeometry(fixture.part);
      uploadPart(fixture.bundle.draw, fixture.part);
      const edgeOn = setPartOverride(fixture.shown, part.id, { edge: true });
      fixture.attachment.updateInstances(fixture.runtime, edgeOn, [0], fixture.bundle);
      const oneHidden = setElementVisible(
        edgeOn,
        { partOccurrenceId: fixture.occurrenceId, elementId: 1 },
        false,
      );
      let sparseHidden = edgeOn;
      for (const elementId of [1, 257, 513, 769]) {
        sparseHidden = setElementVisible(
          sparseHidden,
          { partOccurrenceId: fixture.occurrenceId, elementId },
          false,
        );
      }
      const halfHidden = setPartOverride(fixture.hidden, part.id, { edge: true });
      const cases = [
        ["no-hide-compact", edgeOn, false],
        ["one-hidden-full", oneHidden, true],
        ["sparse-hidden-full", sparseHidden, true],
        ["half-hidden-full", halfHidden, true],
      ] as const;
      assertColdOff(coldOff, geometry);
      for (const [name, interaction, fullTopology] of cases) {
        restoreCompactEdgeState(fixture, edgeOn, geometry);
        assertMeasuredCase(name, measureEdgeState(fixture, geometry, interaction, fullTopology));
      }
      const restored = measureEdgeState(fixture, geometry, edgeOn, false);
      expect(restored.elapsedMs, "restore-compact").toBeGreaterThan(0);
      expect(restored.residentBytes, "restore-compact resident bytes").toBeGreaterThan(0);
      expect(restored.uploadedBytes, "restore-compact upload bytes").toBeGreaterThan(0);
      expect(restored.drawCalls, "restore-compact submitted draws").toBe(1);
      expect(restored.submittedFrames, "restore-compact submitted frames").toBe(1);
      report(
        "tet4-edge-restore-compact-132k",
        `resident=${restored.residentBytes}B upload=${restored.uploadedBytes}B frames=${restored.submittedFrames}`,
        restored.elapsedMs,
      );
    } finally {
      if (coldOff !== undefined) destroyGpuBundle(coldOff.bundle);
      destroyGpuBundle(fixture.bundle);
      restore();
    }
  }, 120_000);
});

function triangleGeometry(part: ReturnType<typeof createPackedTet4Part>) {
  const geometry = part.geometries[0];
  if (geometry?.primitive !== "triangles") throw new Error("Tet4 benchmark geometry is missing");
  return geometry;
}

function restoreCompactEdgeState(
  fixture: VisibilityFixture,
  edgeOn: ReturnType<typeof createInteractionState>,
  geometry: ReturnType<typeof triangleGeometry>,
): void {
  fixture.attachment.updateElements(fixture.runtime, edgeOn, fixture.bundle, fixture.scene.parts);
  const resource = fixture.bundle.draw.primitiveParts.get(fixture.part.id)?.get("triangles");
  if (resource === undefined) throw new Error("Tet4 edge resource owner is missing");
  ensureEdgeResources(fixture.bundle.draw, fixture.part, geometry, resource);
  ensureEdgePickResources(fixture.bundle.draw, fixture.part, geometry, resource);
}

interface EdgeMeasurement {
  readonly elapsedMs: number;
  readonly residentBytes: number;
  readonly uploadedBytes: number;
  readonly drawCalls: number;
  readonly submittedFrames: number;
}

function measureEdgeState(
  fixture: VisibilityFixture,
  geometry: ReturnType<typeof triangleGeometry>,
  interaction: ReturnType<typeof createInteractionState>,
  fullTopology: boolean | undefined,
): EdgeMeasurement {
  const bufferCount = fixture.gpu.buffers.length;
  const drawCount = fixture.gpu.drawCalls.length;
  const submissionCount = fixture.gpu.submissionCount;
  const elapsedMs = measureMs(
    () => {
      fixture.attachment.updateElements(
        fixture.runtime,
        interaction,
        fixture.bundle,
        fixture.scene.parts,
      );
      if (fullTopology === undefined) return;
      const resource = fixture.bundle.draw.primitiveParts.get(fixture.part.id)?.get("triangles");
      if (resource === undefined) throw new Error("Tet4 edge resource owner is missing");
      const edge = ensureEdgeResources(
        fixture.bundle.draw,
        fixture.part,
        geometry,
        resource,
        fullTopology,
      );
      const pick = ensureEdgePickResources(
        fixture.bundle.draw,
        fixture.part,
        geometry,
        resource,
        fullTopology,
      );
      if (edge === undefined || pick === undefined) throw new Error("Tet4 edge resource is empty");
      submitEdgeFrame(fixture);
    },
    { warmup: 0, samples: 1 },
  );
  return {
    elapsedMs,
    residentBytes: activeEdgeBytes(fixture),
    uploadedBytes: fixture.gpu.buffers
      .slice(bufferCount)
      .reduce((bytes, buffer) => bytes + buffer.size, 0),
    drawCalls: fixture.gpu.drawCalls.length - drawCount,
    submittedFrames: fixture.gpu.submissionCount - submissionCount,
  };
}

function activeEdgeBytes(fixture: VisibilityFixture): number {
  const resource = fixture.bundle.draw.primitiveParts.get(fixture.part.id)?.get("triangles");
  const buffers = [
    resource?.edge?.edgeVertexBuffer,
    resource?.edge?.edgeIndexBuffer,
    resource?.edge?.edgeNodePickIdsBuffer,
    resource?.edge?.edgeTopologyBuffer,
    resource?.edgePick?.vertexBuffer,
    resource?.edgePick?.indexBuffer,
    resource?.edgePick?.nodePickIdsBuffer,
    resource?.edgePick?.topologyBuffer,
  ];
  return buffers.reduce(
    (bytes, buffer) =>
      bytes +
      (buffer === undefined
        ? 0
        : (fixture.gpu.buffers.find((item) => item.resource === buffer)?.size ?? 0)),
    0,
  );
}

function submitEdgeFrame(fixture: VisibilityFixture): void {
  const pipeline = { name: "tet4-edge-benchmark" } as unknown as GPURenderPipeline;
  const encoder = fixture.gpu.device.createCommandEncoder();
  const pass = beginColorPass(
    encoder,
    {} as GPUTextureView,
    {} as GPUTextureView,
    {} as GPUTextureView,
  );
  drawBatches(
    pass,
    fixture.bundle.draw,
    {
      ...drawContext(),
      parts: new Map([[fixture.part.id, fixture.part]]),
      pipelines: { edge: pipeline } as unknown as DrawPipelines,
    },
    fixture.attachment.edgeCalls,
    { kind: "edge", pipeline },
  );
  pass.end();
  fixture.gpu.device.queue.submit([encoder.finish()]);
}

function assertColdOff(
  fixture: VisibilityFixture,
  geometry: ReturnType<typeof triangleGeometry>,
): void {
  uploadPart(fixture.bundle.draw, fixture.part);
  const measured = measureEdgeState(fixture, geometry, fixture.shown, undefined);
  expect(measured.residentBytes, "off-no-upload resident bytes").toBe(0);
  expect(measured.uploadedBytes, "off-no-upload upload bytes").toBe(0);
  expect(measured.drawCalls, "off-no-upload submitted draws").toBe(0);
  expect(measured.submittedFrames, "off-no-upload submitted frames").toBe(0);
  report(
    "tet4-edge-off-no-upload-132k",
    "cold edge-disabled resident=0B upload=0B frames=0",
    measured.elapsedMs,
  );
}

function assertMeasuredCase(name: string, measured: EdgeMeasurement): void {
  expect(measured.elapsedMs, name).toBeGreaterThan(0);
  expect(measured.residentBytes, `${name} resident bytes`).toBeGreaterThan(0);
  expect(measured.drawCalls, `${name} submitted draws`).toBe(1);
  expect(measured.submittedFrames, `${name} submitted frames`).toBe(1);
  report(
    `tet4-edge-${name}-132k`,
    `resident=${measured.residentBytes}B upload=${measured.uploadedBytes}B frames=${measured.submittedFrames}`,
    measured.elapsedMs,
  );
}
