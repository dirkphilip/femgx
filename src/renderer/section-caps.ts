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
import { packedElementTransient, packedSemanticStorage } from "../geometry/packed/packed-semantic";
import type { SectionPlane } from "../math/section-plane";
import { identity } from "../math/mat4";
import { defaultStyle } from "./resources/foundation";
import type { ResultColorMap, ResultColorTable } from "../results/colors";
import { resultBindingValue } from "../results/bindings";
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
}

export interface SectionCapFrame {
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly sourcePartIds: ReadonlyMap<PartId, PartId>;
  readonly calls: readonly DrawCall[];
  readonly transparentCalls: readonly DrawCall[];
  readonly allCalls: readonly DrawCall[];
  readonly resultColors: ResultColorMap;
}

const CAP_TRANSFORM = identity();

/** Builds active occurrence caps into renderer-private reusable draw records. */
export function buildSectionCapFrame(options: CapBuildOptions): SectionCapFrame {
  const capParts = new Map<PartId, Part>();
  const sourcePartIds = new Map<PartId, PartId>();
  const calls: DrawCall[] = [];
  const transparentCalls: DrawCall[] = [];
  const allCalls: DrawCall[] = [];
  const resultColors = new Map<PartId, ResultColorTable>();
  const usedIds = new Set(options.parts.keys());
  let ordinal = 0;
  for (const sourcePart of options.parts.values()) {
    const elements = sourcePart.elements;
    const sourcePositions = sourcePart.nodePositions;
    if (elements === undefined || sourcePositions === undefined) continue;
    const packed = packedSemanticStorage(sourcePart);
    const metadata = getPartSemanticIndex(sourcePart);
    for (const slot of options.runtime.getPartInstanceSlots(sourcePart.id)) {
      if (!options.runtime.isInstanceVisible(slot)) continue;
      const instanceId = options.runtime.getInstanceId(slot);
      if (instanceId === undefined) continue;
      const instance = instanceAt(options.runtime, slot, sourcePart.id);
      const displacements = occurrenceValue(
        options.deformation?.displacements,
        sourcePart.id,
        instance.partOccurrenceId,
      );
      for (const element of sectionElements(elements, packed)) {
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
        const capId = nextCapId(usedIds, ordinal);
        ordinal += 1;
        const style = capStyle(options, instance, element.id, metadata);
        const capPart = makeCapPart(capId, cap, element, sourcePositions.length / 3);
        capParts.set(capId, capPart);
        sourcePartIds.set(capId, sourcePart.id);
        const call = { partId: capId, instanceCount: 1 } satisfies DrawCall;
        allCalls.push(call);
        if (style.color.a * style.opacity < 1) transparentCalls.push(call);
        else calls.push(call);
        installCapInstance(options.draw, capId, style, slot);
        const colors = capColors(
          occurrenceValue(options.resultColors, sourcePart.id, instance.partOccurrenceId),
          cap,
          sourcePositions.length / 3,
          metadata.elementOrdinalById.get(element.id),
          elementColorOverridden(options.interaction, instanceId, element.id),
        );
        if (colors !== undefined) resultColors.set(capId, colors);
      }
    }
  }
  return { parts: capParts, sourcePartIds, calls, transparentCalls, allCalls, resultColors };
}

function capStyle(
  options: CapBuildOptions,
  instance: ReturnType<typeof instanceAt>,
  elementId: number,
  metadata: ReturnType<typeof getPartSemanticIndex>,
): ReturnType<typeof resolveElementStyle> {
  return resolveElementStyle(
    instance,
    elementId,
    defaultStyle,
    options.interaction,
    metadata.bodyByElement.get(elementId),
  );
}

function occurrenceValue<Value>(
  source: ReadonlyMap<number | string, Value> | undefined,
  partId: PartId,
  occurrenceId: string,
): Value | undefined {
  return source === undefined ? undefined : resultBindingValue(source, partId, occurrenceId);
}

function* sectionElements(
  elements: readonly ElementTessellation[],
  packed: ReturnType<typeof packedSemanticStorage>,
): IterableIterator<ElementTessellation> {
  if (packed === undefined) {
    yield* elements;
    return;
  }
  for (let ordinal = 0; ordinal < packed.elementIds.length; ordinal += 1) {
    yield packedElementTransient(packed, ordinal);
  }
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

function capElementVisible(
  interaction: InteractionState,
  instanceId: string,
  element: ElementTessellation,
  metadata: ReturnType<typeof getPartSemanticIndex>,
): boolean {
  if (!isElementVisible(interaction, { partOccurrenceId: instanceId, elementId: element.id }))
    return false;
  const bodyId = metadata.bodyByElement.get(element.id);
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

function nextCapId(used: Set<PartId>, ordinal: number): PartId {
  let id = MAX_PART_ID - ordinal;
  while (used.has(id)) {
    id -= 1;
    if (id < 0) throw new Error("Section-cap part identity capacity exhausted");
  }
  used.add(id);
  return id;
}
