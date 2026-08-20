import { ElementShape } from "../../elements/shapes";
import type { ElementModel } from "../../elements/model";
import {
  elementModelStorage,
  elementShapeForCode,
  ordinalForId,
  sortedOrdinals,
} from "../../elements/model-storage";
import type { ElementTessellation, GeometryBody, GeometryInput } from "../types";
import type { ElementSemanticFragment, PartElementColumns } from "./direct-element-columns";
import { resolveDirectEdgeColumns, type DirectEdgeSources } from "./direct-edge-columns";
import { resolveDirectFaceColumns, type DirectFaceSources } from "./direct-face-columns";
import { buildEdgeColumns, type EdgeColumns } from "./edge-columns";
import { buildFaceColumns, type FaceColumns } from "./face-columns";
import { geometryFaceSubsetColumns } from "./face-subset-columns";
import { primitiveCode, type PartSemanticGraph } from "./part-semantic-graph";
import { modelBodyColumns, type PartBodyColumns } from "./model-body-columns";
import { assemblePartSemanticGraph } from "./graph-assembly";
export {
  buildPartElementColumnsFromFragments,
  type ElementSemanticFragment,
  type PartElementColumns,
} from "./direct-element-columns";

const SHAPES = Object.values(ElementShape);

/** Direct compiler columns that replace transient geometry semantic descriptors. */
export interface PartSemanticFragments {
  readonly elements: readonly ElementSemanticFragment[];
  readonly faces?: FaceColumns;
  readonly faceSources?: DirectFaceSources;
  readonly edges?: EdgeColumns;
  readonly edgeSources?: DirectEdgeSources;
  readonly faceSubset?: {
    readonly offsets: Uint32Array;
    readonly ordinals: Uint32Array;
    readonly defined: Uint8Array;
  };
}

/** Packs transient Part authoring descriptors into the canonical semantic graph. */
export function buildPartSemanticGraph(
  geometries: readonly GeometryInput[],
  elements: readonly ElementTessellation[],
  bodies: readonly GeometryBody[] | undefined,
): PartSemanticGraph {
  const elementColumns = buildElementColumns(geometries, elements);
  const bodyColumns = buildBodyColumns(
    bodies,
    elementColumns.elementIds,
    elementColumns.elementIdOrdinals,
  );
  const faceColumns = buildFaceColumns(
    geometries,
    elementColumns.elementIds,
    elementColumns.elementIdOrdinals,
  );
  const edgeColumns = buildEdgeColumns(
    geometries,
    elementColumns.elementIds,
    elementColumns.elementIdOrdinals,
  );
  return assemblePartSemanticGraph({
    geometryCount: geometries.length,
    elements: elementColumns,
    bodies: bodyColumns,
    faces: faceColumns,
    edges: edgeColumns,
    faceSubset: {
      ...geometryFaceSubsetColumns(
        geometries,
        faceColumns,
        elementColumns.elementIds,
        elementColumns.elementIdOrdinals,
      ),
    },
  });
}

/** Packs direct model compiler fragments without materializing element descriptors. */
export function buildPartSemanticGraphFromFragments(
  geometries: readonly GeometryInput[],
  model: ElementModel,
  fragments: readonly ElementSemanticFragment[],
  direct: Omit<PartSemanticFragments, "elements"> = {},
): PartSemanticGraph {
  const elementColumns = buildElementColumnsFromFragments(geometries, model, fragments);
  return buildPartSemanticGraphFromColumns(
    geometries,
    elementColumns,
    undefined,
    direct,
    modelBodyColumns(model),
  );
}

