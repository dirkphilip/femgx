import type { DeformationState } from "../results/deform";
import type { InteractionState } from "../interaction/interaction";
import { resolveElementStyle } from "../interaction/interaction";
import { isBodyVisible } from "../interaction/bodies";
import { isElementVisible } from "../interaction/elements";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import { instanceAt } from "./runtime-state";
import {
  createPart,
  MAX_PART_ID,
  type ElementTessellation,
  type Part,
  type PartId,
} from "../geometry/part";
import { buildElementSectionCap, type SectionCap } from "../geometry/section-cap";
import { getPartSemanticIndex } from "../geometry/part-semantic-index";
import type { SectionPlane } from "../math/section-plane";
import { identityMatrix } from "../math/mat4";
import { registerSectionCapOwner } from "./resources/section-caps/section-cap-ownership";
import { appendSectionCapCalls } from "./resources/section-caps/section-cap-calls";
import { nextSectionCapId, sectionCapKey } from "./resources/section-caps/section-cap-ids";
import { PartRevisionMap } from "./attachment/part-revision-overlay";
import { defaultStyle } from "./resources/foundation";
import type { ResultColorMap, ResultColorTable } from "../results/colors";
import { sectionCapOccurrenceValue } from "./resources/section-caps/section-cap-results";
import { readInteractionState } from "../interaction/state";
import {
  destroyInstancePartResources,
  destroyPartResources,
  encodeInstanceRecord,
  patchInstances,
  writeDrawOrder,
  type DrawCall,
  type DrawResources,
} from "./resources/draw-resources";

interface CapBuildOptions {
  readonly runtime: PackedSceneRuntime;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly plane: SectionPlane;
  readonly interaction: InteractionState;
  readonly deformation: DeformationState | undefined;
  readonly resultColors: ResultColorMap | undefined;
  readonly draw: DrawResources;
  readonly reusable?: SectionCapFrame;
  /** Exact source definitions whose cap fragments must be rebuilt. */
  readonly revisedPartIds?: ReadonlySet<PartId>;
  /** Exact source occurrence slots rebuilt by a topology transaction. */
  readonly revisedSlots?: ReadonlySet<number>;
}

export interface SectionCapFrame {
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly sourcePartIds: ReadonlyMap<PartId, PartId>;
  /** Exact cap ownership by source definition, avoiding a cap-wide lookup on revision. */
  readonly sourceCapIds: ReadonlyMap<PartId, Set<PartId>>;
  readonly sourceSlots: ReadonlyMap<PartId, number>;
  /** Exact cap ownership by packed occurrence slot. */
  readonly capIdsBySourceSlot: ReadonlyMap<number, Set<PartId>>;
  /** Stable source tuple to private cap id, avoiding cap-wide resource scans. */
  readonly capIdsByKey: ReadonlyMap<string, PartId>;
  readonly calls: readonly DrawCall[];
  readonly transparentCalls: readonly DrawCall[];
  readonly allCalls: readonly DrawCall[];
  readonly resultColors: ResultColorMap;
  /** Next descending private id reserved for a newly built cap. */
  readonly nextCapId: PartId;
}

export interface CapCallLists {
  readonly opaque: DrawCall[];
  readonly transparent: DrawCall[];
  readonly all: DrawCall[];
}

const CAP_TRANSFORM = identityMatrix();

