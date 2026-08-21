import type { InteractionGranularity } from "../../picking/types";
import { resolvePick, type PickContext, type ResolvedPickIds } from "../../picking/pick";
import type { Part } from "../../geometry/part";
import type { InteractionTarget } from "../../interaction/target-types";
import { getPartSemanticIndex, type PartSemanticIndex } from "../../geometry/part-semantic-index";

/** Creates a resolver that reuses immutable metadata for each reusable part. */
export function createPickRegionTargetResolver(
  context: PickContext,
  granularity: InteractionGranularity,
): (ids: ResolvedPickIds) => InteractionTarget | undefined {
  return (ids) => {
    const instance = resolvePick(context.instances, ids.instancePickId - 1);
    if (instance === undefined) return undefined;
    const path = context.assemblyPath?.(ids.instancePickId - 1) ?? [];
    if (granularity === "assembly") {
      const owner = path.at(-1);
      return owner === undefined ? undefined : { kind: "assembly", assemblyId: owner.assemblyId };
    }
    if (granularity === "assemblyOccurrence") {
      const owner = path.at(-1);
      return owner === undefined
        ? undefined
        : { kind: "assemblyOccurrence", assemblyOccurrenceId: owner.assemblyOccurrenceId };
    }
    if (granularity === "partOccurrence")
      return { kind: "partOccurrence", partOccurrenceId: instance.partOccurrenceId };
    if (granularity === "part") return { kind: "part", partId: instance.partId };
    const part = context.parts.get(instance.partId);
    if (part === undefined) return undefined;
    const metadata =
      granularity === "body" || granularity === "element" ? getPartSemanticIndex(part) : undefined;
    return targetForGranularity(instance.partOccurrenceId, ids, granularity, part, metadata);
  };
}

function targetForGranularity(
  instanceId: string,
  ids: ResolvedPickIds,
  granularity: Exclude<
    InteractionGranularity,
    "assembly" | "assemblyOccurrence" | "part" | "partOccurrence"
  >,
  part: Part,
  metadata: PartSemanticIndex | undefined,
): InteractionTarget | undefined {
  switch (granularity) {
    case "body": {
      const elementId = zeroBasedPickId(ids.elementPickId);
      const bodyId = elementId === undefined ? undefined : metadata?.bodyForElement(elementId);
      return bodyId === undefined
        ? undefined
        : { kind: "body", partOccurrenceId: instanceId, bodyId };
    }
    case "element": {
      const elementId = zeroBasedPickId(ids.elementPickId);
      return elementId !== undefined && metadata?.hasElement(elementId) === true
        ? { kind: "element", partOccurrenceId: instanceId, elementId }
        : undefined;
    }
    case "face": {
      const face = zeroBasedPickId(ids.facePickId);
      const triangleGeometry = part.geometries.find(
        (geometry) => geometry.primitive === "triangles",
      );
      const descriptor =
        face === undefined || triangleGeometry?.primitive !== "triangles"
          ? undefined
          : triangleGeometry.faces?.at(face);
      return descriptor === undefined
        ? undefined
        : {
            kind: "face",
            partOccurrenceId: instanceId,
            elementId: descriptor.elementId,
            faceIndex: descriptor.faceIndex,
          };
    }
    case "node": {
      const nodeId = zeroBasedPickId(ids.nodePickId);
      const nodeCount = (part.nodePositions?.length ?? 0) / 3;
      return nodeId !== undefined && nodeId < nodeCount
        ? { kind: "node", partOccurrenceId: instanceId, nodeId }
        : undefined;
    }
    case "edge":
      return undefined;
  }
}

function zeroBasedPickId(pickId: number): number | undefined {
  return Number.isInteger(pickId) && pickId > 0 ? pickId - 1 : undefined;
}
