export type {
  Assembly,
  NamedAssembly,
  PartPlacement,
  Placement,
  SubAssemblyPlacement,
} from "./scene/assembly";
export {
  computeBounds,
  validateElements,
  validatePickIds,
  type Bounds,
  type ElementTessellation,
  type FaceId,
  type FaceTessellation,
  type Geometry,
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
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
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
  facesOf,
  facesOfElement,
  type ClassifiedFace,
  type ElementFace,
  type ElementFaceRef,
  type FaceKey,
} from "./elements/faces";
export { edgesOf, uniqueEdges, type EdgeKey, type ElementEdge } from "./elements/edges";
export { faceTriangles } from "./geometry/element-mesh";
export {
  createInteractionState,
  emphasizedElementRefs,
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
export type { FaceRef, NodeRef } from "./interaction/refs";
export { createSceneRuntime, type SceneRuntime } from "./scene-runtime/runtime";
export type { TransformDelta } from "./scene-runtime/transforms";
export type { VisibilityDelta } from "./scene-runtime/visibility";
export {
  cullInstances,
  extractFrustum,
  isSphereVisible,
  type Frustum,
  type FrustumPlane,
} from "./runtime/culling";
export {
  createWebGpuRenderer,
  type WebGpuRenderer,
  type WebGpuRendererOptions,
} from "./renderer/gpu-renderer";
export { WebGpuPickReadbackError } from "./renderer/gpu-pick";
export { changedInstanceSlots } from "./renderer/interaction-diff";
export type { DeformationState } from "./renderer/gpu-deform";
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
  buildSpatialGrid,
  cullChunks,
  detailIndexForDistance,
  type ChunkCell,
  type CullChunksOptions,
  type SpatialGrid,
} from "./streaming/spatial";
export { createChunkStream, type ChunkStream, type ChunkStreamOptions } from "./streaming/stream";
export {
  chunkTransferables,
  parseChunk,
  validateChunkData,
  type ParseChunkOptions,
} from "./streaming/parser";
export {
  chunkDataByteLength,
  isLodChunkSource,
  partFromChunk,
  selectChunkDetail,
  type ChunkData,
  type ChunkId,
  type ChunkSource,
  type LodChunkSource,
  type LodDetail,
  type ParsedChunk,
} from "./streaming/chunk";
export {
  computeLocalOrigin,
  rebaseBounds,
  rebasePositions,
  type RebaseOrigin,
} from "./streaming/rebase";
export {
  createCamera,
  orbitCamera,
  panCamera,
  projectPoint,
  projectionMatrix,
  resizeCamera,
  setProjection,
  viewMatrix,
  viewProjectionMatrix,
  zoomCamera,
  type Camera,
  type ProjectionMode,
  type Vec3,
} from "./camera/camera";
export { projectPolygon, type ScreenPoint } from "./camera/project-polygon";
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
  legend,
  mapScalar,
  type ColorStop,
  type LegendEntry,
  type ScalarColorMap,
  type ScalarColorMapOptions,
} from "./results/mapping";
export { deformGeometry, deformPositions, nodalDisplacements } from "./results/deform";
export {
  advanceCase,
  createCasePlayer,
  sampleDisplacements,
  type CaseLoopMode,
  type CasePlayer,
  type CasePlayerOptions,
} from "./results/case-player";
export {
  createCancellationToken,
  noopProgress,
  OperationCancelledError,
  type CancellationToken,
  type CancellationTokenSource,
  type ProgressReporter,
  type ProgressUpdate,
} from "./io/progress";
export { createModelBuilder, type FemModelBuilder } from "./io/build";
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
export {
  createParseSession,
  finishParse,
  parse,
  parseAbaqus,
  parseGmsh,
  parseVtk,
  parseVtu,
  write,
  writeAbaqus,
  writeGmsh,
  writeVtk,
  writeVtu,
  type IoFormat,
  type ParseOptions,
  type ParseResult,
  type ParseSession,
  type WriteOptions,
} from "./io/parse";
export { validateModel } from "./io/validate";