/** Builds active occurrence caps into renderer-private reusable draw records. */
// eslint-disable-next-line max-lines-per-function -- Measured cap kernel; splitting adds hot-path allocation.
export function buildSectionCapFrame(options: CapBuildOptions): SectionCapFrame {
  const retained = options.revisedPartIds === undefined ? undefined : options.reusable;
  const capParts =
    retained === undefined ? new Map<PartId, Part>() : new PartRevisionMap(retained.parts);
  const sourcePartIds =
    retained === undefined
      ? new Map<PartId, PartId>()
      : new PartRevisionMap(retained.sourcePartIds);
  const sourceCapIds =
    retained === undefined
      ? new Map<PartId, Set<PartId>>()
      : new PartRevisionMap(retained.sourceCapIds);
  const sourceSlots =
    retained === undefined ? new Map<PartId, number>() : new PartRevisionMap(retained.sourceSlots);
  const capIdsBySourceSlot =
    retained === undefined
      ? new Map<number, Set<PartId>>()
      : new PartRevisionMap(retained.capIdsBySourceSlot);
  const capIdsByKey =
    retained === undefined ? new Map<string, PartId>() : new PartRevisionMap(retained.capIdsByKey);
  const calls: DrawCall[] = [];
  const transparentCalls: DrawCall[] = [];
  const allCalls: DrawCall[] = [];
  const resultColors =
    retained === undefined
      ? new Map<PartId, ResultColorTable>()
      : new PartRevisionMap(retained.resultColors);
  const reusable = retained ?? options.reusable;
  let nextId = retained?.nextCapId ?? MAX_PART_ID;
  for (const sourcePart of capSourceParts(options)) {
    const elements = sourcePart.elements;
    const sourcePositions = sourcePart.nodePositions;
    if (elements === undefined || sourcePositions === undefined) continue;
    const metadata = getPartSemanticIndex(sourcePart);
    for (const slot of capSourceSlots(options, sourcePart.id)) {
      if (!options.runtime.isInstanceVisible(slot)) continue;
      const instanceId = options.runtime.getInstanceId(slot);
      if (instanceId === undefined) continue;
      const instance = instanceAt(options.runtime, slot, sourcePart.id);
      const displacements = sectionCapOccurrenceValue(
        options.deformation?.displacements,
        sourcePart.id,
        instance.partOccurrenceId,
      );
      for (const element of elements) {
        if (!capElementVisible(options.interaction, instanceId, element, metadata)) continue;
        const cap = buildElementSectionCap({
          part: sourcePart,
          element,
          plane: options.plane,
          transform: instance.worldTransform,
          ...(displacements === undefined ? {} : { displacements }),
          deformationScale: options.deformation?.scale ?? 1,
        });
        if (cap === undefined) continue;
        const key = sectionCapKey(sourcePart.id, slot, element.id);
        const priorId = reusable?.capIdsByKey.get(key);
        const prior = priorId === undefined ? undefined : reusable?.parts.get(priorId);
        const next =
          prior === undefined ? nextSectionCapId(options.parts, capParts, nextId) : undefined;
        const capId = prior?.id ?? next?.id;
        nextId = next?.nextId ?? nextId;
        if (capId === undefined) throw new Error("Section-cap part identity allocation failed");
        const style = capStyle(options.interaction, instance, element.id, metadata);
        const capPart = prior ?? makeCapPart(capId, cap, element, sourcePositions.length / 3);
        capParts.set(capId, capPart);
        sourcePartIds.set(capId, sourcePart.id);
        registerSectionCapOwner(sourceCapIds, sourcePart.id, capId);
        sourceSlots.set(capId, slot);
        registerSectionCapOwner(capIdsBySourceSlot, slot, capId);
        capIdsByKey.set(key, capId);
        const call = { partId: capId, instanceCount: 1 } satisfies DrawCall;
        allCalls.push(call);
        if (style.color.a * style.opacity < 1) transparentCalls.push(call);
        else calls.push(call);
        installCapInstance(options.draw, capId, style, slot);
        const colors = capColors(
          sectionCapOccurrenceValue(options.resultColors, sourcePart.id, instance.partOccurrenceId),
          cap,
          sourcePositions.length / 3,
          metadata.elementOrdinal(element.id),
          elementColorOverridden(options.interaction, instanceId, element.id),
        );
        if (colors !== undefined) resultColors.set(capId, colors);
      }
    }
  }
  return {
    parts: capParts,
    sourcePartIds,
    sourceCapIds,
    sourceSlots,
    capIdsBySourceSlot,
    capIdsByKey,
    calls: appendSectionCapCalls(retained?.calls, calls),
    transparentCalls: appendSectionCapCalls(retained?.transparentCalls, transparentCalls),
    allCalls: appendSectionCapCalls(retained?.allCalls, allCalls),
    resultColors,
    nextCapId: nextId,
  };
}

