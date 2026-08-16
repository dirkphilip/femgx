/** Finite-element authoring, topology, and model editing. */
export { createElement, type Element, type ElementId, type NodeId } from "../elements/element";
export {
  createElementModel,
  type Body,
  type BodyId,
  type ElementBlock,
  type ElementBlockId,
  type ElementModel,
  type ElementModelOptions,
  ElementModelValidationError,
  type ElementModelValidationCode,
} from "../elements/model";
export {
  editElementModel,
  ElementModelEditError,
  type DissolveBlockBodyPolicy,
  type DissolveElementBlockOptions,
  type ElementBlockReplacement,
  type ElementModelEditCode,
  type ElementModelEditReport,
  type ElementModelEditResult,
  type ElementModelEditor,
  type MergeElementBlocksInput,
} from "../elements/model-edit";
export { elementPart, type TessellationOptions } from "../geometry/element-part";
export {
  surfacePart,
  SurfacePartError,
  type SurfacePartInput,
  type SurfacePartValidationCode,
} from "../geometry/surface-part";
export {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  PYRAMID5_SHAPE,
  QUAD8_SHAPE,
  QUAD_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  TRI6_SHAPE,
  TRIANGLE_SHAPE,
  WEDGE6_SHAPE,
  topologyFor,
  type ElementFamily,
  type ElementOrder,
  type ElementShape,
  type ElementTopology,
} from "../elements/shapes";
export {
  classifyFaces,
  boundaryFaceRefs,
  FaceSelectionError,
  facesOf,
  facesOfElement,
  type ClassifiedFace,
  type ElementFace,
  type ElementFaceRef,
  type FaceIdRef,
  type FaceKey,
  type FaceSelectionErrorCode,
} from "../elements/faces";
export { edgesOf, uniqueEdges, type EdgeKey, type ElementEdge } from "../elements/edges";
