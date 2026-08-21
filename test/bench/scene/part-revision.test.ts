import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "@/elements/element";
import { createElementModel } from "@/elements/model";
import { ElementShape } from "@/elements/shapes";
import { createPartFromElementModel } from "@/geometry/element-model-part";
import { createResultField } from "@/results/fields";
import { setTargetSelected } from "@/interaction/targets";
import { createSceneBuilder } from "@/scene/scene";
import { createViewport, type Part, type Viewport } from "@/entries/root";
import {
  capPartForSource,
  capVertexBuffer,
  rendererCapCount,
  rendererCaps,
  rendererDraw,
  rendererRevisionCost,
  viewportBoundsLeaves,
} from "./part-revision-support";
import {
  fakeCanvas,
  fakeGpuDevice,
  installGpuGlobals,
  type FakeGpu,
} from "../../renderer/fake-gpu";
import { percentile } from "../measure";

const REVISED_OCCURRENCE_COUNTS = [1, 1_000, 100_000] as const;
const UNRELATED_DEFINITION_COUNT = 10_000;
const LIVE_UNRELATED_OCCURRENCES = 100_000;
const originalNavigator = globalThis.navigator;
let restoreGpuGlobals: (() => void) | undefined;

interface RevisionRow {
  readonly revisedOccurrences: number;
  readonly unrelatedDefinitions: number;
  readonly liveUnrelatedOccurrences: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly retainedResultWrites: number;
  readonly retainedStorageWrites: number;
  readonly revisedStorageWrites: number;
  readonly revisedBindGroupCreations: number;
  readonly maximumRevisionBuffers: number;
  readonly revisionInstanceScans: number;
  readonly revisionPartScans: number;
  readonly revisionWrites: number;
  readonly definitionValidations: number;
  readonly resourceRetirements: number;
  readonly boundsLeaves: number;
}

interface RevisionFixture {
  readonly viewport: Viewport;
  readonly gpu: FakeGpu;
  readonly revisedOccurrences: number;
  readonly revisions: readonly Part[];
  readonly retainedColorBuffer: GPUBuffer | undefined;
  readonly retainedDeformationBuffer: GPUBuffer | undefined;
  readonly revisedStorage:
    { readonly buffer: GPUBuffer; readonly orderBuffer: GPUBuffer } | undefined;
  readonly retainedStorage:
    | { readonly buffer: GPUBuffer; readonly orderBuffer: GPUBuffer; readonly bindGroup: unknown }
    | undefined;
  readonly retainedGeometry: unknown;
  readonly retainedGlyph: unknown;
  readonly retainedCap: unknown;
  revisedCap: Part | undefined;
  revisedCapVertexBuffer: GPUBuffer | undefined;
  revisionIndex: number;
}

beforeAll(() => {
  restoreGpuGlobals = installGpuGlobals();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
});

