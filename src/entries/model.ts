/** Finite-element authoring, topology, and model editing. */
export { createElement, type Element, type ElementId, type NodeId } from "../elements/element";
export {
  createElementModel,
  type Body,
  type BodyId,
  type ElementModel,
  type ElementModelOptions,
  ElementModelValidationError,
  type ElementModelValidationCode,
} from "../elements/model";
export {
  createPartFromElementModel,
  type CreatePartFromElementModelOptions,
} from "../geometry/element-model-part";
export {
  createPartFromExplicitTopology,
  ExplicitTopologyError,
  type ExplicitTopologyInput,
  type ExplicitTopologyValidationCode,
} from "../geometry/explicit-topology/part";
export {
  ElementShape,
  topologyFor,
  type ElementFamily,
  type ElementOrder,
  type ElementTopology,
} from "../elements/shapes";
export {
  classifyFaces,
  boundaryFaceRefs,
  FaceSelectionError,
  facesOf,
  faceRefsOf,
  type ClassifiedFace,
  type ElementFace,
  type ElementFaceRef,
  type FaceIdRef,
  type FaceKey,
  type FaceSelectionErrorCode,
} from "../elements/faces";
export { edgesOf, uniqueEdges, type EdgeKey, type ElementEdge } from "../elements/edges";
