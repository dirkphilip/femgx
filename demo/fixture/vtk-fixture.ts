import sampleBlockVtk from "./sample-block.vtk?raw";
import { createElement } from "../../src/elements/element";
import { createElementModel, type ElementModel } from "../../src/elements/model";
import { topologyFor } from "../../src/elements/shapes";
import { parseVtk, type FemModel } from "../../src/index";
import { elementPart, type ElementRenderMode } from "../../src/geometry/element-mesh";
import type { Bounds, Part } from "../../src/geometry/part";
import { identity } from "../../src/math/mat4";
import { createScene, type Scene } from "../../src/scene/scene";
import type { AssemblyId, PartId } from "../../src/scene/types";

/** The imported VTK asset and its three display-mode parts. */
export interface VtkFixture {
  readonly scene: Scene;
  readonly vtkModel: FemModel;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly modePartIds: ReadonlyMap<ElementRenderMode, readonly PartId[]>;
  readonly partIds: { readonly solid: PartId; readonly surface: PartId; readonly edges: PartId };
  readonly bounds: Bounds;
}

const SOLID_PART_ID: PartId = 1;
const SURFACE_PART_ID: PartId = 2;
const EDGES_PART_ID: PartId = 3;
const ROOT_ASSEMBLY_ID: AssemblyId = 1;

/** Parses the checked-in ASCII legacy VTK sample into the demo scene. */
export function createVtkFixture(): VtkFixture {
  const vtkModel = parseVtk(sampleBlockVtk, { strict: true }).model;
  if (vtkModel.elementBlocks.length !== 1) {
    throw new Error("The sample VTK asset must contain exactly one element block");
  }
  const block = vtkModel.elementBlocks[0];
  if (block === undefined) throw new Error("The sample VTK asset has no element block");
  const elements = Array.from({ length: block.count }, (_, index) => {
    const nodeCount = topologyFor(block.shape).nodeCount;
    const start = index * nodeCount;
    return createElement(
      block.ids[index] ?? index,
      block.shape,
      Array.from(block.connectivity.slice(start, start + nodeCount)),
    );
  });
  const elementModel = createElementModel([...vtkModel.nodes.coordinates], elements);
  const parts: readonly Part[] = [
    elementPart(SOLID_PART_ID, elementModel, "hex", "solid"),
    elementPart(SURFACE_PART_ID, elementModel, "hex", "surface"),
    elementPart(EDGES_PART_ID, elementModel, "hex", "edges"),
  ];
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
  const elementModels = new Map<PartId, ElementModel>([
    [SOLID_PART_ID, elementModel],
    [SURFACE_PART_ID, elementModel],
    [EDGES_PART_ID, elementModel],
  ]);
  return {
    scene,
    vtkModel,
    elementModels,
    modePartIds: new Map<ElementRenderMode, readonly PartId[]>([
      ["solid", [SOLID_PART_ID]],
      ["surface", [SURFACE_PART_ID]],
      ["edges", [EDGES_PART_ID]],
    ]),
    partIds: { solid: SOLID_PART_ID, surface: SURFACE_PART_ID, edges: EDGES_PART_ID },
    bounds: parts[0]?.bounds ?? emptyBounds(),
  };
}

function emptyBounds(): Bounds {
  return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}
