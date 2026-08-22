import type { AssemblyId, AssemblyOccurrenceId, ElementId, PartOccurrenceId } from "../scene/types";
import type { NodeId } from "../elements/element";
import type { EdgeKey } from "../elements/edges";
import type { BodyId, PartId } from "../geometry/part";
import type { InteractionTarget } from "./target-types";
import type { EdgeRef, FaceRef } from "./refs";

/**
 * RGBA color with normalized channels.
 * @category Interaction and picking
 */
export interface Color {
  /** Red channel in the normalized range `[0, 1]`. */
  readonly r: number;
  /** Green channel in the normalized range `[0, 1]`. */
  readonly g: number;
  /** Blue channel in the normalized range `[0, 1]`. */
  readonly b: number;
  /** Alpha channel in the normalized range `[0, 1]`; zero remains pickable. */
  readonly a: number;
}

/**
 * Partial per-instance style written into the GPU instance buffer.
 * @category Interaction and picking
 */
export interface StyleOverride {
  /** Replacement base color, including normalized alpha. */
  readonly color?: Color;
  /** Normalized emissive boost in the supported range `[0, 1]`. */
  readonly emissive?: number;
  /** Fractional opacity in the normalized range `[0, 1]`. */
  readonly opacity?: number;
  /** Authored line width in CSS pixels. Supported only on part and instance layers. */
  readonly lineWidthPixels?: number;
}

/**
 * Style fields supported by body, element, and interaction-theme layers.
 * @category Interaction and picking
 */
export type PrimitiveStyleOverride = Omit<StyleOverride, "lineWidthPixels">;

/** Validates a public style override without normalizing caller-owned values. */
export function validateStyleOverride(override: StyleOverride | undefined): void {
  if (override === undefined) return;
  if (override.lineWidthPixels !== undefined) validateLineWidth(override.lineWidthPixels);
  if (override.opacity !== undefined) validateUnit("opacity", override.opacity);
  if (override.emissive !== undefined) validateUnit("emissive", override.emissive);
  if (override.color !== undefined) {
    validateUnit("color.r", override.color.r);
    validateUnit("color.g", override.color.g);
    validateUnit("color.b", override.color.b);
    validateUnit("color.a", override.color.a);
  }
}

/** Validates a style override used by primitive-specific layers. */
export function validatePrimitiveStyleOverride(override: PrimitiveStyleOverride | undefined): void {
  if (override !== undefined && "lineWidthPixels" in override) {
    throw new TypeError("lineWidthPixels is only supported on part and part-occurrence overrides");
  }
  validateStyleOverride(override);
}

