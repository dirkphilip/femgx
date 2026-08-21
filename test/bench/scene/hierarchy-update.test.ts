import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "@/elements/element";
import { createElementModel } from "@/elements/model";
import { ElementShape } from "@/elements/shapes";
import { createPartFromElementModel } from "@/geometry/element-model-part";
import { setTargetSelected } from "@/interaction/targets";
import { createResultField } from "@/results/fields";
import {
  createSceneBuilder,
  createViewport,
  type Part,
  type Scene,
  type SceneUpdate,
  type Viewport,
} from "@/entries/root";
import { percentile } from "../measure";
import {
  capPartForSource,
  rendererCaps,
  rendererDraw,
  rendererRevisionCost,
  viewportBoundsCounters,
} from "./part-revision-support";
import {
  fakeCanvas,
  fakeGpuDevice,
  installGpuGlobals,
  type FakeGpu,
} from "../../renderer/fake-gpu";

const CHANGE_COUNTS = [1, 1_000, 100_000] as const;
const UNRELATED_COUNTS = [1_000, 10_000, 100_000] as const;
const originalNavigator = globalThis.navigator;
let restoreGpuGlobals: (() => void) | undefined;

interface HierarchyRow {
  readonly shape: "subtree" | "repeated-owner";
  readonly changedOccurrences: number;
  readonly unrelatedOccurrences: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maximumInstanceScans: number;
  readonly maximumPartScans: number;
  readonly maximumOrderRebuilds: number;
  readonly maximumCallRebuilds: number;
  readonly maximumWriteCalls: number;
  readonly maximumBufferCreates: number;
  readonly maximumBufferDestroys: number;
  readonly maximumCaps: number;
  readonly maximumBoundsLeaves: number;
  readonly maximumBoundsMerges: number;
  readonly capacityGrowths: number;
  readonly rebuiltBoundsLeaves: number;
}

