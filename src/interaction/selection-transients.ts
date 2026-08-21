import type { EdgeRef, FaceRef } from "./refs";
import type { InteractionTarget } from "./target-types";

type PartTarget = Extract<InteractionTarget, { readonly kind: "part" }>;
type PartOccurrenceTarget = Extract<InteractionTarget, { readonly kind: "partOccurrence" }>;
type BodyTarget = Extract<InteractionTarget, { readonly kind: "body" }>;
type ElementTarget = Extract<InteractionTarget, { readonly kind: "element" }>;
type FaceTarget = Extract<InteractionTarget, { readonly kind: "face" }>;
type NodeTarget = Extract<InteractionTarget, { readonly kind: "node" }>;
type EdgeTarget = Extract<InteractionTarget, { readonly kind: "edge" }>;
type AssemblyTarget = Extract<InteractionTarget, { readonly kind: "assembly" }>;
type AssemblyOccurrenceTarget = Extract<InteractionTarget, { readonly kind: "assemblyOccurrence" }>;

export interface TargetGroups {
  readonly assemblyIds: Set<AssemblyTarget["assemblyId"]>;
  readonly assemblyOccurrenceIds: Set<AssemblyOccurrenceTarget["assemblyOccurrenceId"]>;
  readonly partIds: Set<PartTarget["partId"]>;
  readonly partOccurrenceIds: Set<PartOccurrenceTarget["partOccurrenceId"]>;
  readonly bodyIds: Map<BodyTarget["partOccurrenceId"], Set<BodyTarget["bodyId"]>>;
  readonly elementIds: Map<ElementTarget["partOccurrenceId"], Set<ElementTarget["elementId"]>>;
  readonly faceRefs: Map<FaceTarget["partOccurrenceId"], Map<string, FaceRef>>;
  readonly nodeIds: Map<NodeTarget["partOccurrenceId"], Set<NodeTarget["nodeId"]>>;
  readonly edgeRefs: Map<EdgeTarget["partOccurrenceId"], Map<string, EdgeRef>>;
}

export interface TargetCollections {
  readonly assemblyIds: ReadonlySet<AssemblyTarget["assemblyId"]>;
  readonly assemblyOccurrenceIds: ReadonlySet<AssemblyOccurrenceTarget["assemblyOccurrenceId"]>;
  readonly partIds: ReadonlySet<PartTarget["partId"]>;
  readonly partOccurrenceIds: ReadonlySet<PartOccurrenceTarget["partOccurrenceId"]>;
  readonly bodyIds: ReadonlyMap<BodyTarget["partOccurrenceId"], ReadonlySet<BodyTarget["bodyId"]>>;
  readonly elementIds: ReadonlyMap<
    ElementTarget["partOccurrenceId"],
    ReadonlySet<ElementTarget["elementId"]>
  >;
  readonly faceRefs: ReadonlyMap<FaceTarget["partOccurrenceId"], ReadonlyMap<string, FaceRef>>;
  readonly nodeIds: ReadonlyMap<NodeTarget["partOccurrenceId"], ReadonlySet<NodeTarget["nodeId"]>>;
  readonly edgeRefs: ReadonlyMap<EdgeTarget["partOccurrenceId"], ReadonlyMap<string, EdgeRef>>;
}

/** Publishes freshly grouped selection values without copying empty destinations. */
export function updateSelectedTargetCollections(
  current: TargetCollections,
  groups: TargetGroups,
  enabled: boolean,
): TargetCollections {
  return {
    assemblyIds: updateOwnedSet(current.assemblyIds, groups.assemblyIds, enabled),
    assemblyOccurrenceIds: updateOwnedSet(
      current.assemblyOccurrenceIds,
      groups.assemblyOccurrenceIds,
      enabled,
    ),
    partIds: updateOwnedSet(current.partIds, groups.partIds, enabled),
    partOccurrenceIds: updateOwnedSet(current.partOccurrenceIds, groups.partOccurrenceIds, enabled),
    bodyIds: updateOwnedNestedSets(current.bodyIds, groups.bodyIds, enabled),
    elementIds: updateOwnedNestedSets(current.elementIds, groups.elementIds, enabled),
    faceRefs: updateOwnedNestedMaps(current.faceRefs, groups.faceRefs, enabled),
    nodeIds: updateOwnedNestedSets(current.nodeIds, groups.nodeIds, enabled),
    edgeRefs: updateOwnedNestedMaps(current.edgeRefs, groups.edgeRefs, enabled),
  };
}

