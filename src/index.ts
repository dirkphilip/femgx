export type {
  Assembly,
  NamedAssembly,
  PartPlacement,
  Placement,
  SubAssemblyPlacement,
} from "./scene/assembly";
export {
  GeometryValidationError,
  type Bounds,
  type Body,
  type BodyId,
  type ElementTessellation,
  type FaceId,
  type FaceTessellation,
  type FaceSubset,
  type Geometry,
  type GeometryValidationCode,
  type LineGeometry,
  type Part,
  type PartId,
  type PointGeometry,
  type Primitive,
  type TriangleGeometry,
} from "./geometry/part";
export { createPart } from "./geometry/part";
export { createElement, type Element, type ElementId, type NodeId } from "./elements/element";
export { createElementModel, type ElementModel } from "./elements/model";
export {
  heterogeneousElementParts,
  HeterogeneousElementError,
  type HeterogeneousElementErrorCode,
  type HeterogeneousElementPartIds,
  type HeterogeneousElementPartSet,
  type TessellationOptions,
} from "./geometry/heterogeneous-element-mesh";
export {
  polygonGeometry,
  polygonPart,
  PolygonGeometryError,
  type PolygonFaceInput,
  type PolygonGeometryInput,
  type PolygonValidationCode,
} from "./geometry/polygon";
export {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  topologyFor,
  type ElementFamily,
  type ElementOrder,
  type ElementShape,
  type ElementTopology,
} from "./elements/shapes";
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
} from "./elements/faces";
export { edgesOf, uniqueEdges, type EdgeKey, type ElementEdge } from "./elements/edges";
export {
  createInteractionState,
  emphasizedElementRefs,
  resolveBodyStyle,
  resolveElementStyle,
  resolveInstanceStyle,
  setElementOverride,
  setInstanceOverride,
  setPartOverride,
  type Color,
  type InteractionState,
  type InteractionTheme,
  type PrimitiveStyleOverride,
  type ResolvedStyle,
  type StyleOverride,
} from "./interaction/interaction";
export {
  clearSelection,
  bodyOverride,
  hoveredTarget,
  isHoveredTarget,
  isTargetHighlighted,
  isTargetSelected,
  selectedTargets,
  setTargetHighlighted,
  setTargetHovered,
  setTargetsHighlighted,
  setTargetSelected,
  interactionTargetFromHit,
  type InteractionTarget,
} from "./interaction/targets";
export {
  emphasizedBodyRefs,
  isBodyEmphasized,
  isBodyVisible,
  setBodyOverride,
  setBodyVisible,
} from "./interaction/bodies";
export { emphasizedFaceRefs, isFaceEmphasized, resolveFaceStyle } from "./interaction/faces";
export { emphasizedNodeRefs, isNodeEmphasized, resolveNodeStyle } from "./interaction/nodes";
export type { BodyRef, FaceRef, NodeRef } from "./interaction/refs";
export {
  installBoxSelection,
  type BoxSelectionCancelReason,
  type BoxSelectionEvent,
  type BoxSelectionModifiers,
  type BoxSelectionOptions,
  type BoxSelectionRect,
} from "./interaction/box-selection";
export {
  boxSelectionFrustum,
  type BoxSelectionFrustum,
  type FrustumPlane,
} from "./interaction/box-frustum";
export {
  createSceneRuntime,
  type RuntimeInstance,
  type RuntimeNode,
  type SceneRuntime,
} from "./scene-runtime/public-runtime";
export { WebGpuPickReadbackError } from "./renderer/gpu-pick";
export {
  queryWebGpuSupport,
  requestWebGpuAdapter,
  unsupportedMessage,
  WebGpuUnsupportedError,
  type WebGpuAdapterProfile,
  type WebGpuQueryOptions,
  type WebGpuSupportReport,
  type WebGpuSupportStatus,
  type WebGpuUnsupportedReason,
} from "./platform/capabilities";
export {
  requestWebGpuDevice,
  type DeviceLostInfo,
  type RequestedWebGpuDevice,
} from "./platform/device";
export {
  createCamera,
  orbitCamera,
  panCamera,
  projectPoint,
  unprojectPoint,
  projectionMatrix,
  resizeCamera,
  setProjection,
  viewMatrix,
  viewProjectionMatrix,
  zoomCamera,
  zoomCameraAtPoint,
  type Camera,
  type ProjectionMode,
} from "./camera/camera";
export type { Vec3 } from "./math/vec3";
export {
  canvasCssToRenderPixel,
  clientToCanvasCss,
  type CanvasCssPoint,
  type RenderPixel,
} from "./camera/coordinates";
export { projectPolygon, type ScreenPoint } from "./camera/project-polygon";
export { fitCamera } from "./camera/fit";
export {
  installCameraControls,
  type CameraControlOptions,
  type CameraNavigationTarget,
  type CameraRef,
} from "./camera/controls";
export {
  createFemViewport,
  type FemViewport,
  type FemViewportOptions,
} from "./viewport/fem-viewport";
export type { OrientationGizmoOptions } from "./viewport/orientation-gizmo";
export type {
  ViewportDeformationConfig,
  ViewportResultDerivation,
  ViewportResultField,
  ViewportResultsConfig,
  ViewportResultsState,
} from "./viewport/results";
export { createScene, type Scene, type SceneBuilder } from "./scene/scene";
export {
  identity,
  multiply,
  rotationZ,
  scale,
  transformPoint,
  translation,
  type Mat4,
} from "./math/mat4";
export type { AssemblyId, AssemblyNodeId, ElementRef, Instance, InstanceId } from "./scene/types";
export type { FacePickHit, InteractionGranularity, NodePickHit, PickHit } from "./picking/types";
export {
  FIELD_COMPONENT_COUNT,
  TENSOR_COMPONENT,
  createResultField,
  scalarAt,
  tensorAt,
  vectorAt,
  type AnyResultField,
  type FieldLocation,
  type FieldShape,
  type ResultField,
  type ResultFieldOptions,
  type ScalarField,
  type Tensor6,
  type TensorField,
  type VectorField,
} from "./results/fields";
export { finiteRange, scalarRange, type ValueRange } from "./results/range";
export {
  magnitude,
  magnitudeField,
  magnitudes,
  maxPrincipalField,
  principalValues,
  principals,
  tensorMagnitude,
  vonMises,
  vonMisesField,
  vonMisesValues,
} from "./results/derived";
export {
  createScalarColorMap,
  mapScalar,
  type ColorStop,
  type ScalarColorMap,
  type ScalarColorMapOptions,
} from "./results/mapping";
export {
  deformGeometry,
  deformPositions,
  nodalDisplacements,
  type DeformationState,
} from "./results/deform";
export {
  IoError,
  type Issue,
  type IssueCode,
  type IssueSeverity,
  type SourcePosition,
  VtkWriteError,
  type VtkWriteErrorCode,
} from "./io/diagnostics";
export {
  FEMGX_FORMAT_VERSION,
  type FemModel,
  type MetadataValue,
  type ModelElementBlock,
  type ModelMetadata,
  type ModelNodes,
  type ModelResultField,
  type ModelSet,
  type ModelSetKind,
} from "./io/model";
export { createModelBuilder, type FemModelBuilder } from "./io/build";
export { createElementModelFromFemModel } from "./io/element-model";
export { parseVtk, writeVtk, type ParseOptions, type ParseResult } from "./io/parse";
export { validateModel } from "./io/validate";
