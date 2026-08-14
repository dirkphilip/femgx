import type { InteractionTarget } from "../interaction/target-types";

interface OrderedTarget {
  readonly target: InteractionTarget;
  readonly order: readonly [number, number, number | string];
}

type NumericGroups = Map<number, Set<number>>;
type FaceGroups = Map<number, Map<number, Set<number>>>;

interface SeenIdentities {
  readonly partIds: Set<number>;
  readonly instanceIds: Set<number>;
  readonly ownerIds: NumericGroups;
  readonly faceIds: FaceGroups;
  readonly edgeIds: Map<number, Set<string>>;
}

/** Collects resolved region targets with numeric, granularity-aware identity. */
export interface PickRegionTargetCollector {
  /** Adds one resolved target, ignoring a duplicate semantic identity. */
  add(target: InteractionTarget, instancePickId: number): void;
  /** Returns targets in deterministic occurrence/identity order. */
  finish(): readonly InteractionTarget[];
}

/** Creates the duplicate-free collector used by the GPU region query. */
export function createPickRegionTargetCollector(): PickRegionTargetCollector {
  const ordered: OrderedTarget[] = [];
  const seen: SeenIdentities = {
    partIds: new Set(),
    instanceIds: new Set(),
    ownerIds: new Map(),
    faceIds: new Map(),
    edgeIds: new Map(),
  };

  return {
    add(target, instancePickId) {
      if (!recordIdentity(target, instancePickId, seen)) {
        return;
      }
      ordered.push({ target, order: targetOrder(target, instancePickId) });
    },
    finish() {
      return ordered
        .sort((left, right) => compareOrder(left.order, right.order))
        .map(({ target }) => target);
    },
  };
}

function recordIdentity(
  target: InteractionTarget,
  instancePickId: number,
  seen: SeenIdentities,
): boolean {
  switch (target.kind) {
    case "part":
      return recordNumber(seen.partIds, target.partId);
    case "instance":
      return recordNumber(seen.instanceIds, instancePickId);
    case "body":
      return recordNestedNumber(seen.ownerIds, instancePickId, target.bodyId);
    case "block":
      return recordNestedNumber(seen.ownerIds, instancePickId, target.blockId);
    case "element":
      return recordNestedNumber(seen.ownerIds, instancePickId, target.elementId);
    case "node":
      return recordNestedNumber(seen.ownerIds, instancePickId, target.nodeId);
    case "face":
      return recordFace(seen.faceIds, instancePickId, target.elementId, target.faceIndex);
    case "edge":
      return recordString(seen.edgeIds, instancePickId, target.key);
  }
}

function recordString(groups: Map<number, Set<string>>, outer: number, value: string): boolean {
  let values = groups.get(outer);
  if (values === undefined) {
    values = new Set();
    groups.set(outer, values);
  }
  if (values.has(value)) return false;
  values.add(value);
  return true;
}

function recordNumber(seen: Set<number>, value: number): boolean {
  if (seen.has(value)) return false;
  seen.add(value);
  return true;
}

function recordNestedNumber(groups: NumericGroups, outer: number, inner: number): boolean {
  let values = groups.get(outer);
  if (values === undefined) {
    values = new Set();
    groups.set(outer, values);
  }
  return recordNumber(values, inner);
}

function recordFace(groups: FaceGroups, instance: number, element: number, face: number): boolean {
  let elements = groups.get(instance);
  if (elements === undefined) {
    elements = new Map();
    groups.set(instance, elements);
  }
  let faces = elements.get(element);
  if (faces === undefined) {
    faces = new Set();
    elements.set(element, faces);
  }
  return recordNumber(faces, face);
}

function targetOrder(
  target: InteractionTarget,
  instancePickId: number,
): readonly [number, number, number | string] {
  switch (target.kind) {
    case "part":
      return [0, target.partId, 0];
    case "instance":
      return [instancePickId, 0, 0];
    case "body":
      return [instancePickId, target.bodyId, 0];
    case "block":
      return [instancePickId, target.blockId, 0];
    case "element":
      return [instancePickId, target.elementId, 0];
    case "node":
      return [instancePickId, target.nodeId, 0];
    case "face":
      return [instancePickId, target.elementId, target.faceIndex];
    case "edge":
      return [instancePickId, 7, target.key];
  }
}

function compareOrder(
  left: readonly [number, number, number | string],
  right: readonly [number, number, number | string],
): number {
  const first = left[0] - right[0] || left[1] - right[1];
  if (first !== 0) return first;
  if (typeof left[2] === "number" && typeof right[2] === "number") return left[2] - right[2];
  return String(left[2]).localeCompare(String(right[2]));
}
