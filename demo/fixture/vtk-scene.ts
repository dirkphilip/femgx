import {
  createScene,
  identity,
  type Bounds,
  type Color,
  type PartId,
  type Scene,
  type StyleOverride,
  type ViewportResultsConfig,
} from "../../src/entries/root";
import {
  createElementModelFromFemModel,
  createResultFieldFromModelResult,
} from "../../src/entries/io";
import { boundaryFaceRefs, elementPart } from "../../src/entries/model";
import type { ElementModel } from "../../src/entries/model";
import type { FemModel } from "../../src/entries/io";

/** The canonical scene data derived from one parsed VTK finite-element model. */
export interface VtkScene {
  readonly scene: Scene;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly partNames: ReadonlyMap<PartId, string>;
  readonly partStyles: ReadonlyMap<PartId, StyleOverride>;
  readonly bounds: Bounds;
  readonly results: ViewportResultsConfig | undefined;
}

const PART_ID: PartId = 1;
const ROOT_ASSEMBLY_ID = 1;
const PART_COLOR: Color = { r: 0.23, g: 0.57, b: 0.84, a: 1 };

/** Builds the canonical scene, primitive groups, and supported authored fields. */
export function createVtkScene(vtkModel: FemModel): VtkScene {
  const elementModel = createElementModelFromFemModel(vtkModel);
  const part = elementPart(PART_ID, elementModel, {
    faceSubset: boundaryFaceRefs(elementModel.elements),
  });
  if (part.geometries.length === 0)
    throw new Error("VTK model contains no supported drawable cells");

  const builder = createScene().addPart(part);
  const scene = builder
    .addAssembly({
      id: ROOT_ASSEMBLY_ID,
      name: "opened-vtk-model",
      placements: [{ kind: "part" as const, partId: part.id, transform: identity() }],
    })
    .withRoot(ROOT_ASSEMBLY_ID)
    .build();

  const elementModels = new Map<PartId, ElementModel>([[part.id, elementModel]]);
  const partNames = new Map<PartId, string>([[part.id, "Opened VTK"]]);
  const partStyles = new Map<PartId, StyleOverride>([[part.id, { color: PART_COLOR }]]);
  return {
    scene,
    elementModels,
    partNames,
    partStyles,
    bounds: part.bounds,
    results: importedResults(vtkModel),
  };
}

function importedResults(model: FemModel): ViewportResultsConfig | undefined {
  const scalar = model.results.find((result) => result.components === 1);
  if (scalar === undefined) return undefined;
  const vector = model.results.find(
    (result) => result.location === "node" && result.components === 3,
  );
  return {
    scalar: {
      field: createResultFieldFromModelResult(model, scalar, {
        id: "vtk-imported-scalar",
        unit: "source",
        shape: "scalar",
      }),
    },
    ...(vector === undefined
      ? {}
      : {
          deformation: {
            field: createResultFieldFromModelResult(model, vector, {
              id: "vtk-imported-displacement",
              unit: "source",
              shape: "vector",
            }),
            scale: 1,
          },
        }),
  };
}
