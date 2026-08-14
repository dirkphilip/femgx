import type { InteractionGranularity } from "../picking/types";
import { resolvePick, type PickContext, type ResolvedPickIds } from "../picking/pick";
import type { Part } from "../geometry/part";
import type { InteractionTarget } from "../interaction/target-types";
import { getPartSemanticIndex, type PartSemanticIndex } from "../geometry/part-semantic-index";

/** Creates a resolver that reuses immutable metadata for each reusable part. */
export function createPickRegionTargetResolver(
  context: PickContext,
  granularity: InteractionGranularity,
): (ids: ResolvedPickIds) => InteractionTarget | undefined {
  return (ids) => {
    const instance = resolvePick(context.instances, ids.instancePickId - 1);
    if (instance === undefined) return undefined;
    if (granularity === "instance") return { kind: "instance", instanceId: instance.instanceId };
    if (granularity === "part") return { kind: "part", partId: instance.partId };
    const part = context.parts.get(instance.partId);
    if (part === undefined) return undefined;
    const metadata =
      granularity === "body" || granularity === "block" || granularity === "element"
        ? getPartSemanticIndex(part)
        : undefined;
    return targetForGranularity(instance.instanceId, ids, granularity, part, metadata);
  };
}

function targetForGranularity(
  instanceId: string,
  ids: ResolvedPickIds,
  granularity: Exclude<InteractionGranularity, "part" | "instance">,
  part: Part,
  metadata: PartSemanticIndex | undefined,
): InteractionTarget | undefined {
  switch (granularity) {
    case "body": {
      const elementId = zeroBasedPickId(ids.elementPickId);
      const bodyId = elementId === undefined ? undefined : metadata?.bodyByElement.get(elementId);
      return bodyId === undefined ? undefined : { kind: "body", instanceId, bodyId };
    }
    case "block": {
      const elementId = zeroBasedPickId(ids.elementPickId);
      const blockId = elementId === undefined ? undefined : metadata?.blockByElement.get(elementId);
      return blockId === undefined ? undefined : { kind: "block", instanceId, blockId };
    }
    case "element": {
      const elementId = zeroBasedPickId(ids.elementPickId);
      return elementId !== undefined && metadata?.elements.has(elementId) === true
        ? { kind: "element", instanceId, elementId }
        : undefined;
    }
    case "face": {
      const face = zeroBasedPickId(ids.facePickId);
      const descriptor =
        face === undefined || part.geometry.primitive !== "triangles"
          ? undefined
          : part.geometry.faces?.[face];
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
      const nodeCount = (part.geometry.nodePositions?.length ?? 0) / 3;
      return nodeId !== undefined && nodeId < nodeCount
        ? { kind: "node", instanceId, nodeId }
        : undefined;
    }
    case "edge":
      return undefined;
  }
}

function zeroBasedPickId(pickId: number): number | undefined {
  return Number.isInteger(pickId) && pickId > 0 ? pickId - 1 : undefined;
}
