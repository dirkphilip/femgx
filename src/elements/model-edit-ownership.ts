import type { Element, ElementId } from "./element";
import type { Body, BodyId, ElementBlock, ElementBlockId } from "./model-types";

/** Mutable draft collections owned by one private edit transaction. */
export interface MutableModelParts {
  nodes: Float32Array;
  elements: Element[];
  blocks: ElementBlock[] | undefined;
  bodies: Body[] | undefined;
}

/** The representation used by a body in the authored model. */
export type BodyMembershipKind = "element" | "block";

/** Identity metadata needed to restore a body after temporary detachment. */
export interface BodySnapshot {
  readonly id: BodyId;
  readonly name?: string;
  readonly kind: BodyMembershipKind;
}

/** Effective ownership classification for one block before an edit. */
export type BlockBodyResolution =
  | { readonly kind: "unowned" }
  | { readonly kind: "owned"; readonly bodyId: BodyId }
  | { readonly kind: "ambiguous" };

/** Captures a body's identity and membership representation. */
export function bodySnapshot(
  bodies: readonly Body[] | undefined,
  bodyId: BodyId,
): BodySnapshot | undefined {
  const body = bodies?.find((candidate) => candidate.id === bodyId);
  if (body === undefined) return undefined;
  return {
    id: body.id,
    ...(body.name === undefined ? {} : { name: body.name }),
    kind: "elementIds" in body ? "element" : "block",
  };
}

/** Resolves block ownership from block-defined and direct body membership. */
export function resolveBlockBody(
  block: ElementBlock,
  bodies: readonly Body[] | undefined,
): BlockBodyResolution {
  const blockOwner = bodies?.find((body) => "blockIds" in body && body.blockIds.includes(block.id));
  const directOwners = new Set<BodyId>();
  for (const body of bodies ?? []) {
    if ("elementIds" in body) {
      for (const elementId of block.elementIds) {
        if (body.elementIds.includes(elementId)) directOwners.add(body.id);
      }
    }
  }
  if (blockOwner !== undefined) {
    if ([...directOwners].some((bodyId) => bodyId !== blockOwner.id)) {
      return { kind: "ambiguous" };
    }
    return { kind: "owned", bodyId: blockOwner.id };
  }
  if (directOwners.size === 0) return { kind: "unowned" };
  if (
    directOwners.size === 1 &&
    block.elementIds.every((elementId) =>
      bodies?.some((body) => "elementIds" in body && body.elementIds.includes(elementId)),
    )
  ) {
    return { kind: "owned", bodyId: [...directOwners][0] as BodyId };
  }
  return { kind: "ambiguous" };
}

/** Removes selected ownership entries and prunes empty bodies from a draft. */
export function detachOwnership(
  parts: MutableModelParts,
  blockIds: ReadonlySet<ElementBlockId>,
  elementIds: ReadonlySet<ElementId>,
): void {
  if (parts.bodies === undefined) return;
  const bodies: Body[] = [];
  for (const body of parts.bodies) {
    if ("elementIds" in body) {
      const remaining = body.elementIds.filter((elementId) => !elementIds.has(elementId));
      if (remaining.length > 0) {
        bodies.push({
          id: body.id,
          ...(body.name === undefined ? {} : { name: body.name }),
          elementIds: remaining,
        });
      }
      continue;
    }
    const remaining = body.blockIds.filter((blockId) => !blockIds.has(blockId));
    if (remaining.length > 0) {
      bodies.push({
        id: body.id,
        ...(body.name === undefined ? {} : { name: body.name }),
        blockIds: remaining,
      });
    }
  }
  parts.bodies = bodies.length === 0 ? undefined : bodies;
}

/** Restores one body membership entry after a draft rewrite. */
export function attachOwnership(
  parts: MutableModelParts,
  snapshot: BodySnapshot,
  blockId: ElementBlockId,
  elementIds: readonly ElementId[],
): void {
  const bodies = parts.bodies === undefined ? [] : [...parts.bodies];
  const index = bodies.findIndex((body) => body.id === snapshot.id);
  if (snapshot.kind === "element") {
    const current =
      index < 0
        ? []
        : bodies[index] && "elementIds" in bodies[index]
          ? bodies[index].elementIds
          : [];
    const merged = [...new Set([...current, ...elementIds])].sort((a, b) => a - b);
    const body: Body = {
      id: snapshot.id,
      ...(snapshot.name === undefined ? {} : { name: snapshot.name }),
      elementIds: merged,
    };
    if (index < 0) insertBody(bodies, body);
    else bodies[index] = body;
  } else {
    const current =
      index < 0 ? [] : bodies[index] && "blockIds" in bodies[index] ? bodies[index].blockIds : [];
    const merged = [...new Set([...current, blockId])].sort((a, b) => a - b);
    const body: Body = {
      id: snapshot.id,
      ...(snapshot.name === undefined ? {} : { name: snapshot.name }),
      blockIds: merged,
    };
    if (index < 0) insertBody(bodies, body);
    else bodies[index] = body;
  }
  parts.bodies = bodies;
}

function insertBody(bodies: Body[], body: Body): void {
  const index = bodies.findIndex((candidate) => candidate.id > body.id);
  if (index < 0) bodies.push(body);
  else bodies.splice(index, 0, body);
}
