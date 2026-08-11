export type {
  Assembly,
  NamedAssembly,
  PartPlacement,
  Placement,
  SubAssemblyPlacement,
} from "./scene/assembly";
export {
  bodyIdForElement,
  computeBounds,
  GeometryValidationError,
  validateBodies,
  validateElements,
  validateFaceSubset,
  validatePickIds,
  type Bounds,
  type Body,
  type BodyId,
  type ElementTessellation,
  type FaceId,
  type FaceTessellation,
  type FaceSubset,
  type Geometry,
  type GeometryValidationCode,
  type Part,
  type Primitive,
} from "./geometry/part";
export { createElement, type Element, type ElementId, type NodeId } from "./elements/element";
export { createElementModel, type ElementModel } from "./elements/model";
export {
  elementGeometry,
  elementPart,
  elementRenderModes,
  type ElementRenderMode,
  type TessellationOptions,
} from "./geometry/element-mesh";
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
  setElementSelected,
  setHoveredElement,
  setHoveredInstance,
  setInstanceHighlighted,
  setInstanceOverride,
  setInstanceSelected,
  setPartHighlighted,
  setPartOverride,
  setPartSelected,
  type Color,
  type InteractionState,
  type InteractionTheme,
  type ResolvedStyle,
  type StyleOverride,
} from "./interaction/interaction";
export {
  emphasizedBodyRefs,
  isBodyEmphasized,
  isBodyVisible,
  setBodyHighlighted,
  setBodyOverride,
  setBodySelected,
  setBodyVisible,
  setHoveredBody,
} from "./interaction/bodies";
export {
  setFaceHighlighted,
  setFaceSelected,
  setHoveredFace,
  emphasizedFaceRefs,
  isFaceEmphasized,
  resolveFaceStyle,
} from "./interaction/faces";
export {
  setNodeHighlighted,
  setNodeSelected,
  setHoveredNode,
  emphasizedNodeRefs,
  isNodeEmphasized,
  resolveNodeStyle,
} from "./interaction/nodes";
export type { BodyRef, FaceRef, NodeRef } from "./interaction/refs";
export { createSceneRuntime, type SceneRuntime } from "./scene-runtime/runtime";
export {
  createWebGpuRenderer,
  type WebGpuRenderer,
  type WebGpuRendererOptions,
} from "./renderer/gpu-renderer";
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
  type Vec3,
} from "./camera/camera";
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
export {
  instanceToTarget,
  resolvePick,
  resolvePickTarget,
  type PickContext,
  type PickGranularity,
  type ResolvedPickIds,
} from "./picking/pick";
export type {
  AssemblyId,
  ElementRef,
  FacePickTarget,
  Instance,
  InstanceId,
  NodePickTarget,
  PartId,
  PickTarget,
} from "./scene/types";
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
export { deformGeometry, deformPositions, nodalDisplacements } from "./results/deform";
export {
  IoError,
  type Issue,
  type IssueCode,
  type IssueSeverity,
  type SourcePosition,
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
export {
  createParseSession,
  finishParse,
  parse,
  parseVtk,
  write,
  writeVtk,
  type IoFormat,
  type ParseOptions,
  type ParseResult,
  type ParseSession,
} from "./io/parse";
export { validateModel } from "./io/validate";
