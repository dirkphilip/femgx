import { describe, expect, it } from "vitest";
import { createInteractionState } from "../../src/interaction/interaction";
import { setTargetsSelected } from "../../src/interaction/targets";
import { createStructuredFeModel } from "../../demo/benchmark/structured-fe";
import { boundaryFaceRefs } from "../../src/elements/faces";
import { elementPart } from "../../src/entries/model";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import {
  collectDenseElementSelections,
  denseSelectionContains,
} from "../../src/renderer/selection/element-selection";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { benchmarkCaseSpecs, createBenchmarkCase } from "../../demo/benchmark/model";
import { measureMs, measureScaling, type ScalingMeasurement, type ScalingPoint } from "./measure";

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
const tet4BoundaryFaces = boundaryFaceRefs(tet4BoundaryModel.elements);
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
const tet4Elements = tet4Part.elements ?? [];
const tet4Targets = tet4Elements.map((element) => ({
  kind: "element" as const,
  partOccurrenceId: tet4InstanceId,
  elementId: element.id,
}));
getPartSemanticIndex(tet4Part);
const tet4Interactions = Array.from({ length: 3 }, () =>
  setTargetsSelected(createInteractionState(), tet4Targets, true),
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
      size: model.elements.length,
      run: () => {
        elementPart(20_000 + index, model);
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
    expect(models.map((model) => model.elements.length)).toEqual(ELEMENT_COUNTS);
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

  it("keeps 257,250-element Tet4 boundary extraction bounded", () => {
    const measured = measureMs(
      () => {
        const refs = boundaryFaceRefs(tet4BoundaryModel.elements);
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
        const part = elementPart(30_000, tet4BoundaryModel, {
          faceSubset: tet4BoundaryFaces,
        });
        const triangles = part.geometries.find((geometry) => geometry.primitive === "triangles");
        if (part.elements?.length !== TET4_BOUNDARY_ELEMENT_COUNT) {
          throw new Error("Tet4 part lost authored elements");
        }
        if (triangles?.primitive !== "triangles") throw new Error("Tet4 triangles are missing");
        const faces = triangles.faces ?? [];
        if (faces.length !== TET4_BOUNDARY_TOTAL_FACE_COUNT) {
          throw new Error("Tet4 part lost face topology");
        }
        let interiorFaceCount = 0;
        for (const face of faces) {
          if (face.neighborElementId !== undefined) interiorFaceCount += 1;
        }
        if (interiorFaceCount !== TET4_INTERIOR_FACE_COUNT) {
          throw new Error("Tet4 part lost interior face ownership");
        }
        if (triangles.faceSubset?.faceIds.length !== TET4_BOUNDARY_FACE_COUNT) {
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

function report(name: string, measurements: readonly ScalingMeasurement[]): void {
  console.log(
    `${name}: ${measurements
      .map(({ size, measuredMs }) => `${size}=${measuredMs.toFixed(3)} ms`)
      .join(", ")}`,
  );
}
