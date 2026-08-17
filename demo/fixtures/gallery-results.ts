import {
  createElementFrameField,
  createResultField,
  type ElementFrameField,
  type PartId,
  type ScalarField,
  type Scene,
  type ViewportResultsConfig,
} from "../../src/entries/root";

export interface GalleryResults {
  readonly active: ViewportResultsConfig;
  readonly scalarFields: readonly (ScalarField<"nodal"> | ScalarField<"elemental">)[];
  readonly frame: ElementFrameField;
}

/** Builds the static result examples shown by the landing element gallery. */
export function createGalleryResults(scene: Scene, framePartId: PartId): GalleryResults {
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
    values: indexedValues(nodalCount),
  });
  const frame = createGalleryFrame(scene, framePartId);
  return {
    active: {
      scalar: { field: elemental },
      vectors: { field: frame, glyph: "triad", lengthScale: 0.42, widthPixels: 2 },
    },
    scalarFields: [elemental, nodal],
    frame,
  };
}

function createGalleryFrame(scene: Scene, partId: PartId): ElementFrameField {
  const part = scene.parts.get(partId);
  if (part === undefined) throw new Error(`Gallery frame part ${partId} is missing`);
  const count = Math.max(-1, ...(part.elements ?? []).map((element) => element.id)) + 1;
  const values = new Float32Array(count * 9);
  values.fill(Number.NaN);
  for (const element of part.elements ?? []) {
    const angle = element.id * (Math.PI / 12);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    values.set([cosine, sine, 0, -sine, cosine, 0, 0, 0, 1], element.id * 9);
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
