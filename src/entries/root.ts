/**
 * The canonical femgx workflow: reusable Parts and Assemblies compiled into a
 * Scene, then rendered through FemViewport.
 */
export type {
  Assembly,
  NamedAssembly,
  PartPlacement,
  Placement,
  SubAssemblyPlacement,
} from "../scene/assembly";
export {
  GeometryValidationError,
  type Bounds,
  type ElementPrimitiveRange,
  type ElementTessellation,
  type FaceTessellation,
  type FaceSubset,
  type Geometry,
  type GeometryValidationCode,
  type GeometryBody,
  type GeometryElementBlock,
  type GeometryEdge,
  type LineGeometry,
  type Part,
  type PartId,
  type PointGeometry,
  type Primitive,
  type TriangleGeometry,
} from "../geometry/part";
export { createPart } from "../geometry/part";
export { createScene, type Scene, type SceneBuilder } from "../scene/scene";
export {
  createFemViewport,
  type FemViewport,
  type FemViewportOptions,
  type SceneUpdateOutcome,
  type ViewportBackground,
} from "../viewport/fem-viewport";
export type { CameraTransitionOptions } from "../viewport/types";
export type { OrientationGizmoOptions } from "../viewport/orientation-gizmo";
export type { SectionPlane } from "../math/section-plane";
export type {
  ViewportDeformationConfig,
  ViewportElementVectorConfig,
  ViewportElementVectorState,
  ViewportResultField,
  ViewportScalarConfig,
  ViewportScalarState,
  ViewportResultsConfig,
  ViewportResultsState,
} from "../viewport/results";
export {
  createInteractionState,
  type Color,
  type InteractionState,
  type InteractionTheme,
  type PrimitiveStyleOverride,
  type ResolvedStyle,
  type StyleOverride,
} from "../interaction/interaction";
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
  setTargetsSelected,
  setTargetsHighlighted,
  setTargetSelected,
  interactionTargetFromHit,
  type InteractionTarget,
} from "../interaction/targets";
export {
  emphasizedBodyRefs,
  isBodyEmphasized,
  isBodyVisible,
  setBodyOverride,
  setBodyVisible,
} from "../interaction/bodies";
export {
  emphasizedElementBlockRefs,
  isElementBlockEmphasized,
  isElementBlockVisible,
  setElementBlockHighlighted,
  setElementBlockOverride,
  setElementBlockSelected,
  setElementBlockVisible,
} from "../interaction/blocks";
export { isElementVisible, setElementVisible } from "../interaction/elements";
export type { BodyRef, EdgeRef, ElementBlockRef, FaceRef, NodeRef } from "../interaction/refs";
export {
  installBoxSelection,
  type BoxSelectionCancelReason,
  type BoxSelectionEvent,
  type BoxSelectionModifiers,
  type BoxSelectionOptions,
  type BoxSelectionRect,
} from "../interaction/box-selection";
export {
  boxSelectionFrustum,
  type BoxSelectionFrustum,
  type FrustumPlane,
} from "../interaction/box-frustum";
export type { AssemblyId, AssemblyOccurrenceId, ElementRef, InstanceId } from "../scene/types";
export type {
  EdgePickHit,
  FacePickHit,
  InteractionGranularity,
  NodePickHit,
  PickHit,
} from "../picking/types";
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
} from "../results/fields";
export { finiteRange, scalarRange, type ValueRange } from "../results/range";
export {
  createScalarColorMap,
  mapScalar,
  type ColorStop,
  type ScalarColorMap,
  type ScalarColorMapOptions,
} from "../results/mapping";
export {
  deformGeometry,
  deformPositions,
  nodalDisplacements,
  type DeformationState,
} from "../results/deform";
export {
  identity,
  multiply,
  rotationZ,
  scale,
  transformPoint,
  translation,
  type Mat4,
} from "../math/mat4";
export type { Vec3 } from "../math/vec3";
export {
  queryWebGpuSupport,
  unsupportedMessage,
  WebGpuUnsupportedError,
  type WebGpuAdapterProfile,
  type WebGpuQueryOptions,
  type WebGpuSupportReport,
  type WebGpuSupportStatus,
  type WebGpuUnsupportedReason,
} from "../platform/capabilities";
