import sampleBlockVtk from "./sample-block.vtk?raw";
import { createResultFieldFromModelResult, parseVtk } from "../../src/entries/io";
import type { FemModel } from "../../src/entries/io";
import type { PartId, ScalarField, ViewportResultsConfig } from "../../src/entries/root";
import { createVtkScene } from "./vtk-scene";

/** The imported VTK asset and its canonical triangle part. */
export interface VtkFixture {
  readonly scene: ReturnType<typeof createVtkScene>["scene"];
  readonly vtkModel: FemModel;
  readonly elementModels: ReturnType<typeof createVtkScene>["elementModels"];
  readonly partIds: { readonly solid: PartId };
  readonly results: ViewportResultsConfig;
  readonly resultScalarFields: readonly (ScalarField<"nodal"> | ScalarField<"elemental">)[];
}

const SOLID_PART_ID: PartId = 1;

/** Parses the checked-in ASCII legacy VTK sample into the demo scene. */
export function createVtkFixture(): VtkFixture {
  const vtkModel = parseVtk(sampleBlockVtk, { strict: true }).model;
  const imported = createVtkScene(vtkModel);
  if (imported.scene.parts.size !== 1) {
    throw new Error("The sample VTK asset must contain one part");
  }
  const stress = vtkModel.results.find((result) => result.name === "stress");
  const temperature = vtkModel.results.find((result) => result.name === "temperature");
  const displacement = vtkModel.results.find((result) => result.name === "displacement");
  if (stress === undefined || temperature === undefined || displacement === undefined) {
    throw new Error("The sample VTK asset has no imported temperature/stress/displacement results");
  }
  const stressField = createResultFieldFromModelResult(vtkModel, stress, {
    id: "vtk-stress",
    unit: "MPa",
    shape: "scalar",
  });
  const temperatureField = createResultFieldFromModelResult(vtkModel, temperature, {
    id: "vtk-temperature",
    unit: "C",
    shape: "scalar",
  });
  const results: ViewportResultsConfig = {
    scalar: {
      field: stressField,
    },
    deformation: {
      field: createResultFieldFromModelResult(vtkModel, displacement, {
        id: "vtk-displacement",
        unit: "mm",
        shape: "vector",
      }),
      scale: 1,
    },
  };
  return {
    scene: imported.scene,
    vtkModel,
    elementModels: imported.elementModels,
    partIds: { solid: SOLID_PART_ID },
    results,
    resultScalarFields: [stressField, temperatureField],
  };
}