interface HierarchyFixture {
  readonly viewport: Viewport;
  readonly gpu: FakeGpu;
  readonly shape: HierarchyRow["shape"];
  readonly changedOccurrences: number;
  readonly unrelatedOccurrences: number;
  readonly retainedBuffers: ReadonlySet<GPUBuffer>;
  readonly retainedStorage: unknown;
  readonly retainedGeometry: unknown;
  readonly retainedGlyph: unknown;
  readonly retainedCap: unknown;
  present: boolean;
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

describe("full incremental hierarchy transaction scaling", () => {
  it("measures changed subtrees across changed and unrelated scene scales", async () => {
    const rows = await measureShape("subtree");
    expectMatrix(rows);
    console.log(JSON.stringify({ schemaVersion: 4, rows }, undefined, 2));
  }, 300_000);

  it("measures repeated definition owners across unrelated scene scales", async () => {
    const rows = await measureShape("repeated-owner");
    expectMatrix(rows);
    console.log(JSON.stringify({ schemaVersion: 4, rows }, undefined, 2));
  }, 300_000);
});

function expectMatrix(rows: readonly HierarchyRow[]): void {
  expect(
    rows.map(({ changedOccurrences, unrelatedOccurrences }) => [
      changedOccurrences,
      unrelatedOccurrences,
    ]),
  ).toEqual(
    CHANGE_COUNTS.flatMap((changed) => UNRELATED_COUNTS.map((unrelated) => [changed, unrelated])),
  );
}

async function measureShape(shape: HierarchyRow["shape"]): Promise<HierarchyRow[]> {
  const rows: HierarchyRow[] = [];
  for (const count of CHANGE_COUNTS) {
    for (const unrelated of UNRELATED_COUNTS) {
      const fixture = await createFixture(shape, count, unrelated);
      try {
        rows.push(measureFixture(fixture));
        await verifyRecovery(fixture);
      } finally {
        fixture.viewport.destroy();
      }
    }
  }
  return rows;
}

async function createFixture(
  shape: HierarchyRow["shape"],
  changedOccurrences: number,
  unrelatedOccurrences: number,
): Promise<HierarchyFixture> {
  const gpu = fakeGpuDevice();
  const viewport = await createViewport({
    canvas: fakeCanvas(),
    scene: hierarchyScene(shape, changedOccurrences, unrelatedOccurrences),
    device: gpu.device,
    results: hierarchyResults(),
  });
  viewport.presentation.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
  viewport.interaction.set(
    setTargetSelected(viewport.interaction.state, { kind: "part", partId: 2 }, true),
  );
  viewport.render();
  const draw = rendererDraw(viewport);
  const retainedStorage = draw.storages.get(2);
  return {
    viewport,
    gpu,
    shape,
    changedOccurrences,
    unrelatedOccurrences,
    retainedBuffers: new Set(
      [
        retainedStorage?.buffer,
        retainedStorage?.orderBuffer,
        draw.resultColors.get(2)?.buffer,
        draw.deformations.get(2)?.buffer,
      ].filter((buffer): buffer is GPUBuffer => buffer !== undefined),
    ),
    retainedStorage,
    retainedGeometry: draw.primitiveParts.get(2)?.get("triangles"),
    retainedGlyph: draw.orientationGlyphs.parts.get(2),
    retainedCap: capPartForSource(rendererCaps(viewport), 2),
    present: true,
  };
}

function measureFixture(fixture: HierarchyFixture): HierarchyRow {
  const samples: number[] = [];
  const maxima = emptyMaxima();
  for (let sample = 0; sample < 7; sample += 1) {
    const writeStart = fixture.gpu.writes.length;
    const started = performance.now();
    mutate(fixture);
    fixture.viewport.render();
    samples.push(performance.now() - started);
    recordMaxima(fixture, maxima);
    expectUnrelatedUntouched(fixture, writeStart);
  }
  return {
    shape: fixture.shape,
    changedOccurrences: fixture.changedOccurrences,
    unrelatedOccurrences: fixture.unrelatedOccurrences,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    ...maxima,
  };
}

function mutate(fixture: HierarchyFixture): void {
  fixture.viewport.updateScene((update) => {
    hierarchyMutation(fixture, update);
  });
  fixture.present = !fixture.present;
}

function hierarchyMutation(fixture: HierarchyFixture, update: SceneUpdate): void {
  if (fixture.present) {
    update.removePlacement(2, "nested");
    return;
  }
  update.addPlacement(2, {
    kind: "assembly",
    placementId: "nested",
    assemblyId: 3,
    transform: identityMatrix(),
  });
}

function recordMaxima(fixture: HierarchyFixture, maxima: MutableMaxima): void {
  const cost = rendererRevisionCost(fixture.viewport);
  const bounds = viewportBoundsCounters(fixture.viewport);
  maxima.maximumInstanceScans = Math.max(maxima.maximumInstanceScans, cost.cpu["instance-scan"]);
  maxima.maximumPartScans = Math.max(maxima.maximumPartScans, cost.cpu["part-scan"]);
  maxima.maximumOrderRebuilds = Math.max(maxima.maximumOrderRebuilds, cost.cpu["order-rebuild"]);
  maxima.maximumCallRebuilds = Math.max(maxima.maximumCallRebuilds, cost.cpu["call-rebuild"]);
  maxima.maximumWriteCalls = Math.max(maxima.maximumWriteCalls, totalWrites(cost.writes));
  maxima.maximumBufferCreates = Math.max(maxima.maximumBufferCreates, cost.memory.bufferCreates);
  maxima.maximumBufferDestroys = Math.max(maxima.maximumBufferDestroys, cost.memory.bufferDestroys);
  maxima.maximumCaps = Math.max(maxima.maximumCaps, rendererCaps(fixture.viewport).parts.size);
  maxima.maximumBoundsLeaves = Math.max(maxima.maximumBoundsLeaves, bounds.lastUpdatedLeafCount);
  maxima.maximumBoundsMerges = Math.max(maxima.maximumBoundsMerges, bounds.lastMergedNodeCount);
  maxima.capacityGrowths = Math.max(maxima.capacityGrowths, bounds.capacityGrowthCount);
  maxima.rebuiltBoundsLeaves = Math.max(maxima.rebuiltBoundsLeaves, bounds.rebuiltLeafCount);
  expect(cost.cpu["instance-scan"]).toBeLessThanOrEqual(fixture.changedOccurrences);
  expect(bounds.lastUpdatedLeafCount).toBe(fixture.changedOccurrences);
}

function expectUnrelatedUntouched(fixture: HierarchyFixture, writeStart: number): void {
  const draw = rendererDraw(fixture.viewport);
  expect(draw.storages.get(2)).toBe(fixture.retainedStorage);
  expect(draw.primitiveParts.get(2)?.get("triangles")).toBe(fixture.retainedGeometry);
  expect(draw.orientationGlyphs.parts.get(2)).toBe(fixture.retainedGlyph);
  expect(capPartForSource(rendererCaps(fixture.viewport), 2)).toBe(fixture.retainedCap);
  expect(
    fixture.gpu.writes.slice(writeStart).some(({ buffer }) => fixture.retainedBuffers.has(buffer)),
  ).toBe(false);
}

async function verifyRecovery(fixture: HierarchyFixture): Promise<void> {
  await fixture.viewport.recover();
  fixture.viewport.render();
  expect(fixture.viewport.occurrences.partOccurrenceCount).toBe(
    fixture.unrelatedOccurrences + (fixture.present ? fixture.changedOccurrences : 0),
  );
  expect(fixture.viewport.results.state).toBeDefined();
  await expect(fixture.viewport.interaction.pick(0, 0)).resolves.toBeUndefined();
}

interface MutableMaxima {
  maximumInstanceScans: number;
  maximumPartScans: number;
  maximumOrderRebuilds: number;
  maximumCallRebuilds: number;
  maximumWriteCalls: number;
  maximumBufferCreates: number;
  maximumBufferDestroys: number;
  maximumCaps: number;
  maximumBoundsLeaves: number;
  maximumBoundsMerges: number;
  capacityGrowths: number;
  rebuiltBoundsLeaves: number;
}

function emptyMaxima(): MutableMaxima {
  return {
    maximumInstanceScans: 0,
    maximumPartScans: 0,
    maximumOrderRebuilds: 0,
    maximumCallRebuilds: 0,
    maximumWriteCalls: 0,
    maximumBufferCreates: 0,
    maximumBufferDestroys: 0,
    maximumCaps: 0,
    maximumBoundsLeaves: 0,
    maximumBoundsMerges: 0,
    capacityGrowths: 0,
    rebuiltBoundsLeaves: 0,
  };
}

function hierarchyScene(shape: HierarchyRow["shape"], changed: number, unrelated: number): Scene {
  const changedPlacements = Array.from({ length: shape === "subtree" ? changed : 1 }, (_, index) =>
    partPlacement(`changed-${index}`, 1, index === 0 ? 0 : 20),
  );
  const owners = Array.from({ length: shape === "repeated-owner" ? changed : 1 }, (_, index) => ({
    kind: "assembly" as const,
    placementId: `owner-${index}`,
    assemblyId: 2,
    transform: translation(0, 0, index === 0 ? 0 : 20),
  }));
  return createSceneBuilder()
    .addPart(tetraPart(1))
    .addPart(tetraPart(2))
    .addAssembly({ id: 3, placements: changedPlacements })
    .addAssembly({
      id: 2,
      placements: [
        {
          kind: "assembly" as const,
          placementId: "nested",
          assemblyId: 3,
          transform: identityMatrix(),
        },
      ],
    })
    .addAssembly({ id: 1, placements: [...unrelatedPlacements(unrelated), ...owners] })
    .setRootAssembly(1)
    .build();
}

function unrelatedPlacements(count: number) {
  return Array.from({ length: count }, (_, index) =>
    partPlacement(`unrelated-${index}`, 2, index === 0 ? 0 : 20),
  );
}

function partPlacement(placementId: string, partId: number, z: number) {
  return { kind: "part" as const, placementId, partId, transform: translation(0, 0, z) };
}

function tetraPart(id: number): Part {
  return createPartFromElementModel(
    id,
    createElementModel(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      [createElement(0, ElementShape.Tet4, [0, 1, 2, 3])],
    ),
  );
}

function hierarchyResults() {
  return {
    scalar: { field: resultField("scalar", "nodal", "scalar", new Float32Array([1, 2, 3, 4])) },
    deformation: { field: resultField("deform", "nodal", "vector", new Float32Array(12)) },
    orientation: {
      field: resultField("orientation", "elemental", "vector", new Float32Array([1, 0, 0])),
      glyph: "arrow" as const,
      transform: "direction" as const,
    },
  };
}

function resultField<
  const Location extends "nodal" | "elemental",
  const Shape extends "scalar" | "vector",
>(id: string, location: Location, shape: Shape, values: Float32Array) {
  return createResultField({
    id,
    name: id,
    location,
    shape,
    count: location === "nodal" ? 4 : 1,
    unit: "source",
    values,
  });
}

function totalWrites(writes: ReturnType<typeof rendererRevisionCost>["writes"]): number {
  return Object.values(writes).reduce((total, write) => total + write.calls, 0);
}

function identityMatrix(): Float32Array {
  return translation(0, 0, 0);
}

function translation(x: number, y: number, z: number): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
