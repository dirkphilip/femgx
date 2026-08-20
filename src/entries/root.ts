/**
 * The canonical femgx workflow: reusable Parts and Assemblies compiled into a
 * Scene, then rendered through Viewport.
 */
export type {
  AssemblyDefinition,
  PartPlacement,
  Placement,
  AssemblyPlacement,
} from "../scene/assembly";
export {
  GeometryValidationError,
  type Bounds,
  type ElementPrimitiveRange,
  type ElementTessellation,
  type FaceTessellation,
  type FaceSubset,
  type Geometry,
  type GeometryInput,
  type GeometryValidationCode,
  type GeometryBody,
  type GeometryEdge,
  type LineGeometry,
  type LineGeometryInput,
  type Part,
  type PartId,
  type PointGeometry,
  type PointGeometryInput,
  type Primitive,
  type TriangleGeometry,
  type TriangleGeometryInput,
} from "../geometry/part";
export { createPart, type PartInput } from "../geometry/part";
export { createSceneBuilder, type Scene, type SceneBuilder } from "../scene/scene";
export type { DefinitionRemovalOptions, ExplicitPlacement, SceneUpdate } from "../scene/update";
export {
  createViewport,
  type Viewport,
  type ViewportOptions,
  type SceneUpdateOutcome,
  type ViewportStats,
  type ViewportBackground,
  type ViewportInteraction,
  type ViewportPresentation,
  type ViewportResults,
  type ViewportView,
  type ViewportVisibility,
} from "../viewport/viewport";
export type { CameraTransitionOptions } from "../viewport/types";
export type {
  AssemblyOccurrence,
  PartOccurrence,
  SceneOccurrences,
} from "../scene-runtime/occurrences";
export { UnknownSceneIdentityError } from "../viewport/visibility-error";
export type { OrientationGizmoOptions } from "../viewport/orientation-gizmo";
export type { SectionPlane } from "../math/section-plane";
export type {
  ViewportDeformationConfig,
  ViewportElementFrameConfig,
  ViewportElementVectorConfig,
  ViewportOccurrenceElementVectorConfig,
  ViewportOccurrenceResultsConfig,
  ViewportOccurrenceScalarConfig,
  ViewportOrientationState,
  ViewportLoadConfig,
  ViewportResultField,
  ViewportScalarConfig,
  ViewportScalarState,
  ViewportResultsConfig,
  ViewportResultsState,
} from "../viewport/results";
export type {
  AssemblyId,
  AssemblyOccurrenceId,
  ElementRef,
  PartOccurrenceId,
} from "../scene/types";
export { InteractionGranularity } from "../picking/types";
export type { EdgePickHit, FacePickHit, NodePickHit, PickHit } from "../picking/types";
export {
  identityMatrix,
  multiplyMatrices,
  rotationZMatrix,
  scalingMatrix,
  transformPoint,
  translationMatrix,
  type Mat4,
} from "../math/mat4";
export type { Vec3 } from "../math/vec3";
export {
  queryWebGpuSupport,
  webGpuUnsupportedMessage,
  WebGpuUnsupportedError,
  type WebGpuAdapterProfile,
  type WebGpuQueryOptions,
  type WebGpuSupportReport,
  type WebGpuSupportStatus,
  type WebGpuUnsupportedReason,
} from "../platform/capabilities";
