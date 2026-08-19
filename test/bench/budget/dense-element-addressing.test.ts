import { describe, expect, it } from "vitest";
import { createElement, type Element } from "../../../src/elements/element";
import { createElementModel } from "../../../src/elements/model";
import { ElementShape } from "../../../src/elements/shapes";
import { elementPart } from "../../../src/geometry/element-part";
import { identity } from "../../../src/math/mat4";
import { createModelBuilder } from "../../../src/io/model-builder";
import { createResultFieldFromModelResult } from "../../../src/io/conversions/result-field";
import type { FemModel } from "../../../src/io/fem-model";
import { resolveElementalOrientationRecords } from "../../../src/results/orientation-records";
import { createResultField, type ScalarField, type VectorField } from "../../../src/results/fields";
import { createScalarColorMap } from "../../../src/results/mapping";
import { scalarRange } from "../../../src/results/range";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { createScene } from "../../../src/scene/scene";
import { resolveViewportResults, viewportResultColors } from "../../../src/viewport/results";
import {
  buildOperationsReport,
  emitOperationsReport,
  type OperationSpec,
} from "../operation-report";

const ELEMENT_COUNT = 4_096;
const profiles = [
  { name: "contiguous", ids: idsFrom((index) => index + 1) },
  { name: "moderately-sparse", ids: idsFrom((index) => index * 3 + 1) },
  { name: "very-sparse", ids: idsFrom((index) => 10_000_000 + index * 17) },
] as const;
const models = profiles.map(({ ids }) => ({ ids, model: modelFrom(ids) }));
const partModel = modelFrom(profiles[2].ids);
const part = elementPart(1, partModelToElements(partModel));
const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 1,
    name: "dense-addressing",
    placements: [{ kind: "part", partId: 1, transform: identity() }],
  })
  .withRoot(1)
  .build();
const runtime = createPackedSceneRuntime(scene);
const scalarValues = Float32Array.from({ length: ELEMENT_COUNT }, (_, index) => index % 101);
const vectorValues = new Float32Array(ELEMENT_COUNT * 3);
for (let index = 0; index < ELEMENT_COUNT; index += 1) vectorValues[index * 3] = 1;

describe("dense element addressing baseline", () => {
  it("reports conversion, range, snapshot, and orientation workloads", () => {
    const report = buildOperationsReport(operationSpecs());
    expect(report.operations).toHaveLength(7);
    expect(report.operations.map((operation) => operation.name)).toEqual([
      "element-result-conversion-contiguous",
      "element-result-conversion-moderately-sparse",
      "element-result-conversion-very-sparse",
      "element-result-automatic-range",
      "element-result-snapshot",
      "element-result-orientation-records",
      "element-result-selection-sync-reference",
    ]);
    for (const operation of report.operations) {
      expect(operation.timingsMs.p95).toBeGreaterThanOrEqual(operation.timingsMs.p50);
      expect(operation.workload.count).toBeGreaterThan(0);
      expect(operation.workload.details?.["denseRows"]).toBe(ELEMENT_COUNT);
    }
    emitOperationsReport(report);
  });
});

