import {
  type PartId,
  type Scene,
  type ViewportLoadConfig,
  type ViewportResultsConfig,
} from "../../src/entries/root";
import {
  createElementFrameField,
  createNodalLoadField,
  createResultField,
  type ElementFrameField,
  type ScalarField,
  type VectorField,
} from "../../src/entries/results";

export interface GalleryResults {
  readonly active: ViewportResultsConfig;
  readonly scalarFields: readonly (ScalarField<"nodal"> | ScalarField<"elemental">)[];
  readonly frame: ElementFrameField;
  readonly vectorFields: readonly VectorField<"elemental">[];
  readonly loads: ViewportLoadConfig;
}

/** Builds the static result examples shown by the landing element gallery. */
export function createGalleryResults(
  scene: Scene,
  framePartId: PartId,
  loadPartId: PartId,
): GalleryResults {
  const elementalCount = elementCount(scene);
  const nodalCount = nodeCount(scene);
  const elemental = createResultField({
    id: "gallery-element-colors",
    name: "Different color per element",
    location: "elemental",
    shape: "scalar",
    count: elementalCount,
    unit: "index",
    values: indexedValues(elementalCount),
  });
  const nodal = createResultField({
    id: "gallery-nodal-interpolation",
    name: "Nodal interpolation",
    location: "nodal",
    shape: "scalar",
    count: nodalCount,
    unit: "unitless",
    values: alternatingValues(nodalCount),
  });
  const shellThickness = createResultField({
    id: "gallery-shell-thickness",
    name: "Shell thickness",
    location: "elemental",
    shape: "scalar",
    count: elementalCount,
    unit: "mm",
    values: thicknessValues(elementalCount),
  });
  const frame = createGalleryFrame(scene, framePartId);
  const vectorFields = [
    createGalleryVector(
      "gallery-shell-normals",
      "Shell normals · authored outward",
      elementalCount,
      [0, 0, 1],
    ),
    createGalleryVector(
      "gallery-fibre-axis",
      "Fibre orientation · authored axis",
      elementalCount,
      [1, 0.35, 0],
    ),
  ];
  const loads = createGalleryLoads(scene, loadPartId);
  return {
    active: {
      scalar: { field: elemental },
      orientation: { field: frame, glyph: "triad", lengthScale: 0.42, widthPixels: 2 },
      loads,
    },
    scalarFields: [elemental, nodal, shellThickness],
    frame,
    vectorFields,
    loads,
  };
}

function createGalleryFrame(scene: Scene, partId: PartId): ElementFrameField {
  const part = scene.parts.get(partId);
  if (part === undefined) throw new Error(`Gallery frame part ${partId} is missing`);
  const count = Math.max(-1, ...(part.elements ?? []).map((element) => element.id)) + 1;
  const values = new Float32Array(count * 9);
  values.fill(Number.NaN);
  for (const element of part.elements ?? []) {
    values.set([1, 0, 0, 0, 1, 0, 0, 0, 1], element.id * 9);
  }
  return createElementFrameField({
    partId,
    id: "gallery-element-frames",
    name: "Element orientation · RGB X/Y/Z",
    count,
    unit: "unitless",
    values,
  });
}

function createGalleryVector(
  id: string,
  name: string,
  count: number,
  direction: readonly [number, number, number],
): VectorField<"elemental"> {
  const values = new Float32Array(count * 3);
  values.fill(Number.NaN);
  for (let element = 0; element < count; element += 1) values.set(direction, element * 3);
  return createResultField({
    id,
    name,
    location: "elemental",
    shape: "vector",
    count,
    unit: "unitless",
    values,
  });
}

function createGalleryLoads(scene: Scene, partId: PartId): ViewportLoadConfig {
  const part = scene.parts.get(partId);
  const count = part?.nodePositions === undefined ? 0 : part.nodePositions.length / 3;
  const values = new Float32Array(count * 6);
  values.fill(Number.NaN);
  if (count > 0) values.set([0.8, 0.45, 0.25, 0.2, 0.35, 0.7], 0);
  return {
    field: createNodalLoadField({
      partId,
      id: "gallery-nodal-loads",
      name: "Control-node force + moment",
      count,
      forceUnit: "N",
      momentUnit: "N·m",
      values,
    }),
    forceLengthScale: 1.1,
    momentLengthScale: 0.65,
    widthPixels: 3,
  };
}

function elementCount(scene: Scene): number {
  let maximum = -1;
  for (const part of scene.parts.values()) {
    for (const element of part.elements ?? []) maximum = Math.max(maximum, element.id);
  }
  return maximum + 1;
}

function nodeCount(scene: Scene): number {
  let maximum = 0;
  for (const part of scene.parts.values()) {
    for (const geometry of part.geometries) {
      for (const pickId of geometry.nodePickIds ?? []) maximum = Math.max(maximum, pickId);
    }
  }
  return maximum;
}

function indexedValues(count: number): Float32Array {
  return Float32Array.from({ length: count }, (_, index) => (count <= 1 ? 0 : index / (count - 1)));
}

function alternatingValues(count: number): Float32Array {
  return Float32Array.from({ length: count }, (_, index) => index % 2);
}

function thicknessValues(count: number): Float32Array {
  return Float32Array.from({ length: count }, (_, index) => 0.2 + (index % 5) / 10);
}