/** Assembles direct compiler columns without materializing semantic descriptors. */
export function buildPartSemanticGraphFromColumns(
  geometries: readonly GeometryInput[],
  elementColumns: PartElementColumns,
  bodies: readonly GeometryBody[] | undefined,
  direct: Omit<PartSemanticFragments, "elements"> = {},
  inheritedBodies?: PartBodyColumns,
): PartSemanticGraph {
  const bodyColumns =
    inheritedBodies ??
    buildBodyColumns(bodies, elementColumns.elementIds, elementColumns.elementIdOrdinals);
  const faceColumns =
    direct.faces ??
    (direct.faceSources === undefined
      ? undefined
      : resolveDirectFaceColumns(
          direct.faceSources,
          elementColumns.elementIds,
          elementColumns.elementIdOrdinals,
        )) ??
    buildFaceColumns(geometries, elementColumns.elementIds, elementColumns.elementIdOrdinals);
  const edgeColumns =
    direct.edges ??
    (direct.edgeSources === undefined
      ? undefined
      : resolveDirectEdgeColumns(
          direct.edgeSources,
          elementColumns.elementIds,
          elementColumns.elementIdOrdinals,
        )) ??
    buildEdgeColumns(geometries, elementColumns.elementIds, elementColumns.elementIdOrdinals);
  return assemblePartSemanticGraph({
    geometryCount: geometries.length,
    elements: elementColumns,
    bodies: bodyColumns,
    faces: faceColumns,
    edges: edgeColumns,
    faceSubset: {
      ...(direct.faceSubset ??
        geometryFaceSubsetColumns(
          geometries,
          faceColumns,
          elementColumns.elementIds,
          elementColumns.elementIdOrdinals,
        )),
    },
  });
}

function buildElementColumnsFromFragments(
  geometries: readonly GeometryInput[],
  model: ElementModel,
  fragments: readonly ElementSemanticFragment[],
): PartElementColumns {
  const count = model.elementIds.length;
  const elementIds = new Uint32Array(model.elementIds);
  const storage = elementModelStorage(model);
  const elementShapeCodes = new Uint8Array(count);
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    elementShapeCodes[ordinal] = shapeCode(elementShapeForCode(storage.shapeCodes[ordinal] ?? 0));
  }
  // A bodyless model carries no per-element ownership column. Indexing the
  // shared empty sentinel resolves to the same absent (`0`) body semantics.
  const elementBodyIds = model.elementBodyIds ?? EMPTY_BODY_IDS;
  const elementRangeOffsets = new Uint32Array(count + 1);
  const elementRangeGeometryOrdinals = new Uint8Array(count);
  const elementRangePrimitiveCodes = new Uint8Array(count);
  const elementRangeStarts = new Uint32Array(count);
  const elementRangeCounts = new Uint32Array(count);
  const assigned = new Uint8Array(count);
  const ordinals = sortedOrdinals(elementIds, "Part element");
  for (const fragment of fragments) {
    const geometry = geometryOrdinal(geometries, fragment.primitive);
    for (let index = 0; index < fragment.elementIds.length; index += 1) {
      const id = fragment.elementIds[index];
      const ordinal = id === undefined ? undefined : ordinalForId(elementIds, ordinals, id);
      if (ordinal === undefined || assigned[ordinal] === 1) {
        throw new Error(`Direct compiler has invalid or duplicate element range for ${String(id)}`);
      }
      assigned[ordinal] = 1;
      elementRangeGeometryOrdinals[ordinal] = geometry;
      elementRangePrimitiveCodes[ordinal] = primitiveCode(fragment.primitive);
      elementRangeStarts[ordinal] = fragment.primitiveStarts[index] ?? 0;
      elementRangeCounts[ordinal] = fragment.primitiveCounts[index] ?? 0;
    }
  }
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    if (assigned[ordinal] !== 1)
      throw new Error(`Direct compiler omitted element ${elementIds[ordinal]}`);
    elementRangeOffsets[ordinal + 1] = ordinal + 1;
  }
  return {
    elementIds,
    elementIdOrdinals: ordinals,
    elementShapeCodes,
    elementBodyIds,
    elementRangeOffsets,
    elementRangeGeometryOrdinals,
    elementRangePrimitiveCodes,
    elementRangeStarts,
    elementRangeCounts,
  };
}

const EMPTY_BODY_IDS = new Uint32Array(0);