function operationSpecs(): readonly OperationSpec[] {
  const conversionOperations = models.map(({ ids, model }, index) => {
    const profile = profiles[index];
    if (profile === undefined) throw new Error("Missing element-id profile");
    return {
      name: `element-result-conversion-${profile.name}`,
      workloadUnit: "authored element rows",
      workloadCount: ids.length,
      workloadDetails: conversionDetails(ids),
      run: () => {
        const field = createResultFieldFromModelResult(model, sourceResult(ids), {
          id: profile.name,
          unit: "MPa",
          shape: "scalar",
        });
        if (field.location !== "elemental" || field.count !== ELEMENT_COUNT) {
          throw new Error("Elemental conversion did not retain dense row count");
        }
      },
    } satisfies OperationSpec;
  });
  return [
    ...conversionOperations,
    {
      name: "element-result-automatic-range",
      workloadUnit: "dense scalar rows",
      workloadCount: ELEMENT_COUNT,
      workloadDetails: {
        denseRows: ELEMENT_COUNT,
        retainedDenseValueBytes: scalarValues.byteLength,
      },
      run: () => {
        const range = scalarRange(denseScalar());
        if (range?.max !== 100) throw new Error("Dense scalar range changed");
      },
    },
    {
      name: "element-result-snapshot",
      workloadUnit: "dense scalar rows",
      workloadCount: ELEMENT_COUNT,
      workloadDetails: {
        denseRows: ELEMENT_COUNT,
        retainedDenseValueBytes: scalarValues.byteLength,
      },
      run: () => {
        const state = resolveViewportResults(
          {
            scalar: {
              field: denseScalar(),
              partId: 1,
              colorMap: createScalarColorMap({ min: 0, max: 100 }),
            },
          },
          scene,
          runtime,
        );
        if (viewportResultColors(state)?.get(1)?.values.length !== (ELEMENT_COUNT + 1) * 4) {
          throw new Error("Elemental snapshot did not build a dense color table");
        }
      },
    },
    {
      name: "element-result-orientation-records",
      workloadUnit: "dense orientation rows",
      workloadCount: ELEMENT_COUNT,
      workloadDetails: {
        denseRows: ELEMENT_COUNT,
        retainedDenseValueBytes: vectorValues.byteLength,
      },
      run: () => {
        const field = denseVector();
        const records = resolveElementalOrientationRecords(part, field, undefined, true);
        if (records.elementIds.length !== ELEMENT_COUNT) {
          throw new Error("Elemental orientation did not resolve every dense row");
        }
      },
    },
    {
      name: "element-result-selection-sync-reference",
      workloadUnit: "stable element identities",
      workloadCount: ELEMENT_COUNT,
      workloadDetails: {
        denseRows: ELEMENT_COUNT,
        retainedDenseValueBytes: scalarValues.byteLength,
      },
      run: () => {
        const selected = new Set((part.elements ?? []).map((element) => element.id));
        if (selected.size !== ELEMENT_COUNT || !selected.has(profiles[2].ids[0])) {
          throw new Error("Stable selection identity reference changed");
        }
      },
    },
  ];
}

function idsFrom(makeId: (index: number) => number): readonly number[] {
  return Array.from({ length: ELEMENT_COUNT }, (_, index) => makeId(index));
}

function modelFrom(ids: readonly number[]): FemModel {
  const builder = createModelBuilder();
  builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  builder.openElementShapeBlock(ElementShape.Line);
  builder.appendElements(ids, Array.from({ length: ids.length }, () => [0, 1]).flat());
  return builder.build();
}

function partModelToElements(model: FemModel) {
  const elements: Element[] = [];
  const block = model.elementShapeBlocks[0];
  if (block === undefined) throw new Error("Missing benchmark element block");
  for (let index = 0; index < block.count; index += 1) {
    elements.push(createElement(block.ids[index] ?? 0, ElementShape.Line, [0, 1]));
  }
  return createElementModel(model.nodes.coordinates, elements);
}

function sourceResult(ids: readonly number[]) {
  return {
    name: "sparse elemental source",
    location: "element" as const,
    components: 1,
    ids: new Uint32Array(ids),
    values: Float64Array.from(ids, (_, index) => index % 101),
  };
}

function conversionDetails(ids: readonly number[]): Readonly<Record<string, number>> {
  return {
    denseRows: ids.length,
    maxElementId: Math.max(...ids),
    retainedDenseValueBytes: ids.length * Float32Array.BYTES_PER_ELEMENT,
  };
}

function denseScalar(): ScalarField<"elemental"> {
  return createResultField({
    id: "dense-scalar",
    name: "Dense scalar",
    location: "elemental",
    shape: "scalar",
    count: ELEMENT_COUNT,
    unit: "MPa",
    values: scalarValues,
  });
}

function denseVector(): VectorField<"elemental"> {
  return createResultField({
    id: "dense-vector",
    name: "Dense vector",
    location: "elemental",
    shape: "vector",
    count: ELEMENT_COUNT,
    unit: "unitless",
    values: new Float32Array(vectorValues),
  });
}
