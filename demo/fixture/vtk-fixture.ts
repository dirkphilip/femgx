import sampleBlockVtk from "./sample-block.vtk?raw";
import {
  boundaryFaceRefs,
  createElementModelFromFemModel,
  createScene,
  heterogeneousElementParts,
  identity,
  parseVtk,
  type AssemblyId,
  type ElementModel,
  type FemModel,
  type Part,
  type PartId,
  type Scene,
} from "../../src/index";

/** The imported VTK asset and its canonical triangle part. */
export interface VtkFixture {
  readonly scene: Scene;
  readonly vtkModel: FemModel;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly partIds: { readonly solid: PartId };
}

const SOLID_PART_ID: PartId = 1;
const ROOT_ASSEMBLY_ID: AssemblyId = 1;

/** Parses the checked-in ASCII legacy VTK sample into the demo scene. */
export function createVtkFixture(): VtkFixture {
  const vtkModel = parseVtk(sampleBlockVtk, { strict: true }).model;
  if (vtkModel.elementBlocks.length !== 1) {
    throw new Error("The sample VTK asset must contain exactly one element block");
  }
  const block = vtkModel.elementBlocks[0];
  if (block === undefined) throw new Error("The sample VTK asset has no element block");
  const elementModel = createElementModelFromFemModel(vtkModel);
  const exteriorFaces = boundaryFaceRefs(elementModel.elements);
  const triangle = heterogeneousElementParts({ triangle: SOLID_PART_ID }, elementModel, {
    faceSubset: exteriorFaces,
  }).triangle;
  if (triangle === undefined) throw new Error("The sample VTK asset has no triangle part");
  const parts: readonly Part[] = [triangle];
  let builder = createScene();
  for (const part of parts) builder = builder.addPart(part);
  const root = {
    id: ROOT_ASSEMBLY_ID,
    name: "vtk-sample",
    placements: parts.map((part) => ({
      kind: "part" as const,
      partId: part.id,
      transform: identity(),
    })),
  };
  const scene = builder.addAssembly(root).withRoot(root.id).build();
  const elementModels = new Map<PartId, ElementModel>([[SOLID_PART_ID, elementModel]]);
  return {
    scene,
    vtkModel,
    elementModels,
    partIds: { solid: SOLID_PART_ID },
  };
}