afterAll(() => {
  restoreGpuGlobals?.();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

describe("incremental part revision", () => {
  it("measures the complete viewport revision path without touching live unrelated resources", async () => {
    const rows: RevisionRow[] = [];
    for (const revisedOccurrences of REVISED_OCCURRENCE_COUNTS) {
      const fixture = await createFixture(revisedOccurrences);
      try {
        rows.push(measureRevision(fixture));
        await verifyViewportContracts(fixture);
      } finally {
        fixture.viewport.destroy();
      }
    }
    expect(rows).toHaveLength(REVISED_OCCURRENCE_COUNTS.length);
    console.log(JSON.stringify({ schemaVersion: 2, rows }, undefined, 2));
  }, 300_000);
});

async function createFixture(revisedOccurrences: number): Promise<RevisionFixture> {
  const gpu = fakeGpuDevice();
  const viewport = await createViewport({
    canvas: fakeCanvas(),
    scene: revisionScene(revisedOccurrences),
    device: gpu.device,
    results: revisionResults(),
  });
  viewport.presentation.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
  viewport.interaction.set(
    setTargetSelected(
      viewport.interaction.state,
      { kind: "element", partOccurrenceId: "1/revised-0", elementId: 0 },
      true,
    ),
  );
  viewport.render();
  const draw = rendererDraw(viewport);
  return {
    viewport,
    gpu,
    revisedOccurrences,
    revisions: [tetraPart(1, 2), tetraPart(1, 3)],
    retainedColorBuffer: draw.resultColors.get(2)?.buffer,
    retainedDeformationBuffer: draw.deformations.get(2)?.buffer,
    revisedStorage: draw.storages.get(1),
    retainedStorage: draw.storages.get(2),
    retainedGeometry: draw.primitiveParts.get(2)?.get("triangles"),
    retainedGlyph: draw.orientationGlyphs.parts.get(2),
    retainedCap: capPartForSource(rendererCaps(viewport), 2),
    revisedCap: capPartForSource(rendererCaps(viewport), 1),
    revisedCapVertexBuffer: capVertexBuffer(viewport, rendererCaps(viewport), 1),
    revisionIndex: 0,
  };
}

function measureRevision(fixture: RevisionFixture): RevisionRow {
  revise(fixture);
  const samples: number[] = [];
  let retainedResultWrites = 0;
  let retainedStorageWrites = 0;
  let revisedStorageWrites = 0;
  let revisedBindGroupCreations = 0;
  let maximumRevisionBuffers = 0;
  let revisionInstanceScans = 0;
  let revisionPartScans = 0;
  let revisionWrites = 0;
  let definitionValidations = 0;
  let resourceRetirements = 0;
  let boundsLeaves = 0;
  for (let sample = 0; sample < 7; sample += 1) {
    const writeStart = fixture.gpu.writes.length;
    const buffersBefore = fixture.gpu.buffers.length;
    const bindGroupsBefore = fixture.gpu.bindGroupCreations;
    const started = performance.now();
    const previousCap = fixture.revisedCap;
    const previousCapBuffer = fixture.revisedCapVertexBuffer;
    revise(fixture);
    const cost = rendererRevisionCost(fixture.viewport);
    revisionInstanceScans += cost.cpu["instance-scan"];
    revisionPartScans += cost.cpu["part-scan"];
    revisionWrites += Object.values(cost.writes).reduce((total, write) => total + write.calls, 0);
    definitionValidations += cost.cpu["definition-validation"];
    resourceRetirements += cost.memory.bufferDestroys;
    boundsLeaves += viewportBoundsLeaves(fixture.viewport);
    expect(cost.cpu["instance-scan"]).toBeLessThanOrEqual(fixture.revisedOccurrences);
    expect(cost.cpu["part-scan"]).toBeLessThanOrEqual(1);
    fixture.viewport.render();
    fixture.revisedCap = capPartForSource(rendererCaps(fixture.viewport), 1);
    fixture.revisedCapVertexBuffer = capVertexBuffer(
      fixture.viewport,
      rendererCaps(fixture.viewport),
      1,
    );
    expect(fixture.revisedCap).toBeDefined();
    expect(fixture.revisedCap).not.toBe(previousCap);
    if (previousCapBuffer !== undefined) {
      expect(
        fixture.gpu.buffers.find((buffer) => buffer.resource === previousCapBuffer)?.destroyCount,
      ).toBe(1);
    }
    samples.push(performance.now() - started);
    retainedResultWrites += writesToRetainedResults(fixture, writeStart);
    retainedStorageWrites += writesToRetainedStorage(fixture, writeStart);
    revisedStorageWrites += writesToRevisedStorage(fixture, writeStart);
    revisedBindGroupCreations += fixture.gpu.bindGroupCreations - bindGroupsBefore;
    expect(cost.cpu["definition-validation"]).toBe(1);
    expect(cost.memory.bufferDestroys).toBeGreaterThan(0);
    expect(viewportBoundsLeaves(fixture.viewport)).toBe(fixture.revisedOccurrences);
    expect(fixture.gpu.bindGroupCreations - bindGroupsBefore).toBeLessThanOrEqual(5);
    maximumRevisionBuffers = Math.max(
      maximumRevisionBuffers,
      fixture.gpu.buffers.length - buffersBefore,
    );
    expect(rendererDraw(fixture.viewport).storages.get(1)).toBe(fixture.revisedStorage);
    expect(rendererDraw(fixture.viewport).storages.get(2)).toBe(fixture.retainedStorage);
    expect(rendererDraw(fixture.viewport).storages.get(2)?.bindGroup).toBe(
      fixture.retainedStorage?.bindGroup,
    );
    expect(rendererDraw(fixture.viewport).primitiveParts.get(2)?.get("triangles")).toBe(
      fixture.retainedGeometry,
    );
    expect(rendererDraw(fixture.viewport).orientationGlyphs.parts.get(2)).toBe(
      fixture.retainedGlyph,
    );
    expect(capPartForSource(rendererCaps(fixture.viewport), 2)).toBe(fixture.retainedCap);
    expect(fixture.viewport.occurrences.partOccurrenceCount).toBe(
      fixture.revisedOccurrences + LIVE_UNRELATED_OCCURRENCES,
    );
    expect(fixture.viewport.results.state).toBeDefined();
  }
  return {
    revisedOccurrences: fixture.revisedOccurrences,
    unrelatedDefinitions: UNRELATED_DEFINITION_COUNT,
    liveUnrelatedOccurrences: LIVE_UNRELATED_OCCURRENCES,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    retainedResultWrites,
    retainedStorageWrites,
    revisedStorageWrites,
    revisedBindGroupCreations,
    maximumRevisionBuffers,
    revisionInstanceScans,
    revisionPartScans,
    revisionWrites,
    definitionValidations,
    resourceRetirements,
    boundsLeaves,
  };
}

async function verifyViewportContracts(fixture: RevisionFixture): Promise<void> {
  fixture.viewport.view.fit({ durationMs: 0 });
  expect(fixture.viewport.view.camera.target.every(Number.isFinite)).toBe(true);
  await expect(fixture.viewport.interaction.pick(0, 0)).resolves.toBeUndefined();
  expect(rendererCapCount(fixture.viewport)).toBeGreaterThan(0);
  await fixture.viewport.recover();
  fixture.viewport.render();
  expect(fixture.viewport.scene.parts.get(1)).toBe(
    fixture.revisions[(fixture.revisionIndex - 1) % fixture.revisions.length],
  );
  expect(rendererDraw(fixture.viewport).storages.get(1)).toBeDefined();
  expect(fixture.viewport.results.state).toBeDefined();
}

function revise(fixture: RevisionFixture): void {
  const part = fixture.revisions[fixture.revisionIndex++ % fixture.revisions.length];
  if (part === undefined) throw new Error("Revision benchmark part is missing");
  expect(
    fixture.viewport.updateScene((update) => {
      update.replacePart(part);
    }),
  ).toEqual({ results: "preserved" });
}

function writesToRetainedResults(fixture: RevisionFixture, start: number): number {
  const count = fixture.gpu.writes
    .slice(start)
    .filter(
      (write) =>
        write.buffer === fixture.retainedColorBuffer ||
        write.buffer === fixture.retainedDeformationBuffer,
    ).length;
  expect(count).toBe(0);
  return count;
}

function writesToRetainedStorage(fixture: RevisionFixture, start: number): number {
  const buffers = [fixture.retainedStorage?.buffer, fixture.retainedStorage?.orderBuffer];
  const count = fixture.gpu.writes
    .slice(start)
    .filter((write) => buffers.includes(write.buffer)).length;
  expect(count).toBe(0);
  return count;
}

function writesToRevisedStorage(fixture: RevisionFixture, start: number): number {
  const buffers = [fixture.revisedStorage?.buffer, fixture.revisedStorage?.orderBuffer];
  const count = fixture.gpu.writes
    .slice(start)
    .filter((write) => buffers.includes(write.buffer)).length;
  expect(count).toBe(0);
  return count;
}

function revisionScene(revisedOccurrences: number) {
  let builder = createSceneBuilder().addPart(tetraPart(1, 1));
  for (let partId = 2; partId < UNRELATED_DEFINITION_COUNT + 2; partId += 1) {
    builder = builder.addPart(tetraPart(partId, 1));
  }
  const placements: {
    readonly kind: "part";
    readonly placementId: string;
    readonly partId: number;
    readonly transform: Float32Array;
  }[] = [];
  for (let index = 0; index < revisedOccurrences; index += 1) {
    placements.push({
      kind: "part",
      placementId: `revised-${index}`,
      partId: 1,
      transform: translation(0, 0, index === 0 ? 0 : 20),
    });
  }
  for (let index = 0; index < LIVE_UNRELATED_OCCURRENCES; index += 1) {
    placements.push({
      kind: "part",
      placementId: `retained-${index}`,
      partId: 2,
      transform: translation(3, 0, index === 0 ? 0 : 20),
    });
  }
  return builder.addAssembly({ id: 1, placements }).setRootAssembly(1).build();
}

function tetraPart(id: number, extent: number): Part {
  const nodes = [0, 0, 0, extent, 0, 0, 0, extent, 0, 0, 0, extent];
  return createPartFromElementModel(
    id,
    createElementModel(nodes, [createElement(0, ElementShape.Tet4, [0, 1, 2, 3])]),
  );
}

function revisionResults() {
  return {
    scalar: {
      field: createResultField({
        id: "revision-scalar",
        name: "revision scalar",
        location: "nodal",
        shape: "scalar",
        count: 4,
        unit: "source",
        values: new Float32Array([1, 2, 3, 4]),
      }),
    },
    deformation: {
      field: createResultField({
        id: "revision-deformation",
        name: "revision deformation",
        location: "nodal",
        shape: "vector",
        count: 4,
        unit: "source",
        values: new Float32Array(12),
      }),
    },
    orientation: {
      field: createResultField({
        id: "revision-orientation",
        name: "revision orientation",
        location: "elemental",
        shape: "vector",
        count: 1,
        unit: "source",
        values: new Float32Array([1, 0, 0]),
      }),
      glyph: "arrow" as const,
      transform: "direction" as const,
    },
  };
}

function translation(x: number, y: number, z: number): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
