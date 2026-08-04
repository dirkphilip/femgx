export type {
  Assembly,
  NamedAssembly,
  PartPlacement,
  Placement,
  SubAssemblyPlacement,
} from "./scene/assembly";
export { computeBounds, type Bounds, type Geometry, type Part } from "./geometry/part";
export { batchInstancesByPart, type InstanceBatch } from "./runtime/batch";
export {
  createInteractionState,
  resolveInstanceStyle,
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
  type WebGpuRenderer,
  type WebGpuRendererOptions,
} from "./renderer/gpu-renderer";
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
export { instanceToTarget, resolvePick } from "./picking/pick";
export type { AssemblyId, Instance, InstanceId, PartId, PickTarget } from "./scene/types";
