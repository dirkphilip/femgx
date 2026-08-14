import type { InteractionGranularity } from "../picking/types";
import { resolvePick, type PickContext, type ResolvedPickIds } from "../picking/pick";
import type { FaceTessellation, Part, PartId } from "../geometry/part";
import type { InteractionTarget } from "../interaction/target-types";

type ElementId = NonNullable<Part["geometry"]["elements"]>[number]["id"];
type BodyId = NonNullable<Part["geometry"]["bodies"]>[number]["id"];

interface PickRegionPartIndex {
  readonly elementIds?: ReadonlySet<ElementId>;
  readonly bodyByElement?: ReadonlyMap<ElementId, BodyId>;
  readonly blockByElement?: ReadonlyMap<ElementId, number>;
  readonly faces?: readonly FaceTessellation[];
  readonly nodeCount?: number;
}

/** Builds the query-local metadata needed for one part and target granularity. */
export function buildPickRegionPartIndex(
  part: Part,
  granularity: InteractionGranularity,
): PickRegionPartIndex {
  const geometry = part.geometry;
  switch (granularity) {
    case "element":
      return { elementIds: new Set((geometry.elements ?? []).map(({ id }) => id)) };
    case "body":
      return { bodyByElement: bodyByElement(geometry) };
    case "block":
      return { blockByElement: blockByElement(geometry) };
    case "face":
      return geometry.primitive === "triangles" && geometry.faces !== undefined
        ? { faces: geometry.faces }
        : {};
    case "node":
      return { nodeCount: (geometry.nodePositions?.length ?? 0) / 3 };
    case "part":
    case "instance":
      return {};
  }
}

/** Creates a query-local resolver that shares one metadata index per reusable part. */
export function createPickRegionTargetResolver(
  context: PickContext,
  granularity: InteractionGranularity,
): (ids: ResolvedPickIds) => InteractionTarget | undefined {
  const indexes = new Map<PartId, PickRegionPartIndex>();
  const indexFor = (part: Part): PickRegionPartIndex => {
    const existing = indexes.get(part.id);
    if (existing !== undefined) return existing;
    const created = buildPickRegionPartIndex(part, granularity);
    indexes.set(part.id, created);
    return created;
  };

  return (ids) => {
    const instance = resolvePick(context.instances, ids.instancePickId - 1);
    if (instance === undefined) return undefined;
    if (granularity === "instance") return { kind: "instance", instanceId: instance.instanceId };
    if (granularity === "part") return { kind: "part", partId: instance.partId };
    const part = context.parts.get(instance.partId);
    if (part === undefined) return undefined;
    const index = indexFor(part);
    return targetForGranularity(instance.instanceId, ids, granularity, index);
  };
}

function targetForGranularity(
  instanceId: string,
  ids: ResolvedPickIds,
  granularity: Exclude<InteractionGranularity, "part" | "instance">,
  index: PickRegionPartIndex,
): InteractionTarget | undefined {
  switch (granularity) {
    case "body": {
      const elementId = zeroBasedPickId(ids.elementPickId);
      const bodyId = elementId === undefined ? undefined : index.bodyByElement?.get(elementId);
      return bodyId === undefined ? undefined : { kind: "body", instanceId, bodyId };
    }
    case "block": {
      const elementId = zeroBasedPickId(ids.elementPickId);
      const blockId = elementId === undefined ? undefined : index.blockByElement?.get(elementId);
      return blockId === undefined ? undefined : { kind: "block", instanceId, blockId };
    }
    case "element": {
      const elementId = zeroBasedPickId(ids.elementPickId);
      return elementId !== undefined && index.elementIds?.has(elementId)
        ? { kind: "element", instanceId, elementId }
        : undefined;
    }
    case "face": {
      const face = zeroBasedPickId(ids.facePickId);
      const descriptor = face === undefined ? undefined : index.faces?.[face];
      return descriptor === undefined
        ? undefined
        : {
            kind: "face",
            instanceId,
            elementId: descriptor.elementId,
            faceIndex: descriptor.faceIndex,
          };
    }
    case "node": {
      const nodeId = zeroBasedPickId(ids.nodePickId);
      return nodeId !== undefined && nodeId < (index.nodeCount ?? 0)
        ? { kind: "node", instanceId, nodeId }
        : undefined;
    }
  }
}

function bodyByElement(geometry: Part["geometry"]): ReadonlyMap<ElementId, BodyId> {
  const result = new Map<ElementId, BodyId>();
  for (const element of geometry.elements ?? []) {
    if (element.bodyId !== undefined) result.set(element.id, element.bodyId);
  }
  for (const body of geometry.bodies ?? []) {
    for (const elementId of body.elementIds) {
      if (!result.has(elementId)) result.set(elementId, body.id);
    }
  }
  return result;
}

function blockByElement(geometry: Part["geometry"]): ReadonlyMap<ElementId, number> {
  const result = new Map<ElementId, number>();
  for (const element of geometry.elements ?? []) {
    if (element.blockId !== undefined) result.set(element.id, element.blockId);
  }
  for (const block of geometry.blocks ?? []) {
    for (const elementId of block.elementIds) {
      if (!result.has(elementId)) result.set(elementId, block.id);
    }
  }
  return result;
}

function zeroBasedPickId(pickId: number): number | undefined {
  return Number.isInteger(pickId) && pickId > 0 ? pickId - 1 : undefined;
}
