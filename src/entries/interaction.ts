/** Interaction state, target mapping, and host-owned selection gestures. */
export {
  createInteractionState,
  setPartOverride,
  setPartOverrides,
  setPartOccurrenceOverride,
  setPartOccurrenceOverrides,
  type Color,
  type InteractionState,
  type InteractionTheme,
  type PrimitiveStyleOverride,
  type ResolvedStyle,
  type StyleOverride,
} from "../interaction/interaction";
export {
  createElementRegionSelection,
  clearSelection,
  bodyOverride,
  hoveredTarget,
  isHoveredTarget,
  isTargetHighlighted,
  isTargetSelected,
  selectedTargets,
  selectedElementRegion,
  setTargetHighlighted,
  setTargetHovered,
  setTargetsSelected,
  setElementRegionSelected,
  setTargetsHighlighted,
  setTargetSelected,
  interactionTargetFromHit,
  type InteractionTarget,
  type InteractionTargetFor,
  type ElementRegionSelection,
} from "../interaction/targets";
export {
  emphasizedBodyRefs,
  isBodyEmphasized,
  isBodyVisible,
  setBodyOverride,
  setBodyVisible,
} from "../interaction/bodies";
export { isElementVisible, setElementVisible } from "../interaction/elements";
export type { BodyRef, EdgeRef, FaceRef, NodeRef } from "../interaction/refs";
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
export {
  installViewportInteraction,
  type ViewportInteractionApplyRequest,
  type ViewportInteractionApplyResult,
  type ViewportInteractionBoxEvent,
  type ViewportInteractionBoxSelection,
  type ViewportInteractionModifiers,
  type ViewportInteractionOptions,
  type ViewportInteractionPhase,
  type ViewportInteractionTouchMode,
} from "../interaction/viewport-interaction";
