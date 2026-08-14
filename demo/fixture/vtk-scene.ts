import {
  boundaryFaceRefs,
  createElementModelFromFemModel,
  createResultFieldFromModelResult,
  createScene,
  heterogeneousElementParts,
  identity,
  type Bounds,
  type Color,
  type ElementModel,
  type FemModel,
  type Part,
  type PartId,
  type Scene,
  type StyleOverride,
  type ViewportResultsConfig,
} from "../../src/index";

/** The canonical scene data derived from one parsed VTK finite-element model. */
export interface VtkScene {
  readonly scene: Scene;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly partNames: ReadonlyMap<PartId, string>;
  readonly partStyles: ReadonlyMap<PartId, StyleOverride>;
  readonly bounds: Bounds;
  readonly results: ViewportResultsConfig | undefined;
}

const PART_IDS = { triangle: 1, line: 2, point: 3 } as const;
const ROOT_ASSEMBLY_ID = 1;
const PART_COLORS: Readonly<Record<keyof typeof PART_IDS, Color>> = {
  triangle: { r: 0.23, g: 0.57, b: 0.84, a: 1 },
  line: { r: 0.18, g: 0.72, b: 0.98, a: 1 },
  point: { r: 0.98, g: 0.78, b: 0.24, a: 1 },
};

/** Builds the canonical scene, primitive groups, and supported authored fields. */
export function createVtkScene(vtkModel: FemModel): VtkScene {
  const elementModel = createElementModelFromFemModel(vtkModel);
  const parts = heterogeneousElementParts(PART_IDS, elementModel, {
    faceSubset: boundaryFaceRefs(elementModel.elements),
  });
  const entries = primitiveEntries(parts);
  if (entries.length === 0) throw new Error("VTK model contains no supported drawable cells");

  let builder = createScene();
  for (const { part } of entries) builder = builder.addPart(part);
  const scene = builder
    .addAssembly({
      id: ROOT_ASSEMBLY_ID,
      name: "opened-vtk-model",
      placements: entries.map(({ part }) => ({
        kind: "part" as const,
        partId: part.id,
        transform: identity(),
      })),
    })
    .withRoot(ROOT_ASSEMBLY_ID)
    .build();

  const elementModels = new Map<PartId, ElementModel>(
    entries.map(({ part }) => [part.id, elementModel]),
  );
  const partNames = new Map<PartId, string>(
    entries.map(({ part, group }) => [part.id, `Opened VTK · ${group}`]),
  );
  const partStyles = new Map<PartId, StyleOverride>(
    entries.map(({ part, group }) => [part.id, { color: PART_COLORS[group] }]),
  );
  return {
    scene,
    elementModels,
    partNames,
    partStyles,
    bounds: sceneBounds(entries.map(({ part }) => part)),
    results: importedResults(vtkModel),
  };
}

type PrimitiveGroup = keyof typeof PART_IDS;
type PrimitivePart = ReturnType<typeof heterogeneousElementParts>[PrimitiveGroup];

function primitiveEntries(
  parts: ReturnType<typeof heterogeneousElementParts>,
): readonly { readonly group: PrimitiveGroup; readonly part: NonNullable<PrimitivePart> }[] {
  const entries: { group: PrimitiveGroup; part: NonNullable<PrimitivePart> }[] = [];
  for (const group of ["triangle", "line", "point"] as const) {
    const part = parts[group];
    if (part !== undefined) entries.push({ group, part });
  }
  return entries;
}

function importedResults(model: FemModel): ViewportResultsConfig | undefined {
  const scalar = model.results.find((result) => result.components === 1);
  if (scalar === undefined) return undefined;
  const vector = model.results.find(
    (result) => result.location === "node" && result.components === 3,
  );
  return {
    field: createResultFieldFromModelResult(model, scalar, {
      id: "vtk-imported-scalar",
      unit: "source",
      shape: "scalar",
    }),
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

function sceneBounds(parts: readonly Part[]): Bounds {
  const first = parts[0];
  if (first === undefined) throw new Error("VTK scene has no parts");
  return parts.slice(1).reduce((bounds, part) => mergeBounds(bounds, part.bounds), first.bounds);
}

function mergeBounds(left: Bounds, right: Bounds): Bounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    minZ: Math.min(left.minZ, right.minZ),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
    maxZ: Math.max(left.maxZ, right.maxZ),
  };
}