function buildElementColumns(
  geometries: readonly GeometryInput[],
  elements: readonly ElementTessellation[],
): PartElementColumns {
  let rangeCount = 0;
  let hasBodies = false;
  for (const element of elements) {
    rangeCount += element.primitiveRanges.length;
    hasBodies ||= element.bodyId !== undefined;
  }
  const elementIds = new Uint32Array(elements.length);
  const elementShapeCodes = new Uint8Array(elements.length);
  const elementBodyIds = hasBodies ? new Uint32Array(elements.length) : EMPTY_BODY_IDS;
  const elementRangeOffsets = new Uint32Array(elements.length + 1);
  const elementRangeGeometryOrdinals = new Uint8Array(rangeCount);
  const elementRangePrimitiveCodes = new Uint8Array(rangeCount);
  const elementRangeStarts = new Uint32Array(rangeCount);
  const elementRangeCounts = new Uint32Array(rangeCount);
  let range = 0;
  for (let ordinal = 0; ordinal < elements.length; ordinal += 1) {
    const element = elements[ordinal];
    if (element === undefined) throw new Error(`Part has no element ${ordinal}`);
    elementIds[ordinal] = element.id;
    elementShapeCodes[ordinal] = shapeCode(element.shape);
    if (hasBodies) elementBodyIds[ordinal] = element.bodyId ?? 0;
    for (const descriptor of element.primitiveRanges) {
      elementRangeGeometryOrdinals[range] = geometryOrdinal(geometries, descriptor.primitive);
      elementRangePrimitiveCodes[range] = primitiveCode(descriptor.primitive);
      elementRangeStarts[range] = descriptor.primitiveStart;
      elementRangeCounts[range] = descriptor.primitiveCount;
      range += 1;
    }
    elementRangeOffsets[ordinal + 1] = range;
  }
  return {
    elementIds,
    elementIdOrdinals: sortedOrdinals(elementIds, "Part element"),
    elementShapeCodes,
    elementBodyIds,
    elementRangeOffsets,
    elementRangeGeometryOrdinals,
    elementRangePrimitiveCodes,
    elementRangeStarts,
    elementRangeCounts,
  };
}

function buildBodyColumns(
  bodies: readonly GeometryBody[] | undefined,
  elementIds: Uint32Array,
  elementIdOrdinals: Uint32Array,
): PartBodyColumns {
  const count = bodies?.length ?? 0;
  let textLength = 0;
  let membershipCount = 0;
  for (const body of bodies ?? []) {
    textLength += body.name?.length ?? 0;
    membershipCount += body.elementIds.length;
  }
  const bodyIds = new Uint32Array(count);
  const bodyNameDefined = new Uint8Array(count);
  const bodyNameOffsets = new Uint32Array(count + 1);
  const bodyNameText = new Uint16Array(textLength);
  const bodyElementOffsets = new Uint32Array(count + 1);
  const bodyElementOrdinals = new Uint32Array(membershipCount);
  let text = 0;
  let membership = 0;
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const body = bodies?.[ordinal];
    if (body === undefined) throw new Error(`Part has no body ${ordinal}`);
    bodyIds[ordinal] = body.id;
    bodyNameDefined[ordinal] = body.name === undefined ? 0 : 1;
    bodyNameOffsets[ordinal] = text;
    for (let index = 0; index < (body.name?.length ?? 0); index += 1) {
      bodyNameText[text + index] = body.name?.charCodeAt(index) ?? 0;
    }
    text += body.name?.length ?? 0;
    bodyElementOffsets[ordinal] = membership;
    for (const id of body.elementIds) {
      const elementOrdinal = ordinalForId(elementIds, elementIdOrdinals, id);
      if (elementOrdinal === undefined)
        throw new Error(`Body ${body.id} references unknown element ${id}`);
      bodyElementOrdinals[membership] = elementOrdinal;
      membership += 1;
    }
  }
  bodyNameOffsets[count] = text;
  bodyElementOffsets[count] = membership;
  return {
    bodyIds,
    bodyIdOrdinals: sortedOrdinals(bodyIds, "Part body"),
    bodyNameDefined,
    bodyNameOffsets,
    bodyNameText,
    bodyElementOffsets,
    bodyElementOrdinals,
  };
}

function geometryOrdinal(
  geometries: readonly GeometryInput[],
  primitive: GeometryInput["primitive"],
): number {
  for (let ordinal = 0; ordinal < geometries.length; ordinal += 1) {
    if (geometries[ordinal]?.primitive === primitive) return ordinal;
  }
  throw new Error(`Part has no ${primitive} geometry`);
}

function shapeCode(shape: ElementTessellation["shape"]): number {
  if (shape === undefined) return 0;
  const code = SHAPES.indexOf(shape);
  if (code < 0) throw new Error(`Unsupported element shape ${shape}`);
  return code + 1;
}