function capSourceSlots(options: CapBuildOptions, partId: PartId): Iterable<number> {
  if (options.revisedSlots === undefined) return options.runtime.getPartInstanceSlots(partId);
  return matchingRevisedSlots(options, partId);
}

function* matchingRevisedSlots(options: CapBuildOptions, partId: PartId): Iterable<number> {
  for (const slot of options.revisedSlots ?? []) {
    if (options.runtime.instancePartIds[slot] === partId) yield slot;
  }
}

function* capSourceParts(options: CapBuildOptions): Iterable<Part> {
  if (options.revisedPartIds === undefined) {
    yield* options.parts.values();
    return;
  }
  for (const partId of options.revisedPartIds) {
    const part = options.parts.get(partId);
    if (part !== undefined) yield part;
  }
}

/** Resolves one cap's source-element presentation style. */
export function capStyle(
  interaction: InteractionState,
  instance: ReturnType<typeof instanceAt>,
  elementId: number,
  metadata: ReturnType<typeof getPartSemanticIndex>,
): ReturnType<typeof resolveElementStyle> {
  return resolveElementStyle(
    instance,
    elementId,
    defaultStyle,
    interaction,
    metadata.bodyForElement(elementId),
  );
}

/** Updates retained cap presentation records without rebuilding cap geometry. */
export function syncSectionCapStyles(options: {
  readonly frame: SectionCapFrame;
  readonly runtime: PackedSceneRuntime;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly interaction: InteractionState;
  readonly draw: DrawResources;
}): Pick<SectionCapFrame, "calls" | "transparentCalls"> {
  const calls: DrawCall[] = [];
  const transparentCalls: DrawCall[] = [];
  for (const [capId, capPart] of options.frame.parts) {
    const sourcePartId = options.frame.sourcePartIds.get(capId),
      sourceSlot = options.frame.sourceSlots.get(capId);
    const sourcePart = sourcePartId === undefined ? undefined : options.parts.get(sourcePartId),
      element = capPart.elements?.at(0);
    if (
      sourcePartId === undefined ||
      sourcePart === undefined ||
      sourceSlot === undefined ||
      element === undefined
    )
      continue;
    const instance = instanceAt(options.runtime, sourceSlot, sourcePart.id);
    const style = capStyle(
      options.interaction,
      instance,
      element.id,
      getPartSemanticIndex(sourcePart),
    );
    patchInstances(options.draw, capId, [
      { slot: 0, data: encodeInstanceRecord(CAP_TRANSFORM, style, sourceSlot + 1) },
    ]);
    const call = { partId: capId, instanceCount: 1 } satisfies DrawCall;
    if (style.color.a * style.opacity < 1) transparentCalls.push(call);
    else calls.push(call);
  }
  return { calls, transparentCalls };
}

/** Patches one cap record and appends it to the matching presentation call list. */
export function appendCapCall(
  draw: DrawResources,
  capId: PartId,
  style: ReturnType<typeof resolveElementStyle>,
  sourceSlot: number,
  calls: CapCallLists,
): void {
  patchInstances(draw, capId, [
    { slot: 0, data: encodeInstanceRecord(CAP_TRANSFORM, style, sourceSlot + 1) },
  ]);
  const call = { partId: capId, instanceCount: 1 } satisfies DrawCall;
  calls.all.push(call);
  if (style.color.a * style.opacity < 1) calls.transparent.push(call);
  else calls.opaque.push(call);
}

