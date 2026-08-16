/** Internal repository barrel composed from the supported package facades. */
export * from "./entries/root";
export * from "./entries/model";
export * from "./entries/io";
export * from "./entries/io-glb";
export * from "./entries/camera";
export * from "./entries/runtime";
export * from "./entries/platform";

export {
  emphasizedElementRefs,
  resolveBodyStyle,
  resolveElementBlockStyle,
  resolveElementStyle,
  resolveInstanceStyle,
  setElementOverride,
  setInstanceOverride,
} from "./interaction/interaction";
export { emphasizedFaceRefs, resolveFaceStyle } from "./interaction/faces";
export { emphasizedEdgeRefs, resolveEdgeStyle } from "./interaction/edges";
export { emphasizedNodeRefs, resolveNodeStyle } from "./interaction/nodes";
export { WebGpuPickReadbackError } from "./renderer/picking/gpu-pick";
export {
  selectedTargetCount,
  selectedTargetSummary,
  type SelectedTargetSummary,
} from "./interaction/selection-queries";
