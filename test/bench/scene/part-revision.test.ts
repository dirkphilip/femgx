import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "@/elements/element";
import { createElementModel } from "@/elements/model";
import { ElementShape } from "@/elements/shapes";
import { createPartFromElementModel } from "@/geometry/element-model-part";
import { createResultField } from "@/results/fields";
import { createSceneBuilder } from "@/scene/scene";
import { createViewport, type Part, type Viewport } from "@/entries/root";
import {
  fakeCanvas,
  fakeGpuDevice,
  installGpuGlobals,
  type FakeGpu,
} from "../../renderer/fake-gpu";
import { percentile } from "../measure";

const OCCURRENCE_COUNTS = [1, 1_000, 100_000] as const;
const UNRELATED_DEFINITION_COUNT = 10_000;
const LIVE_UNRELATED_PARTS = 2;
const originalNavigator = globalThis.navigator;
let restoreGpuGlobals: (() => void) | undefined;

interface RevisionRow {
  readonly occurrences: number;
  readonly unrelatedDefinitions: number;
  readonly liveUnrelatedParts: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly retainedResultWrites: number;
}

interface RevisionFixture {
  readonly viewport: Viewport;
  readonly gpu: FakeGpu;
  readonly occurrences: number;
  readonly revisions: readonly Part[];
  readonly retainedColorBuffer: GPUBuffer | undefined;
  readonly retainedDeformationBuffer: GPUBuffer | undefined;
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
    for (const occurrences of OCCURRENCE_COUNTS) {
      const fixture = await createFixture(occurrences);
      try {
        rows.push(measureRevision(fixture));
        await verifyViewportContracts(fixture, occurrences === 1);
      } finally {
        fixture.viewport.destroy();
      }
    }
    expect(rows).toHaveLength(OCCURRENCE_COUNTS.length);
    console.log(JSON.stringify({ schemaVersion: 2, rows }, undefined, 2));
  }, 300_000);
});

async function createFixture(occurrences: number): Promise<RevisionFixture> {
  const gpu = fakeGpuDevice();
  const viewport = await createViewport({
    canvas: fakeCanvas(),
    scene: revisionScene(occurrences),
    device: gpu.device,
    results: revisionResults(),
  });
  viewport.render();
  const draw = rendererDraw(viewport);
  return {
    viewport,
    gpu,
    occurrences,
    revisions: [tetraPart(1, 2), tetraPart(1, 3)],
    retainedColorBuffer: draw.resultColors.get(2)?.buffer,
    retainedDeformationBuffer: draw.deformations.get(2)?.buffer,
    revisionIndex: 0,
  };
}

function measureRevision(fixture: RevisionFixture): RevisionRow {
  revise(fixture);
  const samples: number[] = [];
  let retainedResultWrites = 0;
  for (let sample = 0; sample < 7; sample += 1) {
    const writeStart = fixture.gpu.writes.length;
    const started = performance.now();
    revise(fixture);
    fixture.viewport.render();
    samples.push(performance.now() - started);
    retainedResultWrites += writesToRetainedResults(fixture, writeStart);
    expect(fixture.viewport.occurrences.partOccurrenceCount).toBe(
      fixture.occurrences + LIVE_UNRELATED_PARTS,
    );
    expect(fixture.viewport.results.state).toBeDefined();
  }
  return {
    occurrences: fixture.occurrences,
    unrelatedDefinitions: UNRELATED_DEFINITION_COUNT,
    liveUnrelatedParts: LIVE_UNRELATED_PARTS,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    retainedResultWrites,
  };
}

async function verifyViewportContracts(
  fixture: RevisionFixture,
  verifyCaps: boolean,
): Promise<void> {
  fixture.viewport.view.fit({ durationMs: 0 });
  expect(fixture.viewport.view.camera.target.every(Number.isFinite)).toBe(true);
  await expect(fixture.viewport.interaction.pick(0, 0)).resolves.toBeUndefined();
  if (verifyCaps) {
    fixture.viewport.presentation.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    fixture.viewport.render();
    expect(rendererCapCount(fixture.viewport)).toBeGreaterThan(0);
    fixture.viewport.presentation.clearSectionPlane();
  }
  await fixture.viewport.recover();
  fixture.viewport.render();
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

function revisionScene(occurrences: number) {
  let builder = createSceneBuilder().addPart(tetraPart(1, 1));
  for (let partId = 2; partId < UNRELATED_DEFINITION_COUNT + 2; partId += 1) {
    builder = builder.addPart(tetraPart(partId, 1));
  }
  const placements = Array.from({ length: occurrences }, (_, index) => ({
    kind: "part" as const,
    placementId: `revised-${index}`,
    partId: 1,
    transform: translation(0, 0, 10),
  }));
  placements.push(
    { kind: "part", placementId: "retained-a", partId: 2, transform: translation(0, 0, 0) },
    { kind: "part", placementId: "retained-b", partId: 3, transform: translation(3, 0, 0) },
  );
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
  };
}

function translation(x: number, y: number, z: number): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function rendererDraw(viewport: Viewport) {
  const owner = viewport as unknown as {
    readonly renderer: { readonly lifecycle: { readonly bundle: { readonly draw: unknown } } };
  };
  return owner.renderer.lifecycle.bundle.draw as {
    readonly resultColors: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
    readonly deformations: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
  };
}

function rendererCapCount(viewport: Viewport): number {
  const owner = viewport as unknown as {
    readonly renderer: {
      readonly sectionCaps: {
        readonly currentFrame?: { readonly parts: ReadonlyMap<number, Part> };
      };
    };
  };
  return owner.renderer.sectionCaps.currentFrame?.parts.size ?? 0;
}
