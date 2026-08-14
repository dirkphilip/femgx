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
  type ElementTessellation,
  type FaceTessellation,
  type FaceSubset,
  type Geometry,
  type GeometryValidationCode,
  type GeometryBody,
  type GeometryElementBlock,
  type LineGeometry,
  type Part,
  type PartId,
  type PointGeometry,
  type Primitive,
  type TriangleGeometry,
} from "./geometry/part";
export { createPart } from "./geometry/part";
export { createElement, type Element, type ElementId, type NodeId } from "./elements/element";
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
} from "./elements/model";
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
  PYRAMID5_SHAPE,
  QUAD8_SHAPE,
  QUAD_SHAPE,
  TRI6_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  WEDGE6_SHAPE,
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
export { isElementVisible, setElementVisible } from "./interaction/elements";
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
export { fitCamera, type CameraContentInset } from "./camera/fit";
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
  type ViewportBackground,
} from "./viewport/fem-viewport";
export type { SectionPlane } from "./viewport/section-plane";
export type { CameraTransitionOptions } from "./viewport/types";
export type { OrientationGizmoOptions } from "./viewport/orientation-gizmo";
export type {
  ViewportDeformationConfig,
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
  createResultField,
  scalarAt,
  vectorAt,
  type AnyResultField,
  type FieldLocation,
  type FieldShape,
  type ResultField,
  type ResultFieldOptions,
  type ScalarField,
  type VectorField,
} from "./results/fields";
export { finiteRange, scalarRange, type ValueRange } from "./results/range";
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
  type ModelElementShapeBlock,
  type ModelMetadata,
  type ModelNodes,
  type ModelResultField,
  type ModelSet,
  type ModelSetKind,
} from "./io/model";
export { createModelBuilder, type FemModelBuilder } from "./io/build";
export { createElementModelFromFemModel } from "./io/element-model";
export {
  createResultFieldFromModelResult,
  type ModelResultFieldConversionOptions,
} from "./io/result-field";
export { importGlb } from "./io/glb";
export type { GlbImportOptions, GlbIssueCode, GlbSceneImport } from "./io/glb-types";
export { parseVtk } from "./io/vtk";
export { writeVtk } from "./io/vtk-write";
export type { ParseOptions, ParseResult } from "./io/session";
export { validateModel } from "./io/validate";
