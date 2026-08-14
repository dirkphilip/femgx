import sampleBlockVtk from "./sample-block.vtk?raw";
import {
  createResultFieldFromModelResult,
  parseVtk,
  type FemModel,
  type PartId,
  type ViewportResultsConfig,
} from "../../src/index";
import { createVtkScene } from "./vtk-scene";

/** The imported VTK asset and its canonical triangle part. */
export interface VtkFixture {
  readonly scene: ReturnType<typeof createVtkScene>["scene"];
  readonly vtkModel: FemModel;
  readonly elementModels: ReturnType<typeof createVtkScene>["elementModels"];
  readonly partIds: { readonly solid: PartId };
  readonly results: ViewportResultsConfig;
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
  const displacement = vtkModel.results.find((result) => result.name === "displacement");
  if (stress === undefined || displacement === undefined) {
    throw new Error("The sample VTK asset has no imported stress/displacement results");
  }
  const results: ViewportResultsConfig = {
    field: createResultFieldFromModelResult(vtkModel, stress, {
      id: "vtk-stress",
      unit: "MPa",
      shape: "scalar",
    }),
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
  };
}
