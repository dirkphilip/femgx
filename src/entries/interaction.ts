/** Interaction state, target mapping, and host-owned selection gestures. */
export {
  createInteractionState,
  setAssemblyHighlighted,
  setAssemblyOccurrenceHighlighted,
  setAssemblyOccurrenceSelected,
  setAssemblySelected,
  setPartOverride,
  setPartOverrides,
  setPartOccurrenceOverride,
  setPartOccurrenceOverrides,
  type Color,
  type InteractionState,
  type InteractionTheme,
  type PrimitiveStyleOverride,
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
export { emphasizedBodyRefs, isBodyEmphasized, setBodyOverride } from "../interaction/bodies";
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
  type ViewportInteractionElementBoxSelection,
  type ViewportInteractionModifiers,
  type ViewportInteractionOptions,
  type ViewportInteractionPhase,
  type ViewportInteractionTargetBoxSelection,
  type ViewportInteractionTouchMode,
  type ViewportElementBoxInteractionApplyRequest,
  type ViewportPointInteractionApplyRequest,
  type ViewportTargetBoxInteractionApplyRequest,
} from "../interaction/viewport-interaction";