function installCapInstance(
  draw: DrawResources,
  capId: PartId,
  style: ReturnType<typeof resolveElementStyle>,
  sourceSlot: number,
): void {
  patchInstances(draw, capId, [
    { slot: 0, data: encodeInstanceRecord(CAP_TRANSFORM, style, sourceSlot + 1) },
  ]);
  writeDrawOrder(draw, capId, new Uint32Array([0]));
}

/** Releases only renderer-private cap geometry and instance buffers. */
export function destroySectionCapFrame(frame: SectionCapFrame, draw: DrawResources): void {
  for (const partId of frame.parts.keys()) {
    destroyPartResources(draw, partId);
    destroyInstancePartResources(draw, partId);
  }
}

/** Tests the source element's body and element visibility for cap admission. */
export function capElementVisible(
  interaction: InteractionState,
  instanceId: string,
  element: ElementTessellation,
  metadata: ReturnType<typeof getPartSemanticIndex>,
): boolean {
  if (!isElementVisible(interaction, { partOccurrenceId: instanceId, elementId: element.id }))
    return false;
  const bodyId = metadata.bodyForElement(element.id);
  if (bodyId !== undefined && !isBodyVisible(interaction, { partOccurrenceId: instanceId, bodyId }))
    return false;
  return true;
}

function makeCapPart(
  id: PartId,
  cap: SectionCap,
  element: ElementTessellation,
  sourceNodeCount: number,
): Part {
  const positions = new Float32Array(cap.vertices.length * 3);
  const nodePickIds = new Uint32Array(cap.vertices.length);
  for (const [index, vertex] of cap.vertices.entries()) {
    positions.set(vertex.position, index * 3);
    nodePickIds[index] = sourceNodeCount + index + 1;
  }
  const nodePositions = new Float32Array((sourceNodeCount + cap.vertices.length) * 3);
  for (const [index, vertex] of cap.vertices.entries()) {
    nodePositions.set(vertex.position, (sourceNodeCount + index) * 3);
  }
  return createPart(id, {
    geometries: [{ primitive: "triangles", positions, indices: cap.indices, nodePickIds }],
    nodePositions,
    elements: [
      {
        id: element.id,
        ...(element.shape === undefined ? {} : { shape: element.shape }),
        primitiveRanges: [
          { primitive: "triangles", primitiveStart: 0, primitiveCount: cap.indices.length / 3 },
        ],
      },
    ],
  });
}

function capColors(
  source: ResultColorTable | undefined,
  cap: SectionCap,
  sourceNodeCount: number,
  sourceElementOrdinal: number | undefined,
  colorOverridden: boolean,
): ResultColorTable | undefined {
  if (source === undefined || colorOverridden) return undefined;
  if (source.location === "elemental") {
    if (sourceElementOrdinal === undefined) return undefined;
    const values = new Float32Array(8);
    values.set(source.values.subarray(sourceElementOrdinal * 4, sourceElementOrdinal * 4 + 4), 4);
    return { location: "elemental", values };
  }
  const result = new Float32Array((sourceNodeCount + cap.vertices.length + 1) * 4);
  result.set(source.values.subarray(0, Math.min(source.values.length, (sourceNodeCount + 1) * 4)));
  for (const [index, vertex] of cap.vertices.entries()) {
    const target = (sourceNodeCount + index + 1) * 4;
    const a = (vertex.nodeA + 1) * 4;
    const b = (vertex.nodeB + 1) * 4;
    const weight = vertex.weightB;
    for (let channel = 0; channel < 4; channel += 1) {
      result[target + channel] =
        (source.values[a + channel] ?? 0) * (1 - weight) +
        (source.values[b + channel] ?? 0) * weight;
    }
  }
  return { location: "nodal", values: result };
}

function elementColorOverridden(
  interaction: InteractionState,
  instanceId: string,
  elementId: number,
): boolean {
  const override = readInteractionState(interaction)
    .elementOverrides.get(instanceId)
    ?.get(elementId);
  return override?.color !== undefined || override?.opacity !== undefined;
}
