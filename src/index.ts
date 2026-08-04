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
  type Bounds,
  type ElementTessellation,
  type Geometry,
  type Part,
} from "./geometry/part";
export { createElement, type Element, type ElementId, type NodeId } from "./elements/element";
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
  type ElementShape,
  type ElementTopology,
} from "./elements/shapes";
export {
  classifyFaces,
  facesOf,
  type ClassifiedFace,
  type ElementFace,
  type FaceKey,
} from "./elements/faces";
export { edgesOf, uniqueEdges, type EdgeKey, type ElementEdge } from "./elements/edges";
export { batchInstancesByPart, type InstanceBatch } from "./runtime/batch";
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
export { flattenAssembly, type FlattenOptions } from "./runtime/flatten";
export { compileScene, type CompiledScene } from "./runtime/compile";
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
  type DisplayMode,
  type WebGpuRenderer,
  type WebGpuRendererOptions,
} from "./renderer/gpu-renderer";
export {
  buildSpatialGrid,
  cullChunks,
  type ChunkCell,
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
  partFromChunk,
  type ChunkData,
  type ChunkId,
  type ChunkSource,
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
export { instanceToTarget, resolvePick, resolvePickTarget } from "./picking/pick";
export type {
  AssemblyId,
  ElementRef,
  Instance,
  InstanceId,
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
export { deformGeometry, deformPositions } from "./results/deform";
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
  type ModelSet,
  type ModelSetKind,
  type ResultField,
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