function validateUnit(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be finite and in [0, 1]`);
  }
}

function validateLineWidth(value: number): void {
  if (!Number.isFinite(value) || value < 0.5 || value > 64) {
    throw new RangeError("lineWidthPixels must be finite and in [0.5, 64]");
  }
}

/**
 * Complete style consumed by a renderer.
 * @category Interaction and picking
 */
export interface ResolvedStyle {
  /** Final color after all style layers have been resolved. */
  readonly color: Color;
  /** Final normalized emissive boost. */
  readonly emissive: number;
  /** Final fractional opacity; zero remains an interaction target. */
  readonly opacity: number;
  /** Authored line width in CSS pixels. */
  readonly lineWidthPixels: number;
  /** Whether the instance's mesh edges are overlaid as lines on its surface. */
  readonly edge: boolean;
  /** Whether the instance's authored node annotations are overlaid. */
  readonly nodes: boolean;
}

/**
 * Visual defaults for interaction states.
 * @category Interaction and picking
 */
export interface InteractionTheme {
  /** Style applied while a target is highlighted. */
  readonly highlighted: PrimitiveStyleOverride;
  /** Style applied while a target is selected. */
  readonly selected: PrimitiveStyleOverride;
}

/** Internal symbol used to keep the public interaction token nominal. */
const interactionStateBrand: unique symbol = Symbol("InteractionState");
/**
 * Opaque immutable interaction value exposed by the public API.
 *
 * Create the initial value with {@link createInteractionState}; update it with
 * the pure selection, hover, visibility, and override helpers. The token has
 * no public mutable fields and is safe to retain between viewport updates.
 * @category Interaction and picking
 */
export interface InteractionState {
  /** Internal nominal marker; callers must not read or write this property. */
  readonly [interactionStateBrand]: "InteractionState";
}

/** Private storage for the opaque interaction value. */
export interface InteractionStateData {
  readonly highlightedAssemblyIds: ReadonlySet<AssemblyId>;
  readonly highlightedAssemblyOccurrenceIds: ReadonlySet<AssemblyOccurrenceId>;
  readonly highlightedPartIds: ReadonlySet<PartId>;
  readonly highlightedPartOccurrenceIds: ReadonlySet<PartOccurrenceId>;
  readonly selectedAssemblyIds: ReadonlySet<AssemblyId>;
  readonly selectedAssemblyOccurrenceIds: ReadonlySet<AssemblyOccurrenceId>;
  readonly selectedPartIds: ReadonlySet<PartId>;
  readonly selectedPartOccurrenceIds: ReadonlySet<PartOccurrenceId>;
  readonly selectedBodyIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<BodyId>>;
  readonly highlightedBodyIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<BodyId>>;
  readonly bodyOverrides: ReadonlyMap<
    PartOccurrenceId,
    ReadonlyMap<BodyId, PrimitiveStyleOverride>
  >;
  readonly selectedElementIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<ElementId>>;
  readonly highlightedElementIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<ElementId>>;
  readonly elementOverrides: ReadonlyMap<
    PartOccurrenceId,
    ReadonlyMap<ElementId, PrimitiveStyleOverride>
  >;
  readonly partOverrides: ReadonlyMap<PartId, StyleOverride>;
  readonly partOccurrenceOverrides: ReadonlyMap<PartOccurrenceId, StyleOverride>;
  readonly selectedNodeIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<NodeId>>;
  readonly highlightedNodeIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<NodeId>>;
  readonly selectedEdges: ReadonlyMap<PartOccurrenceId, ReadonlyMap<EdgeKey, EdgeRef>>;
  readonly highlightedEdges: ReadonlyMap<PartOccurrenceId, ReadonlyMap<EdgeKey, EdgeRef>>;
  readonly selectedFaces: ReadonlyMap<PartOccurrenceId, ReadonlyMap<string, FaceRef>>;
  readonly highlightedFaces: ReadonlyMap<PartOccurrenceId, ReadonlyMap<string, FaceRef>>;
  readonly hoveredTarget?: InteractionTarget;
  readonly theme: InteractionTheme;
}

const dataByState = new WeakMap<InteractionState, InteractionStateData>();
const visibilityByState = new WeakMap<InteractionState, InteractionVisibility>();

/** Internal semantic visibility projection consumed by renderer code. */
export interface InteractionVisibility {
  readonly hiddenBodyIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<BodyId>>;
  readonly hiddenElementIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<ElementId>>;
}

const EMPTY_VISIBILITY: InteractionVisibility = {
  hiddenBodyIds: new Map(),
  hiddenElementIds: new Map(),
};

/** Creates the frozen public token for private interaction data. */
export function createInteractionStateValue(data: InteractionStateData): InteractionState {
  const state: InteractionState = Object.freeze({
    [interactionStateBrand]: "InteractionState" as const,
  });
  dataByState.set(state, data);
  return state;
}

/** Associates a renderer-only visibility projection with an interaction token. */
export function withInteractionVisibility(
  state: InteractionState,
  visibility: InteractionVisibility,
): InteractionState {
  const next = createInteractionStateValue(readInteractionState(state));
  visibilityByState.set(next, visibility);
  return next;
}

/** Reads the visibility projection associated with an interaction token. */
export function readInteractionVisibility(state: InteractionState): InteractionVisibility {
  return visibilityByState.get(state) ?? EMPTY_VISIBILITY;
}

/** Internal state access for the renderer, viewport, and interaction modules. */
export function readInteractionState(state: InteractionState): InteractionStateData {
  const data = dataByState.get(state);
  if (data === undefined) throw new TypeError("Invalid InteractionState value");
  return data;
}

/** Creates a new opaque state value with a structural data patch. */
export function updateInteractionState(
  state: InteractionState,
  patch: Partial<InteractionStateData>,
): InteractionState {
  const next = createInteractionStateValue({ ...readInteractionState(state), ...patch });
  const visibility = visibilityByState.get(state);
  if (visibility !== undefined) visibilityByState.set(next, visibility);
  return next;
}

/** Replaces the one hovered target without mutating the previous state. */
export function setHoveredTarget(
  state: InteractionState,
  target: InteractionTarget | undefined,
): InteractionState {
  const current = readInteractionState(state).hoveredTarget;
  if (targetsEqual(current, target)) return state;
  if (target === undefined) {
    const { hoveredTarget: _, ...withoutHover } = readInteractionState(state);
    return createInteractionStateValue(withoutHover);
  }
  return updateInteractionState(state, { hoveredTarget: target });
}

/**
 * Tests whether the supplied target is currently hovered.
 * @category Interaction and picking
 */
export function isHoveredTarget(state: InteractionState, target: InteractionTarget): boolean {
  return targetsEqual(readInteractionState(state).hoveredTarget, target);
}

/**
 * Returns the current hovered target, if any.
 * @category Interaction and picking
 */
export function hoveredTarget(state: InteractionState): InteractionTarget | undefined {
  return readInteractionState(state).hoveredTarget;
}

/** Compares target identity without depending on object identity. */
function targetsEqual(
  left: InteractionTarget | undefined,
  right: InteractionTarget | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "assembly":
      return right.kind === "assembly" && left.assemblyId === right.assemblyId;
    case "assemblyOccurrence":
      return (
        right.kind === "assemblyOccurrence" &&
        left.assemblyOccurrenceId === right.assemblyOccurrenceId
      );
    case "part":
      return right.kind === "part" && left.partId === right.partId;
    case "partOccurrence":
      return right.kind === "partOccurrence" && left.partOccurrenceId === right.partOccurrenceId;
    case "body":
      return (
        right.kind === "body" &&
        left.partOccurrenceId === right.partOccurrenceId &&
        left.bodyId === right.bodyId
      );
    case "element":
      return (
        right.kind === "element" &&
        left.partOccurrenceId === right.partOccurrenceId &&
        left.elementId === right.elementId
      );
    case "face":
      return (
        right.kind === "face" &&
        left.partOccurrenceId === right.partOccurrenceId &&
        left.elementId === right.elementId &&
        left.faceIndex === right.faceIndex
      );
    case "node":
      return (
        right.kind === "node" &&
        left.partOccurrenceId === right.partOccurrenceId &&
        left.nodeId === right.nodeId
      );
    case "edge":
      return (
        right.kind === "edge" &&
        left.partOccurrenceId === right.partOccurrenceId &&
        left.key === right.key
      );
  }
}