function updateOwnedSet<T>(
  current: ReadonlySet<T>,
  values: Set<T>,
  enabled: boolean,
): ReadonlySet<T> {
  if (values.size === 0) return current;
  if (enabled) {
    if (current.size === 0) return values;
    let next: Set<T> | undefined;
    for (const value of values) {
      if (current.has(value)) continue;
      next ??= new Set(current);
      next.add(value);
    }
    return next ?? current;
  }
  if (current.size === 0) return current;
  if (current.size <= values.size && setIsCoveredBy(current, values)) return new Set();
  let next: Set<T> | undefined;
  for (const value of values) {
    if (!current.has(value)) continue;
    next ??= new Set(current);
    next.delete(value);
  }
  return next ?? current;
}

function updateOwnedNestedSets<OuterKey, InnerKey>(
  current: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>,
  groups: Map<OuterKey, Set<InnerKey>>,
  enabled: boolean,
): ReadonlyMap<OuterKey, ReadonlySet<InnerKey>> {
  let next: Map<OuterKey, ReadonlySet<InnerKey>> | undefined;
  for (const [outerKey, values] of groups) {
    const existing = current.get(outerKey);
    if (existing === undefined) {
      if (!enabled) continue;
      next ??= new Map(current);
      next.set(outerKey, values);
      continue;
    }
    const nextValues = updateOwnedSet(existing, values, enabled);
    if (nextValues === existing) continue;
    next ??= new Map(current);
    if (nextValues.size === 0) next.delete(outerKey);
    else next.set(outerKey, nextValues);
  }
  return next ?? current;
}

function updateOwnedNestedMaps<OuterKey, InnerKey, Value>(
  current: ReadonlyMap<OuterKey, ReadonlyMap<InnerKey, Value>>,
  groups: Map<OuterKey, Map<InnerKey, Value>>,
  enabled: boolean,
): ReadonlyMap<OuterKey, ReadonlyMap<InnerKey, Value>> {
  let next: Map<OuterKey, ReadonlyMap<InnerKey, Value>> | undefined;
  for (const [outerKey, values] of groups) {
    const existing = current.get(outerKey);
    if (existing === undefined) {
      if (!enabled) continue;
      next ??= new Map(current);
      next.set(outerKey, values);
      continue;
    }
    const nextValues = updateOwnedMap(existing, values, enabled);
    if (nextValues === existing) continue;
    next ??= new Map(current);
    if (nextValues.size === 0) next.delete(outerKey);
    else next.set(outerKey, nextValues);
  }
  return next ?? current;
}

function updateOwnedMap<Key, Value>(
  current: ReadonlyMap<Key, Value>,
  values: Map<Key, Value>,
  enabled: boolean,
): ReadonlyMap<Key, Value> {
  if (values.size === 0) return current;
  if (enabled) {
    if (current.size === 0) return values;
    let next: Map<Key, Value> | undefined;
    for (const [key, value] of values) {
      if (current.has(key)) continue;
      next ??= new Map(current);
      next.set(key, value);
    }
    return next ?? current;
  }
  if (current.size === 0) return current;
  if (current.size <= values.size && mapKeysAreCoveredBy(current, values)) return new Map();
  let next: Map<Key, Value> | undefined;
  for (const key of values.keys()) {
    if (!current.has(key)) continue;
    next ??= new Map(current);
    next.delete(key);
  }
  return next ?? current;
}

function setIsCoveredBy<T>(current: ReadonlySet<T>, values: ReadonlySet<T>): boolean {
  for (const value of current) if (!values.has(value)) return false;
  return true;
}

function mapKeysAreCoveredBy<Key, Value>(
  current: ReadonlyMap<Key, Value>,
  values: ReadonlyMap<Key, unknown>,
): boolean {
  for (const key of current.keys()) if (!values.has(key)) return false;
  return true;
}
