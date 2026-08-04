import type { ElementId, FaceKey, InstanceId, PartId } from "../src/index";
import type { ResolvedPick } from "../src/index";

/** The interaction granularity a modifier key can select at. */
export type PickLevel = "node" | "face" | "element" | "instance" | "part";

/** A stable selection identity at any supported granularity. */
export type SelectTarget =
  | { readonly kind: "node"; readonly instanceId: InstanceId; readonly nodeId: number }
  | {
      readonly kind: "face";
      readonly instanceId: InstanceId;
      readonly elementId: ElementId;
      readonly faceKey: FaceKey;
    }
  | { readonly kind: "element"; readonly instanceId: InstanceId; readonly elementId: ElementId }
  | { readonly kind: "instance"; readonly instanceId: InstanceId }
  | { readonly kind: "part"; readonly partId: PartId };

/**
 * Maps a resolved pick to the selection target the modifier keys select at:
 * no modifier keeps the most specific hit, shift promotes to the element,
 * alt to the instance, and ctrl to the part.
 */
export function selectTarget(
  hit: ResolvedPick,
  modifiers: { readonly shiftKey: boolean; readonly altKey: boolean; readonly ctrlKey: boolean },
): SelectTarget | undefined {
  if (modifiers.ctrlKey) return { kind: "part", partId: hit.partId };
  if (modifiers.altKey) return { kind: "instance", instanceId: hit.instanceId };
  if (modifiers.shiftKey) {
    if (hit.kind === "node") {
      const elementId = hit.adjacentElementIds[0];
      if (elementId === undefined) return undefined;
      return { kind: "element", instanceId: hit.instanceId, elementId };
    }
    if (hit.kind === "face") {
      return { kind: "element", instanceId: hit.instanceId, elementId: hit.elementId };
    }
  }
  if (hit.kind === "node") return { kind: "node", instanceId: hit.instanceId, nodeId: hit.nodeId };
  if (hit.kind === "face") {
    return {
      kind: "face",
      instanceId: hit.instanceId,
      elementId: hit.elementId,
      faceKey: hit.faceKey,
    };
  }
  return { kind: "element", instanceId: hit.instanceId, elementId: hit.elementId };
}

/** Stable dataset key for a resolved pick or selection target. */
export function targetKey(target: ResolvedPick | SelectTarget | undefined): string {
  if (target === undefined) return "";
  switch (target.kind) {
    case "node":
      return `n:${target.instanceId}:${target.nodeId}`;
    case "face":
      return `f:${target.instanceId}:${target.elementId}:${target.faceKey}`;
    case "element":
      return `e:${target.instanceId}:${target.elementId}`;
    case "instance":
      return `i:${target.instanceId}`;
    case "part":
      return `p:${target.partId}`;
  }
}
