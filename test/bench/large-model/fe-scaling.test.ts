import { describe, expect, it } from "vitest";
import { createInteractionState } from "../../../src/interaction/interaction";
import { readInteractionState, updateInteractionState } from "../../../src/interaction/state";
import { setTargetsSelected } from "../../../src/interaction/targets";
import { createStructuredFeModel } from "../../../demo/benchmark/structured-fe";
import { boundaryFaceRefsForModel } from "../../../src/elements/faces";
import { createPartFromElementModel } from "../../../src/entries/model";
import { getPartSemanticIndex } from "../../../src/geometry/part-semantic-index";
import { buildElementSectionCap } from "../../../src/geometry/section-cap";
import { partSemanticGraph } from "../../../src/geometry/semantic/part-semantic-graph";
import { identityMatrix } from "../../../src/math/mat4";
import type { Part } from "../../../src/geometry/part";
import { buildInstanceLayout } from "../../../src/renderer/runtime-state";
import { SectionCapController } from "../../../src/renderer/section-cap-controller";
import { createGpuBundle, destroyGpuBundle } from "../../../src/renderer/recovery";
import {
  collectDenseElementSelections,
  denseSelectionContains,
} from "../../../src/renderer/selection/element-selection";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { benchmarkCaseSpecs, createBenchmarkCase } from "../../../demo/benchmark/model";
import { measureMs, measureScaling, type ScalingMeasurement, type ScalingPoint } from "../measure";
import { fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";

const GRID_SIZES = [24, 35, 47] as const;
const ELEMENT_COUNTS = GRID_SIZES.map((size) => size ** 3);
const models = GRID_SIZES.map((size) => createStructuredFeModel("hex8", size));
const TET4_ELEMENT_COUNT = 6 * 28 ** 3;
const TET4_BOUNDARY_GRID_SIZE = 35;
const TET4_BOUNDARY_ELEMENT_COUNT = 6 * TET4_BOUNDARY_GRID_SIZE ** 3;
const TET4_BOUNDARY_TOTAL_FACE_COUNT = 4 * TET4_BOUNDARY_ELEMENT_COUNT;
const TET4_BOUNDARY_FACE_COUNT = 12 * TET4_BOUNDARY_GRID_SIZE ** 2;
const TET4_INTERIOR_FACE_COUNT = TET4_BOUNDARY_TOTAL_FACE_COUNT - TET4_BOUNDARY_FACE_COUNT;
const tet4BoundaryModel = createStructuredFeModel("tet4", TET4_BOUNDARY_GRID_SIZE);
const tet4BoundaryFaces = boundaryFaceRefsForModel(tet4BoundaryModel);
const tet4Spec = benchmarkCaseSpecs(false).find((spec) => spec.id === "fe-tet4-solid-132k");
if (tet4Spec === undefined) throw new Error("Tet4 benchmark case is missing");
const tet4Case = createBenchmarkCase(tet4Spec);
const tet4Part = [...tet4Case.scene.parts.values()][0];
if (tet4Part === undefined) throw new Error("Tet4 benchmark part is missing");
const tet4PartId = tet4Part.id;
const tet4Runtime = createPackedSceneRuntime(tet4Case.scene);
const tet4Layout = buildInstanceLayout(tet4Runtime);
const tet4InstanceId = tet4Runtime.getInstanceId(0);
if (tet4InstanceId === undefined) throw new Error("Tet4 benchmark instance is missing");
const tet4Elements = [...(tet4Part.elements ?? [])];
const hex8SectionPart = createPartFromElementModel(31_000, createStructuredFeModel("hex8", 51));
const tet4Targets = tet4Elements.map((element) => ({
  kind: "element" as const,
  partOccurrenceId: tet4InstanceId,
  elementId: element.id,
}));
getPartSemanticIndex(tet4Part);
const tet4Interactions = Array.from({ length: 3 }, () =>
  setTargetsSelected(createInteractionState(), tet4Targets, true),
);
const halfTet4Interaction = setTargetsSelected(
  createInteractionState(),
  tet4Targets.slice(0, TET4_ELEMENT_COUNT / 2),
  true,
);
const halfTet4HiddenInteraction = updateInteractionState(createInteractionState(), {
  hiddenElementIds: new Map([
    [
      tet4InstanceId,
      new Set(tet4Targets.slice(0, TET4_ELEMENT_COUNT / 2).map(({ elementId }) => elementId)),
    ],
  ]),
});
const halfTet4HiddenSelectedInteraction = setTargetsSelected(
  halfTet4HiddenInteraction,
  tet4Targets.slice(TET4_ELEMENT_COUNT / 2, TET4_ELEMENT_COUNT / 2 + 1),
  true,
);
let tet4InteractionIndex = 0;

interface LargeScalingCase {
  readonly name: string;
  readonly points: readonly ScalingPoint[];
}

const cases: readonly LargeScalingCase[] = [
  {
    name: "structured Hex8 part compilation through 100k elements",
    points: models.map((model, index) => ({
      size: model.elements.count,
      run: () => {
        createPartFromElementModel(20_000 + index, model);
      },
    })),
  },
];

function runTet4DenseSelection(): void {
  const interaction = tet4Interactions[tet4InteractionIndex];
  tet4InteractionIndex = (tet4InteractionIndex + 1) % tet4Interactions.length;
  if (interaction === undefined) throw new Error("Tet4 interaction is missing");
  const dense = collectDenseElementSelections(
    tet4Runtime,
    tet4Layout,
    tet4Case.scene.parts,
    interaction,
  );
  const occurrence = dense.get(tet4PartId)?.occurrences[0];
  if (
    occurrence === undefined ||
    !denseSelectionContains(dense.get(tet4PartId), occurrence.slot, 1) ||
    !denseSelectionContains(dense.get(tet4PartId), occurrence.slot, TET4_ELEMENT_COUNT)
  ) {
    throw new Error("Tet4 dense selection lost authored elements");
  }
}

describe("large-model scaling", () => {
  it("uses the intended authored solid element counts", () => {
    expect(ELEMENT_COUNTS).toEqual([13_824, 42_875, 103_823]);
    expect(models.map((model) => model.elements.count)).toEqual(ELEMENT_COUNTS);
    expect(tet4Elements).toHaveLength(TET4_ELEMENT_COUNT);
  });

  it("keeps full Tet4 dense selection materialization bounded", () => {
    const measured = measureMs(runTet4DenseSelection, { warmup: 0, samples: 3 });
    report("131,712-element Tet4 dense selection materialization", [
      {
        size: TET4_ELEMENT_COUNT,
        measuredMs: measured,
        millisecondsPerUnit: measured / TET4_ELEMENT_COUNT,
      },
    ]);
    expect(measured).toBeLessThanOrEqual(100);
  });

  it("keeps large Tet4 and Hex8 section-cap traversal linear and graph-owned", () => {
    const cases = [
      { name: "Tet4", part: tet4Part, plane: 14.5 },
      { name: "Hex8", part: hex8SectionPart, plane: 25.5 },
    ] as const;
    for (const { name, part, plane } of cases) {
      const graph = partSemanticGraph(part);
      if (graph === undefined) throw new Error(`${name} section part lost semantic ownership`);
      const measured = measureMs(() => sectionCapCount(part, plane), { warmup: 0, samples: 3 });
      const capCount = sectionCapCount(part, plane);
      report(`${part.elements?.count ?? 0}-element ${name} section-cap traversal`, [
        {
          size: part.elements?.count ?? 0,
          measuredMs: measured,
          millisecondsPerUnit: measured / (part.elements?.count ?? 1),
        },
      ]);
      expect(capCount).toBeGreaterThan(0);
      expect(graph.faceElementOffsets.byteLength).toBe(
        (graph.elementIds.length + 1) * Uint32Array.BYTES_PER_ELEMENT,
      );
      expect(graph.faceElementOffsets.byteLength).toBeLessThanOrEqual(
        graph.faceOwnerElementOrdinals.byteLength + Uint32Array.BYTES_PER_ELEMENT,
      );
      expect(measured).toBeLessThanOrEqual(1_000);
    }
  });

  it("updates half-selected active Tet4 caps in place", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const controller = new SectionCapController();
      const visible = createInteractionState();
      controller.sync({
        runtime: tet4Runtime,
        parts: tet4Case.scene.parts,
        plane: { normal: [1, 0, 0], distance: -14.5 },
        interaction: visible,
        deformation: undefined,
        resultColors: undefined,
        draw: bundle.draw,
      });
      const frame = controller.currentFrame;
      if (frame === undefined) throw new Error("Tet4 section frame is missing");
      const bufferCount = gpu.buffers.length;
      let interaction = halfTet4Interaction;
      const measured = measureMs(
        () => {
          controller.syncStyles(tet4Runtime, tet4Case.scene.parts, interaction, bundle.draw);
          interaction = interaction === visible ? halfTet4Interaction : visible;
        },
        { warmup: 0, samples: 3 },
      );
      report("131,712-element Tet4 half-selection active-cap style sync", [
        {
          size: frame.parts.size,
          measuredMs: measured,
          millisecondsPerUnit: measured / frame.parts.size,
        },
      ]);
      expect(frame.parts.size).toBeGreaterThan(0);
      expect(controller.currentFrame).toBe(frame);
      expect(gpu.buffers).toHaveLength(bufferCount);
      expect(measured).toBeLessThanOrEqual(1_000);

      const hiddenController = new SectionCapController();
      hiddenController.sync({
        runtime: tet4Runtime,
        parts: tet4Case.scene.parts,
        plane: { normal: [1, 0, 0], distance: -14.5 },
        interaction: halfTet4HiddenInteraction,
        deformation: undefined,
        resultColors: undefined,
        draw: bundle.draw,
      });
      const hiddenFrame = hiddenController.currentFrame;
      if (hiddenFrame === undefined) throw new Error("hidden Tet4 section frame is missing");
      const hiddenBuffers = gpu.buffers.length;
      hiddenController.syncStyles(
        tet4Runtime,
        tet4Case.scene.parts,
        halfTet4HiddenSelectedInteraction,
        bundle.draw,
      );
      expect(readInteractionState(halfTet4HiddenSelectedInteraction).hiddenElementIds).toBe(
        readInteractionState(halfTet4HiddenInteraction).hiddenElementIds,
      );
      expect(hiddenController.currentFrame).toBe(hiddenFrame);
      expect(gpu.buffers).toHaveLength(hiddenBuffers);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });

  it("keeps 257,250-element Tet4 boundary extraction bounded", () => {
    const measured = measureMs(
      () => {
        const refs = boundaryFaceRefsForModel(tet4BoundaryModel);
        if (refs.length !== TET4_BOUNDARY_FACE_COUNT) {
          throw new Error("Tet4 boundary extraction lost exterior faces");
        }
      },
      { warmup: 0, samples: 1 },
    );
    report("257,250-element Tet4 boundary-face extraction", [
      {
        size: TET4_BOUNDARY_FACE_COUNT,
        measuredMs: measured,
        millisecondsPerUnit: measured / TET4_BOUNDARY_FACE_COUNT,
      },
    ]);
    expect(measured).toBeLessThanOrEqual(1_000);
  });

  it("reports canonical 257,250-element Tet4 part compilation", () => {
    const measured = measureMs(
      () => {
        const part = createPartFromElementModel(30_000, tet4BoundaryModel, {
          faceSubset: tet4BoundaryFaces,
        });
        const triangles = part.geometries.find((geometry) => geometry.primitive === "triangles");
        if (part.elements?.count !== TET4_BOUNDARY_ELEMENT_COUNT) {
          throw new Error("Tet4 part lost authored elements");
        }
        if (triangles?.primitive !== "triangles") throw new Error("Tet4 triangles are missing");
        const faces = triangles.faces;
        if (faces?.count !== TET4_BOUNDARY_TOTAL_FACE_COUNT) {
          throw new Error("Tet4 part lost face topology");
        }
        let interiorFaceCount = 0;
        for (const face of faces) {
          if (face.neighborElementId !== undefined) interiorFaceCount += 1;
        }
        if (interiorFaceCount !== TET4_INTERIOR_FACE_COUNT) {
          throw new Error("Tet4 part lost interior face ownership");
        }
        if (triangles.faceSubset?.count !== TET4_BOUNDARY_FACE_COUNT) {
          throw new Error("Tet4 part lost its exterior face subset");
        }
      },
      { warmup: 0, samples: 1 },
    );
    report("257,250-element Tet4 canonical part compilation", [
      {
        size: TET4_BOUNDARY_ELEMENT_COUNT,
        measuredMs: measured,
        millisecondsPerUnit: measured / TET4_BOUNDARY_ELEMENT_COUNT,
      },
    ]);
    expect(measured).toBeLessThanOrEqual(7_500);
  });

  it.each(cases)("$name remains approximately linear", ({ name, points }) => {
    const measurements = measureScaling(points, { warmup: 0, samples: 3 });
    report(name, measurements);
    const normalized = measurements.map(({ millisecondsPerUnit }) => millisecondsPerUnit);
    const spread = Math.max(...normalized) / Math.min(...normalized);
    expect(
      spread,
      `${name} normalized cost spread was ${spread.toFixed(2)}x; expected at most 3x`,
    ).toBeLessThanOrEqual(3);
  });
});

function sectionCapCount(part: Part, plane: number): number {
  let count = 0;
  for (const element of part.elements ?? []) {
    const cap = buildElementSectionCap({
      part,
      element,
      plane: { normal: [1, 0, 0], distance: -plane },
      transform: identityMatrix(),
    });
    if (cap !== undefined) count += 1;
  }
  return count;
}

function report(name: string, measurements: readonly ScalingMeasurement[]): void {
  console.log(
    `${name}: ${measurements
      .map(({ size, measuredMs }) => `${size}=${measuredMs.toFixed(3)} ms`)
      .join(", ")}`,
  );
}
