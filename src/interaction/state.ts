import type { ElementId, InstanceId } from "../scene/types";
import type { ElementBlockId } from "../elements/model";
import type { NodeId } from "../elements/element";
import type { BodyId, PartId } from "../geometry/part";
import type { InteractionTarget } from "./target-types";
import type { FaceRef } from "./refs";

/**
 * RGBA color with normalized channels.
 * @category Interaction and picking
 */
export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Partial per-instance style written into the GPU instance buffer.
 * @category Interaction and picking
 */
export interface StyleOverride {
  readonly color?: Color;
  /** Normalized emissive boost in the supported range `[0, 1]`. */
  readonly emissive?: number;
  readonly opacity?: number;
  /** Authored line width in CSS pixels. Supported only on part and instance layers. */
  readonly lineWidthPixels?: number;
  /** Whether the instance's mesh edges are overlaid as lines on its surface. */
  readonly edge?: boolean;
  /** Whether the instance's authored node annotations are overlaid. */
  readonly nodes?: boolean;
}

/**
 * Style fields supported by body, element, and interaction-theme layers.
 * @category Interaction and picking
 */
export type PrimitiveStyleOverride = Omit<StyleOverride, "edge" | "nodes" | "lineWidthPixels">;

/** Validates a public style override without normalizing caller-owned values. */
export function validateStyleOverride(override: StyleOverride | undefined): void {
  if (override === undefined) return;
  if (override.edge !== undefined && typeof override.edge !== "boolean") {
    throw new TypeError("edge must be a boolean");
  }
  if (override.nodes !== undefined && typeof override.nodes !== "boolean") {
    throw new TypeError("nodes must be a boolean");
  }
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

/** Rejects instance-level overlay membership from primitive-specific layers. */
export function validatePrimitiveStyleOverride(override: PrimitiveStyleOverride | undefined): void {
  if (override !== undefined && "lineWidthPixels" in override) {
    throw new TypeError("lineWidthPixels is only supported on part and instance overrides");
  }
  if (override !== undefined && ("edge" in override || "nodes" in override)) {
    throw new TypeError("edge and nodes are only supported on part and instance overrides");
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
  readonly color: Color;
  readonly emissive: number;
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
  readonly highlighted: PrimitiveStyleOverride;
  readonly selected: PrimitiveStyleOverride;
  readonly hovered: PrimitiveStyleOverride;
  readonly hoveredFace: PrimitiveStyleOverride;
  readonly selectedFace: PrimitiveStyleOverride;
  readonly hoveredNode: PrimitiveStyleOverride;
  readonly selectedNode: PrimitiveStyleOverride;
}

/** Opaque immutable interaction value exposed by the public API. */
declare const interactionStateBrand: unique symbol;
/** @category Interaction and picking */
export interface InteractionState {
  readonly [interactionStateBrand]: "InteractionState";
}

/** Private storage for the opaque interaction value. */
export interface InteractionStateData {
  readonly highlightedPartIds: ReadonlySet<PartId>;
  readonly highlightedInstanceIds: ReadonlySet<InstanceId>;
  readonly selectedPartIds: ReadonlySet<PartId>;
  readonly selectedInstanceIds: ReadonlySet<InstanceId>;
  readonly selectedBodyIds: ReadonlyMap<InstanceId, ReadonlySet<BodyId>>;
  readonly highlightedBodyIds: ReadonlyMap<InstanceId, ReadonlySet<BodyId>>;
  readonly bodyOverrides: ReadonlyMap<InstanceId, ReadonlyMap<BodyId, PrimitiveStyleOverride>>;
  readonly hiddenBodyIds: ReadonlyMap<InstanceId, ReadonlySet<BodyId>>;
  readonly selectedBlockIds: ReadonlyMap<InstanceId, ReadonlySet<ElementBlockId>>;
  readonly highlightedBlockIds: ReadonlyMap<InstanceId, ReadonlySet<ElementBlockId>>;
  readonly hiddenBlockIds: ReadonlyMap<InstanceId, ReadonlySet<ElementBlockId>>;
  readonly blockOverrides: ReadonlyMap<
    InstanceId,
    ReadonlyMap<ElementBlockId, PrimitiveStyleOverride>
  >;
  readonly selectedElementIds: ReadonlyMap<InstanceId, ReadonlySet<ElementId>>;
  readonly highlightedElementIds: ReadonlyMap<InstanceId, ReadonlySet<ElementId>>;
  readonly hiddenElementIds: ReadonlyMap<InstanceId, ReadonlySet<ElementId>>;
  readonly elementOverrides: ReadonlyMap<
    InstanceId,
    ReadonlyMap<ElementId, PrimitiveStyleOverride>
  >;
  readonly partOverrides: ReadonlyMap<PartId, StyleOverride>;
  readonly instanceOverrides: ReadonlyMap<InstanceId, StyleOverride>;
  readonly selectedNodeIds: ReadonlyMap<InstanceId, ReadonlySet<NodeId>>;
  readonly highlightedNodeIds: ReadonlyMap<InstanceId, ReadonlySet<NodeId>>;
  readonly selectedFaces: ReadonlyMap<InstanceId, ReadonlyMap<string, FaceRef>>;
  readonly highlightedFaces: ReadonlyMap<InstanceId, ReadonlyMap<string, FaceRef>>;
  readonly hoveredTarget?: InteractionTarget;
  readonly theme: InteractionTheme;
}

const dataByState = new WeakMap<InteractionState, InteractionStateData>();

/** Creates the frozen public token for private interaction data. */
export function createInteractionStateValue(data: InteractionStateData): InteractionState {
  const state = Object.freeze(Object.create(null)) as InteractionState;
  dataByState.set(state, data);
  return state;
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
  return createInteractionStateValue({ ...readInteractionState(state), ...patch });
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
    case "part":
      return right.kind === "part" && left.partId === right.partId;
    case "instance":
      return right.kind === "instance" && left.instanceId === right.instanceId;
    case "body":
      return (
        right.kind === "body" &&
        left.instanceId === right.instanceId &&
        left.bodyId === right.bodyId
      );
    case "block":
      return (
        right.kind === "block" &&
        left.instanceId === right.instanceId &&
        left.blockId === right.blockId
      );
    case "element":
      return (
        right.kind === "element" &&
        left.instanceId === right.instanceId &&
        left.elementId === right.elementId
      );
    case "face":
      return (
        right.kind === "face" &&
        left.instanceId === right.instanceId &&
        left.elementId === right.elementId &&
        left.faceIndex === right.faceIndex
      );
    case "node":
      return (
        right.kind === "node" &&
        left.instanceId === right.instanceId &&
        left.nodeId === right.nodeId
      );
  }
}
